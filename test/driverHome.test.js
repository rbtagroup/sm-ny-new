import test from 'node:test'
import assert from 'node:assert/strict'
import { driverShiftIsDashboardVisible, selectDriverHomeState } from '../src/lib/driverHome.js'

const driver = { id: 'drv_1', name: 'Jiří Dostál' }
const baseShift = {
  date: '2026-05-18',
  start: '09:00',
  end: '17:00',
  status: 'confirmed',
  vehicleId: 'veh_1',
}

test('selectDriverHomeState builds the driver dashboard model', () => {
  const data = {
    drivers: [driver, { id: 'drv_2', name: 'Kolega' }, { id: 'drv_3', name: 'Neaktivní', active: false }],
    shifts: [
      { ...baseShift, id: 'today', status: 'assigned', driverId: driver.id },
      { ...baseShift, id: 'old', date: '2026-05-10', driverId: driver.id },
      { ...baseShift, id: 'open', date: '2026-05-19', status: 'open', driverId: '' },
      { ...baseShift, id: 'swap-shift', date: '2026-05-20', driverId: 'drv_2' },
      { ...baseShift, id: 'foreign', driverId: 'drv_2' },
    ],
    swapRequests: [
      { id: 'incoming', shiftId: 'swap-shift', driverId: 'drv_2', targetMode: 'driver', targetDriverId: driver.id, status: 'pending' },
      { id: 'interest', shiftId: 'open', driverId: driver.id, targetMode: 'open', status: 'pending' },
      { id: 'rejected', shiftId: 'swap-shift', driverId: 'drv_2', targetMode: 'driver', targetDriverId: driver.id, status: 'rejected' },
    ],
  }

  const state = selectDriverHomeState(data, {
    currentDriver: driver,
    actionDialog: { requestId: 'incoming' },
    swapDraft: { shiftId: 'today' },
    nowTs: new Date('2026-05-18T08:00:00').getTime(),
    today: '2026-05-18',
  })

  assert.deepEqual(state.shifts.map((shift) => shift.id), ['today'])
  assert.deepEqual(state.openShifts.map((shift) => shift.id), ['open'])
  assert.deepEqual(state.myOpenInterests.map((request) => request.id), ['interest'])
  assert.deepEqual(state.incomingSwaps.map((item) => item.request.id), ['incoming'])
  assert.deepEqual(state.swapColleagues.map((item) => item.id), ['drv_2'])
  assert.equal(state.swapShift.id, 'today')
  assert.equal(state.actionRequest.id, 'incoming')
  assert.equal(state.actionShift.id, 'swap-shift')
  assert.equal(state.focus.id, 'today')
})

test('driverShiftIsDashboardVisible keeps only actionable closed-shift cases', () => {
  const nowTs = new Date('2026-05-18T08:00:00').getTime()
  const completed = { ...baseShift, id: 'completed', date: '2026-05-17', driverId: driver.id, status: 'completed', actualEndAt: '2026-05-17T17:00:00.000Z' }

  assert.equal(driverShiftIsDashboardVisible(completed, { data: { shifts: [completed], settlements: [] }, currentDriver: driver, nowTs, today: '2026-05-18' }), true)
  assert.equal(driverShiftIsDashboardVisible(completed, { data: { shifts: [completed], settlements: [{ shiftId: 'completed', status: 'approved' }] }, currentDriver: driver, nowTs, today: '2026-05-18' }), false)
  assert.equal(driverShiftIsDashboardVisible({ ...completed, id: 'declined', status: 'declined' }, { data: {}, currentDriver: driver, nowTs, today: '2026-05-18' }), false)
})
