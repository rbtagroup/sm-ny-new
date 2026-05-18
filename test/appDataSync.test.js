import test from 'node:test'
import assert from 'node:assert/strict'
import { createAppDataSync } from '../src/lib/appDataSync.js'

function fakeQuery(result, settingsResult = null) {
  return {
    order() { return this },
    gte() { return this },
    eq() { return this },
    maybeSingle() { return Promise.resolve(settingsResult || { data: null, error: null }) },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject)
    },
  }
}

function fakeSupabase(rowsByTable = {}, settingsPayload = {}) {
  return {
    from(table) {
      return {
        select() {
          if (table === 'app_settings') {
            return fakeQuery({ data: [], error: null }, { data: { payload: settingsPayload }, error: null })
          }
          return fakeQuery({ data: rowsByTable[table] || [], error: null })
        },
      }
    },
  }
}

test('loadDataFromSupabase maps rows and clears stale shift swap status', async () => {
  const supabase = fakeSupabase({
    drivers: [{ id: 'drv_1', profile_id: 'profile_1', name: 'Roman', active: true }],
    vehicles: [{ id: 'car_1', name: 'Tesla', plate: 'RB 001', active: true }],
    shifts: [{
      id: 'sh_1',
      shift_date: '2026-05-18',
      start_time: '07:00',
      end_time: '19:00',
      driver_id: 'drv_1',
      vehicle_id: 'car_1',
      type: 'day',
      status: 'confirmed',
      swap_request_status: 'pending',
    }, {
      id: 'sh_2',
      shift_date: '2026-05-19',
      start_time: '19:00',
      end_time: '07:00',
      driver_id: 'drv_1',
      vehicle_id: 'car_1',
      type: 'night',
      status: 'confirmed',
      swap_request_status: '',
    }],
    swap_requests: [{
      id: 'swap_1',
      shift_id: 'sh_2',
      driver_id: 'drv_1',
      target_mode: 'all',
      status: 'accepted',
      created_at: '2026-05-18T10:00:00.000Z',
    }],
  }, { companyName: 'TESTSHIFT' })

  const { loadDataFromSupabase } = createAppDataSync({
    supabase,
    isConfiguredSupabase: true,
    timePart: () => '',
    sendPushForNotifications: async () => ({ skipped: true }),
  })
  const data = await loadDataFromSupabase()

  assert.equal(data.settings.companyName, 'TESTSHIFT')
  assert.equal(data.drivers[0].name, 'Roman')
  assert.equal(data.shifts.find((shift) => shift.id === 'sh_1').swapRequestStatus, '')
  assert.equal(data.shifts.find((shift) => shift.id === 'sh_2').swapRequestStatus, 'accepted')
})
