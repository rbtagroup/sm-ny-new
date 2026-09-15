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

test('driver home picks the one next step: running, settlement, check-in, confirmation or the next shift', async () => {
  const { driverNowState } = await import('../src/lib/driverHome.js')
  const at = (value) => new Date(value).getTime()
  const shift = (id, patch) => ({ ...baseShift, id, driverId: driver.id, ...patch })
  const now = (shifts, when, settlements = []) => driverNowState({ drivers: [driver], shifts, settlements }, { currentDriver: driver, nowTs: at(when), today: when.slice(0, 10) })

  const future = shift('future', { date: '2026-05-20', status: 'confirmed' })
  assert.deepEqual([now([future], '2026-05-18T08:00:00').kind, now([future], '2026-05-18T08:00:00').shift.id], ['next', 'future'])
  const waiting = shift('waiting', { date: '2026-05-19', status: 'assigned' })
  assert.equal(now([future, waiting], '2026-05-18T08:00:00').kind, 'confirm')
  // an hour before the start the check-in wins over confirming anything else
  const today = shift('today', { status: 'assigned' })
  assert.deepEqual([now([waiting, today], '2026-05-18T08:05:00').kind, now([waiting, today], '2026-05-18T08:05:00').shift.id], ['checkIn', 'today'])
  assert.equal(now([shift('running', { actualStartAt: '2026-05-18T09:02' }), waiting], '2026-05-18T12:00:00').kind, 'running')
  const ended = shift('ended', { status: 'completed', actualStartAt: '2026-05-18T09:00', actualEndAt: '2026-05-18T17:00' })
  assert.equal(now([ended, waiting], '2026-05-18T17:30:00').kind, 'settlement')
  assert.equal(now([ended], '2026-05-18T17:30:00', [{ id: 's1', shiftId: 'ended', status: 'returned' }]).settlement.status, 'returned')
  assert.equal(now([ended], '2026-05-18T17:30:00', [{ id: 's1', shiftId: 'ended', status: 'submitted' }]).kind, 'idle')
})

test('start and end labels read naturally', async () => {
  const { driverDayLabel, endsInLabel, startsInLabel } = await import('../src/lib/driverHome.js')
  const at = (value) => new Date(value).getTime()
  const shift = { ...baseShift, date: '2026-05-18', start: '09:00', end: '17:00' }
  assert.equal(startsInLabel(shift, at('2026-05-18T08:35:00'), '2026-05-18'), 'nástup za 25 min')
  assert.equal(startsInLabel(shift, at('2026-05-18T05:50:00'), '2026-05-18'), 'nástup za 3 h 10 min')
  assert.equal(startsInLabel(shift, at('2026-05-18T01:00:00'), '2026-05-18'), 'za 8 h')
  assert.equal(startsInLabel(shift, at('2026-05-17T12:00:00'), '2026-05-17'), 'za 21 h')
  assert.equal(startsInLabel(shift, at('2026-05-15T12:00:00'), '2026-05-15'), 'za 3 dny')
  assert.equal(startsInLabel(shift, at('2026-05-11T12:00:00'), '2026-05-11'), 'za 7 dní')
  assert.equal(startsInLabel(shift, at('2026-05-18T09:10:00'), '2026-05-18'), 'začala před 10 min')
  assert.equal(endsInLabel(shift, at('2026-05-18T15:40:00')), 'končí za 1 h 20 min')
  assert.equal(endsInLabel(shift, at('2026-05-18T17:15:00')), 'měla skončit před 15 min')
  assert.equal(driverDayLabel('2026-05-19', '2026-05-18'), 'Zítra')
})
