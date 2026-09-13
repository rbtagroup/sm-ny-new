import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const supabaseDir = join(root, 'supabase')
const migrationsDir = join(supabaseDir, 'migrations')
const inventory = JSON.parse(readFileSync(join(supabaseDir, 'sql-inventory.json'), 'utf8'))

const topLevelSqlFiles = () => readdirSync(supabaseDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()

const migrationFiles = () => readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()

test('top-level Supabase SQL files are inventoried and not treated as source of truth', () => {
  assert.equal(inventory.sourceOfTruth, 'supabase/migrations')

  const actual = topLevelSqlFiles()
  const listed = inventory.files.map((file) => file.path).sort()

  assert.deepEqual(listed, actual)
  assert.equal(new Set(listed).size, listed.length)
})

test('legacy top-level SQL patches are blocked from direct production execution', () => {
  const allowedCategories = new Set(['manual-ops', 'manual-test', 'regression-probe', 'seed-template'])

  for (const file of inventory.files) {
    assert.equal(typeof file.notes, 'string', `${file.path} needs notes`)
    assert.ok(file.notes.length >= 20, `${file.path} notes should explain why it exists`)
    if (file.manualExecutionAllowed) {
      assert.ok(allowedCategories.has(file.category), `${file.path} cannot be manually executable as ${file.category}`)
    }
    if (file.category === 'legacy-patch' || file.category === 'schema-snapshot') {
      assert.equal(file.manualExecutionAllowed, false, `${file.path} must not be marked manually executable`)
    }
  }
})

test('non-executable top-level SQL files show source-of-truth guard comments', () => {
  for (const file of inventory.files.filter((entry) => !entry.manualExecutionAllowed)) {
    const sql = readFileSync(join(supabaseDir, file.path), 'utf8')
    const head = sql.slice(0, 900)

    assert.match(head, /DO NOT RUN DIRECTLY/, `${file.path} must warn against direct execution`)
    assert.match(head, /Source of truth: supabase\/migrations\//, `${file.path} must point to migrations`)
    assert.doesNotMatch(sql, /Spusť|Spustit/i, `${file.path} must not contain an unconditional SQL editor run instruction`)
  }
})

test('migration filenames are timestamped and unique', () => {
  const files = migrationFiles()
  assert.ok(files.length > 0, 'expected at least one migration')
  assert.equal(new Set(files).size, files.length)

  for (const file of files) {
    assert.match(file, /^\d{14}_[a-z0-9_]+\.sql$/, `${file} must use Supabase timestamp migration naming`)
  }
})

test('RLS regression probes cover driver notification and audit RPC flows', () => {
  const sql = readFileSync(join(supabaseDir, 'rls-regression-tests.sql'), 'utf8')

  assert.match(sql, /rb_insert_notifications/, 'driver notification RPC should be covered')
  assert.match(sql, /rb_insert_audit_log/, 'driver audit RPC should be covered')
  assert.match(sql, /driver confirm own shift/, 'driver shift confirmation should be covered')
  assert.match(sql, /driver decline own shift/, 'driver shift decline should be covered')
  assert.match(sql, /driver notification read state update/, 'driver notification state update should be covered')
  assert.match(sql, /driver notification title rewrite/, 'driver notification rewrite denial should be covered')
  assert.match(sql, /driver audit log select/, 'driver audit visibility denial should be covered')
  assert.match(sql, /staff audit log select/, 'staff audit visibility allow path should be covered')
  assert.match(sql, /staff notification RPC/, 'staff message notification RPC should be covered')
  assert.match(sql, /rb_request_swap_with_notifications/, 'driver swap request with side effects should be covered')
  assert.match(sql, /target driver decline targeted swap with side effects/, 'targeted swap decline should be covered')
  assert.match(sql, /target driver accept all-driver swap with side effects/, 'all-driver swap accept should be covered')
  assert.match(sql, /staff approve accepted swap with side effects/, 'staff swap approval should be covered')
  assert.match(sql, /staff swap approval assigns shift to approved driver/, 'staff approval shift assignment should be covered')
  assert.match(sql, /driver own activation change/, 'driver self-activation denial should be covered')
  assert.match(sql, /driver own phone update/, 'driver phone update allow path should be covered')
  assert.match(sql, /inactive driver reads other drivers/, 'inactive driver data isolation should be covered')
  assert.match(sql, /inactive driver notifies dispatch/, 'inactive driver notification denial should be covered')
  assert.match(sql, /driver reads colleague contacts/, 'colleague contact privacy should be covered')
  assert.match(sql, /driver directory lists colleague names/, 'driver directory allow path should be covered')
  assert.match(sql, /inactive driver reads driver directory/, 'inactive driver directory denial should be covered')
  assert.match(sql, /driver deletes a driver completely/, 'driver removal denial for drivers should be covered')
  assert.match(sql, /dispatcher removes a driver login/, 'login removal denial for dispatchers should be covered')
  assert.match(sql, /anon deletes a driver completely/, 'driver removal denial for anon should be covered')
  assert.match(sql, /admin removes a staff login through driver tools/, 'staff logins must be protected from driver tools')
  assert.match(sql, /admin login reset keeps shift history/, 'login reset allow path should keep history')
  assert.match(sql, /complete driver deletion removes shifts instead of opening them/, 'complete deletion must not turn shifts into open shifts')
  assert.match(sql, /complete driver deletion removes driver login/, 'complete deletion should remove the driver login')
})

test('driver removal migration is admin-only and deletes history before the driver row', () => {
  const file = migrationFiles().find((name) => name.endsWith('_driver_removal_tools.sql'))
  assert.ok(file, 'driver removal migration should exist')
  const sql = readFileSync(join(migrationsDir, file), 'utf8')
  const body = (name) => {
    const start = sql.indexOf(`create or replace function private.${name}(`)
    assert.ok(start >= 0, `${name} should be defined in the private schema`)
    return sql.slice(start, sql.indexOf('$$;', sql.indexOf('$$', start) + 2))
  }

  for (const name of ['rb_delete_driver_completely', 'rb_delete_driver_login']) {
    const fn = body(name)
    assert.match(fn, /security definer\s+set search_path = ''/, `${name} should be a definer function with an empty search_path`)
    assert.match(fn, /if not private\.rb_is_admin\(\) then\s+raise exception '[^']+' using errcode = '42501'/, `${name} should be admin-only`)
    assert.match(fn, /private\.rb_removable_driver_login\(v_driver\.profile_id\)/, `${name} must not remove staff or own logins`)
    assert.match(fn, /insert into public\.audit_logs/, `${name} should be audited`)
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\(text\\) from public, anon, service_role;`), `${name} wrapper should not be callable by anon`)
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(text\\) to authenticated;`), `${name} wrapper should be callable by signed-in users`)
  }

  const complete = body('rb_delete_driver_completely')
  const order = ['delete from public.shift_settlements', 'delete from public.swap_requests', 'delete from public.shifts', 'delete from public.drivers', 'delete from auth.users']
  const positions = order.map((statement) => complete.indexOf(statement))
  assert.ok(positions.every((position) => position >= 0), 'complete deletion should remove settlements, swaps, shifts, driver and login')
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'settlements and shifts must be removed before the driver row')
  assert.match(complete, /set\s+status = 'cancelled'[\s\S]*?where sr\.status in \('pending', 'accepted'\)/, 'unresolved colleague swaps should be cancelled')

  const login = body('rb_delete_driver_login')
  assert.doesNotMatch(login, /delete from public\.(shifts|shift_settlements|drivers)\b/, 'login reset must keep the driver and history')
  assert.match(login, /d\.profile_id is null\s+and lower\(trim\(coalesce\(d\.email, ''\)\)\) = lower\(trim\(v_driver\.email\)\)/, 'login reset should require an e-mail the new signup can link to')
  assert.match(sql, /trim\(lower\(coalesce\(p\.role, ''\)\)\) = 'driver'/, 'only driver accounts are removable')
  assert.match(sql, /p\.id is distinct from auth\.uid\(\)/, 'admins must not remove their own login')
})

test('driver directory migration hides colleague contacts from drivers', () => {
  const file = migrationFiles().find((name) => name.endsWith('_driver_directory_and_contact_privacy.sql'))
  assert.ok(file, 'driver directory migration should exist')
  const sql = readFileSync(join(migrationsDir, file), 'utf8')

  assert.match(sql, /alter policy "drivers_select_signed" on public\.drivers\s+using \(\(select public\.rb_is_staff\(\)\) or profile_id = \(select auth\.uid\(\)\)\)/, 'drivers should see only their own full row')
  assert.match(sql, /returns table \(id text, name text, active boolean\)/, 'directory should expose only id, name and active')
  assert.doesNotMatch(sql, /d\.(phone|email|note)/, 'directory must not expose contacts or notes')
  assert.match(sql, /where private\.rb_has_app_access\(\)/, 'directory should require app access')
  assert.match(sql, /private\.rb_driver_is_active\(notice_target_driver_id\)/, 'colleague notification check should not need driver row visibility')
})

test('app access migration gates shared data behind staff or active drivers', () => {
  const file = migrationFiles().find((name) => name.endsWith('_gate_app_access_and_alert_push_failures.sql'))
  assert.ok(file, 'app access migration should exist')
  const sql = readFileSync(join(migrationsDir, file), 'utf8')

  assert.match(sql, /and d\.active is not false/, 'current driver helper should ignore inactive drivers')
  assert.match(sql, /create or replace function public\.rb_has_app_access\(\)/, 'policies need a public access helper')
  for (const policy of ['drivers_select_signed', 'vehicles_select_signed', 'service_blocks_select_signed', 'settings_select_signed', 'notifications_select_visible', 'shifts_select_staff_own_or_swap', 'swap_requests_select_scoped']) {
    assert.match(sql, new RegExp(`alter policy "${policy}"[\\s\\S]*?rb_has_app_access`), `${policy} should require app access`)
  }
  assert.match(sql, /alter policy "drivers_insert" on public\.drivers\s+with check \(\(select public\.rb_is_staff\(\)\)\)/, 'only staff should insert drivers directly')
  assert.match(sql, /create trigger drivers_guard_update/, 'driver details should be guarded')
  assert.match(sql, /new\.active is distinct from old\.active/, 'drivers must not toggle their own activation')
  assert.match(sql, /false,\s+'Čeká na schválení dispečinkem\.'/, 'unknown signups should start as pending')
  assert.doesNotMatch(sql.slice(sql.indexOf('rb_upsert_driver_signup')), /active = true/, 'signup must not re-activate drivers')
  assert.match(sql, /create trigger audit_logs_alert_failed_job_push/, 'failed job pushes should alert dispatch')
  assert.match(sql, /if auth\.uid\(\) is not null or new\.actor_id is not null then/, 'only system audit rows may raise push alerts')
})

test('push rate-limit migrations avoid ambiguous bucket_key conflict target', () => {
  const fixSql = readFileSync(join(migrationsDir, '20260518072143_fix_push_rate_limit_bucket_key_ambiguity.sql'), 'utf8')

  assert.match(fixSql, /drop function if exists public\.rb_check_push_rate_limit/, 'public wrapper should be dropped before parameter rename')
  assert.match(fixSql, /drop function if exists private\.rb_check_push_rate_limit/, 'private function should be dropped before parameter rename')
  assert.match(fixSql, /p_bucket_key text/, 'private function should use unambiguous parameter names')
  assert.match(fixSql, /on conflict on constraint push_rate_limits_pkey/, 'upsert should use the primary key constraint name')
  assert.match(fixSql, /private\.rb_check_push_rate_limit\(\$1, \$2, \$3, \$4\)/, 'public wrapper should pass positional args')
})

test('push delivery log migration keeps delivery data staff-only and API-readable', () => {
  const sql = readFileSync(join(migrationsDir, '20260518214702_push_delivery_logs.sql'), 'utf8')

  assert.match(sql, /create table if not exists public\.push_delivery_logs/, 'delivery log table should be created')
  assert.match(sql, /alter table public\.push_delivery_logs enable row level security/, 'delivery log table must enable RLS')
  assert.match(sql, /push_delivery_logs_select_staff/, 'staff-only select policy should exist')
  assert.match(sql, /public\.rb_is_staff\(\)/, 'select policy should use the current staff helper')
  assert.match(sql, /revoke all on table public\.push_delivery_logs from anon/, 'anon must not get delivery logs')
  assert.match(sql, /grant select on table public\.push_delivery_logs to authenticated/, 'authenticated Data API select must be explicit')
  assert.match(sql, /grant all on table public\.push_delivery_logs to service_role/, 'service role API must be able to write delivery logs')
})

test('settlement assignment migrations keep reassigned open settlements editable', () => {
  const syncSql = readFileSync(join(migrationsDir, '20260521103742_fix_settlement_driver_assignment.sql'), 'utf8')
  const reopenSql = readFileSync(join(migrationsDir, '20260521104317_reopen_reassigned_settlements.sql'), 'utf8')

  assert.match(syncSql, /status <> 'approved'/, 'approved settlements should stay frozen')
  assert.match(syncSql, /shifts_sync_open_settlement_assignment/, 'shift assignment trigger should exist')
  assert.match(reopenSql, /status = case when settlement\.status = 'submitted' then 'returned'/, 'submitted drift should reopen for driver review')
  assert.match(reopenSql, /submitted_at = case when settlement\.status = 'submitted' then null/, 'reopened settlement should no longer look submitted')
  assert.match(reopenSql, /jsonb_set\(/, 'driver-facing form identity fields should be realigned')
})
