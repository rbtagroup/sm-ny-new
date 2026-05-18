import test from 'node:test'
import assert from 'node:assert/strict'
import {
  checkPushRateLimit,
  checkRateLimit,
  matchesNotice,
  normalizeNotice,
  pushDeliveryLogRows,
  pushSubscriptionFilterPlan,
  rateLimitKeyForProfile,
  recordPushDeliveryLogs,
  subscriptionsForNotice,
} from '../api/send-push.js'

function supabaseQueryMock(rows = []) {
  const calls = []
  const query = {
    select(columns) { calls.push(['select', columns]); return this },
    eq(column, value) { calls.push(['eq', column, value]); return this },
    in(column, value) { calls.push(['in', column, value]); return this },
    then(resolve) { return resolve({ data: rows, error: null }) },
  }
  return {
    calls,
    supabase: {
      from(table) { calls.push(['from', table]); return query },
    },
  }
}

test('normalizeNotice locks concrete driver targets to driver role', () => {
  assert.deepEqual(normalizeNotice({
    id: 'n1',
    title: 'Směna',
    target_driver_id: 'drv_1',
    target_role: 'admin',
    shift_id: 'sh_1',
  }), {
    id: 'n1',
    title: 'Směna',
    body: 'Nové upozornění v aplikaci RBSHIFT.',
    type: 'info',
    shiftId: 'sh_1',
    targetDriverId: 'drv_1',
    targetRole: 'driver',
  })
})

test('matchesNotice routes staff and driver notices consistently', () => {
  assert.equal(matchesNotice({ role: 'dispatcher' }, normalizeNotice({ title: 'A', targetRole: 'admin' })), true)
  assert.equal(matchesNotice({ role: 'driver' }, normalizeNotice({ title: 'A', targetRole: 'admin' })), false)
  assert.equal(matchesNotice({ role: 'driver', driver_id: 'drv_1' }, normalizeNotice({ title: 'A', targetDriverId: 'drv_1' })), true)
  assert.equal(matchesNotice({ role: 'driver', driver_id: 'drv_2' }, normalizeNotice({ title: 'A', targetDriverId: 'drv_1' })), false)
})

test('pushSubscriptionFilterPlan avoids all-subscription scans for scoped targets', () => {
  assert.deepEqual(pushSubscriptionFilterPlan(normalizeNotice({ title: 'A', targetDriverId: 'drv_1' })), { driverId: 'drv_1', roles: null })
  assert.deepEqual(pushSubscriptionFilterPlan(normalizeNotice({ title: 'A', targetRole: 'driver_all' })), { driverId: '', roles: ['driver'] })
  assert.deepEqual(pushSubscriptionFilterPlan(normalizeNotice({ title: 'A', targetRole: 'admin' })), { driverId: '', roles: ['admin', 'dispatcher'] })
  assert.deepEqual(pushSubscriptionFilterPlan(normalizeNotice({ title: 'A', targetRole: 'all' })), { driverId: '', roles: null })
})

test('subscriptionsForNotice applies database filters before in-memory recipient checks', async () => {
  const { calls, supabase } = supabaseQueryMock([
    { id: 'p1', driver_id: 'drv_1', role: 'driver', active: true },
    { id: 'p2', driver_id: 'drv_2', role: 'driver', active: true },
  ])

  const recipients = await subscriptionsForNotice(supabase, normalizeNotice({ title: 'A', targetDriverId: 'drv_1' }))

  assert.deepEqual(recipients.map((row) => row.id), ['p1'])
  assert.deepEqual(calls.filter(([method]) => method === 'eq'), [
    ['eq', 'active', true],
    ['eq', 'driver_id', 'drv_1'],
  ])
})

test('subscriptionsForNotice uses role filters for staff recipients', async () => {
  const { calls, supabase } = supabaseQueryMock([
    { id: 'admin', role: 'admin', active: true },
    { id: 'dispatcher', role: 'dispatcher', active: true },
    { id: 'driver', role: 'driver', active: true },
  ])

  const recipients = await subscriptionsForNotice(supabase, normalizeNotice({ title: 'A', targetRole: 'admin' }))

  assert.deepEqual(recipients.map((row) => row.id), ['admin', 'dispatcher'])
  assert.deepEqual(calls.find(([method]) => method === 'in'), ['in', 'role', ['admin', 'dispatcher']])
})

test('rate limit keys are scoped and sanitized', () => {
  assert.equal(rateLimitKeyForProfile('delivery', { id: 'User 1/ABC', role: 'Admin' }), 'push:delivery:admin:user_1_abc')
})

test('in-memory fallback rate limiter uses weighted counts', () => {
  const key = `test:${Date.now()}:${Math.random()}`

  assert.equal(checkRateLimit(key, 2, 3, 60_000).ok, true)
  const blocked = checkRateLimit(key, 2, 3, 60_000)

  assert.equal(blocked.ok, false)
  assert.equal(blocked.retryAfter >= 1, true)
})

test('push rate limiter uses durable Supabase RPC when available', async () => {
  const calls = []
  const result = await checkPushRateLimit({
    async rpc(name, params) {
      calls.push([name, params])
      return { data: [{ ok: false, retry_after: 12 }], error: null }
    },
  }, 'push:request:admin:user_1', 4, 10, 120_000)

  assert.deepEqual(calls, [[
    'rb_check_push_rate_limit',
    {
      bucket_key: 'push:request:admin:user_1',
      weight: 4,
      max_count: 10,
      window_seconds: 120,
    },
  ]])
  assert.deepEqual(result, { ok: false, retryAfter: 12 })
})

test('push rate limiter falls back locally if durable RPC is unavailable', async () => {
  const key = `fallback:${Date.now()}:${Math.random()}`
  const supabase = {
    async rpc() {
      return { data: null, error: new Error('missing function') }
    },
  }

  assert.equal((await checkPushRateLimit(supabase, key, 2, 3, 60_000)).ok, true)
  assert.equal((await checkPushRateLimit(supabase, key, 2, 3, 60_000)).ok, false)
})

test('pushDeliveryLogRows aggregates per-notification delivery results', () => {
  const rows = pushDeliveryLogRows([
    { notice: normalizeNotice({ id: 'n1', title: 'A', targetRole: 'driver_all', type: 'staff-message' }), recipients: [{ id: 'p1' }, { id: 'p2' }] },
  ], [
    { id: 'p1', noticeId: 'n1', ok: true },
    { id: 'p2', noticeId: 'n1', ok: false, statusCode: 410, error: 'Gone' },
  ], { id: 'staff_1' }, new Date('2026-05-18T12:00:00.000Z'))

  assert.equal(rows.length, 1)
  assert.equal(rows[0].notification_id, 'n1')
  assert.equal(rows[0].notification_type, 'staff-message')
  assert.equal(rows[0].target_role, 'driver_all')
  assert.equal(rows[0].requested_by, 'staff_1')
  assert.equal(rows[0].recipients, 2)
  assert.equal(rows[0].sent, 1)
  assert.equal(rows[0].failed, 1)
  assert.equal(rows[0].ok, false)
  assert.equal(rows[0].error, 'Gone')
  assert.equal(rows[0].created_at, '2026-05-18T12:00:00.000Z')
})

test('recordPushDeliveryLogs is tolerant when delivery log table is unavailable', async () => {
  const calls = []
  const result = await recordPushDeliveryLogs({
    from(table) {
      calls.push(['from', table])
      return {
        async insert(rows) {
          calls.push(['insert', rows.length])
          return { error: new Error('relation "push_delivery_logs" does not exist') }
        },
      }
    },
  }, [{ id: 'log_1', notification_id: 'ntf_1' }])

  assert.deepEqual(calls, [['from', 'push_delivery_logs'], ['insert', 1]])
  assert.equal(result.ok, false)
  assert.match(result.error, /push_delivery_logs/)
})
