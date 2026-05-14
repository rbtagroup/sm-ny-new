import test from 'node:test'
import assert from 'node:assert/strict'
import { createSupabaseMappers } from '../src/lib/supabaseData.js'

const { toDb, fromDb } = createSupabaseMappers({
  uid: (prefix) => `${prefix}_1`,
  timePart: () => '',
})

test('notification mapper stores concrete driver targets with driver role', () => {
  const row = toDb.notifications({
    id: 'ntf_1',
    title: 'Nabídka výměny směny',
    targetDriverId: 'drv_1',
  })

  assert.equal(row.target_driver_id, 'drv_1')
  assert.equal(row.target_role, 'driver')
})

test('notification mapper normalizes existing driver-targeted rows', () => {
  const notice = fromDb.notifications({
    id: 'ntf_1',
    title: 'Nabídka výměny směny',
    target_driver_id: 'drv_1',
    target_role: 'admin',
    read_by: [],
    deleted_by: [],
  })

  assert.equal(notice.targetDriverId, 'drv_1')
  assert.equal(notice.targetRole, 'driver')
})

test('push subscription mapper preserves delivery diagnostics', () => {
  const sub = fromDb.pushSubscriptions({
    id: 'push_1',
    profile_id: 'profile_1',
    driver_id: 'drv_1',
    role: 'driver',
    endpoint: 'https://push.example/device',
    subscription: { endpoint: 'https://push.example/device' },
    active: true,
    last_seen_at: '2026-05-14T10:00:00.000Z',
    last_delivery_at: '2026-05-14T10:05:00.000Z',
    last_error: 'Gone',
    delivery_failures: 2,
  })

  assert.equal(sub.lastSeenAt, '2026-05-14T10:00:00.000Z')
  assert.equal(sub.lastDeliveryAt, '2026-05-14T10:05:00.000Z')
  assert.equal(sub.lastError, 'Gone')
  assert.equal(sub.deliveryFailures, 2)
})
