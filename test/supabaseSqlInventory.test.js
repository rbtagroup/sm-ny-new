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
  assert.match(sql, /driver notification read state update/, 'driver notification state update should be covered')
  assert.match(sql, /driver notification title rewrite/, 'driver notification rewrite denial should be covered')
  assert.match(sql, /driver audit log select/, 'driver audit visibility denial should be covered')
  assert.match(sql, /staff audit log select/, 'staff audit visibility allow path should be covered')
})

test('push rate-limit migrations avoid ambiguous bucket_key conflict target', () => {
  const fixSql = readFileSync(join(migrationsDir, '20260518072143_fix_push_rate_limit_bucket_key_ambiguity.sql'), 'utf8')

  assert.match(fixSql, /drop function if exists public\.rb_check_push_rate_limit/, 'public wrapper should be dropped before parameter rename')
  assert.match(fixSql, /drop function if exists private\.rb_check_push_rate_limit/, 'private function should be dropped before parameter rename')
  assert.match(fixSql, /p_bucket_key text/, 'private function should use unambiguous parameter names')
  assert.match(fixSql, /on conflict on constraint push_rate_limits_pkey/, 'upsert should use the primary key constraint name')
  assert.match(fixSql, /private\.rb_check_push_rate_limit\(\$1, \$2, \$3, \$4\)/, 'public wrapper should pass positional args')
})
