import test from 'node:test'
import assert from 'node:assert/strict'
import {
  checkRateLimit,
  matchesNotice,
  normalizeNotice,
  pushSubscriptionFilterPlan,
  rateLimitKeyForProfile,
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
