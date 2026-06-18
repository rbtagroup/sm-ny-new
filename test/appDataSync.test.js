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

function fakeSyncSupabase(updatedRows = [{ id: 'sh_1' }]) {
  const updates = []
  const upserts = []
  const rpcs = []
  return {
    updates,
    upserts,
    rpcs,
    from(table) {
      return {
        update(patch) {
          const call = { table, patch, filters: [] }
          updates.push(call)
          return {
            eq(column, value) {
              call.filters.push({ column, value })
              return {
                select() {
                  return Promise.resolve({ data: updatedRows, error: null })
                },
              }
            },
          }
        },
        upsert(rows) {
          upserts.push({ table, rows })
          return Promise.resolve({ error: null })
        },
        delete() {
          return { in: () => Promise.resolve({ error: null }) }
        },
      }
    },
    rpc(fn, args) {
      rpcs.push({ fn, args })
      return Promise.resolve({ error: null })
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

test('syncChangedRows persists an own driver shift confirmation', async () => {
  const supabase = fakeSyncSupabase()
  const { syncChangedRows } = createAppDataSync({
    supabase,
    isConfiguredSupabase: true,
    timePart: () => '',
    sendPushForNotifications: async () => ({ skipped: true }),
  })
  const prev = {
    drivers: [{ id: 'drv_1', profileId: 'profile_1', email: 'driver@example.test' }],
    shifts: [{ id: 'sh_1', date: '2026-05-22', start: '19:00', end: '07:00', driverId: 'drv_1', status: 'assigned' }],
  }
  const next = {
    ...prev,
    shifts: [{ ...prev.shifts[0], status: 'confirmed' }],
  }

  await syncChangedRows(prev, next, { id: 'profile_1', email: 'driver@example.test', role: 'driver' })

  assert.equal(supabase.updates.length, 1)
  assert.equal(supabase.updates[0].table, 'shifts')
  assert.equal(supabase.updates[0].filters[0].value, 'sh_1')
  assert.equal(supabase.updates[0].patch.status, 'confirmed')
})

test('syncChangedRows rejects driver shift changes when the profile is not linked to that shift', async () => {
  const supabase = fakeSyncSupabase()
  const { syncChangedRows } = createAppDataSync({
    supabase,
    isConfiguredSupabase: true,
    timePart: () => '',
    sendPushForNotifications: async () => ({ skipped: true }),
  })
  const prev = {
    drivers: [{ id: 'drv_1', profileId: 'profile_1', email: 'driver@example.test' }],
    shifts: [{ id: 'sh_1', date: '2026-05-22', start: '19:00', end: '07:00', driverId: 'drv_1', status: 'assigned' }],
  }
  const next = {
    ...prev,
    shifts: [{ ...prev.shifts[0], status: 'confirmed' }],
  }

  await assert.rejects(
    syncChangedRows(prev, next, { id: 'profile_2', email: 'other@example.test', role: 'driver' }),
    /nelze uložit pro aktuálního řidiče/,
  )
  assert.equal(supabase.updates.length, 0)
})

test('syncChangedRows sends new staff messages through the notification RPC', async () => {
  const supabase = fakeSyncSupabase()
  const { syncChangedRows } = createAppDataSync({
    supabase,
    isConfiguredSupabase: true,
    timePart: () => '',
    sendPushForNotifications: async () => ({ skipped: true }),
  })
  const notice = {
    id: 'ntf_staff_message',
    at: '2026-06-18T08:00:00.000Z',
    title: 'Provozní zpráva',
    body: 'Přijeďte o deset minut dřív.',
    targetDriverId: '',
    targetRole: 'driver_all',
    type: 'staff-message',
    readBy: [],
    deletedBy: [],
  }

  await syncChangedRows(
    { notifications: [] },
    { notifications: [notice] },
    { id: 'profile_dispatcher', role: 'dispatcher' },
  )

  assert.equal(supabase.rpcs.length, 1)
  assert.equal(supabase.rpcs[0].fn, 'rb_insert_notifications')
  assert.equal(supabase.rpcs[0].args.p_notifications[0].id, notice.id)
  assert.equal(supabase.rpcs[0].args.p_notifications[0].target_role, 'driver_all')
  assert.equal(supabase.upserts.some((call) => call.table === 'notifications'), false)
})
