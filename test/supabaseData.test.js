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
