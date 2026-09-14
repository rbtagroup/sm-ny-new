import test from 'node:test'
import assert from 'node:assert/strict'
import { driverShiftActions, staffShiftActions, statusAfterCheckIn } from '../src/lib/shiftActions.js'

const at = (value) => new Date(value).getTime()
const shift = { id: 'sh_1', date: '2026-09-21', start: '07:00', end: '19:00', driverId: 'drv_1', status: 'confirmed' }

test('driver cannot check in to a future shift, only from an hour before start until two hours after the end', () => {
  const nextWeek = driverShiftActions(shift, { now: at('2026-09-14T08:00:00') })
  assert.equal(nextWeek.checkIn, false)
  assert.equal(nextWeek.checkInOpensAt, at('2026-09-21T06:00:00'))
  assert.equal(nextWeek.swap, true)

  assert.equal(driverShiftActions(shift, { now: at('2026-09-21T05:59:00') }).checkIn, false)
  const window = driverShiftActions(shift, { now: at('2026-09-21T06:00:00') })
  assert.equal(window.checkIn, true)
  assert.equal(window.checkInOpensAt, null)
  assert.equal(driverShiftActions(shift, { now: at('2026-09-21T21:00:00') }).checkIn, true)
  assert.equal(driverShiftActions(shift, { now: at('2026-09-21T21:01:00') }).checkIn, false)
})

test('driver actions follow the shift status and attendance', () => {
  const waiting = driverShiftActions({ ...shift, status: 'assigned' }, { now: at('2026-09-14T08:00:00') })
  assert.equal(waiting.confirm, true)
  assert.equal(driverShiftActions(shift, { now: at('2026-09-14T08:00:00') }).confirm, false)

  const running = driverShiftActions({ ...shift, actualStartAt: '2026-09-21T06:50' }, { now: at('2026-09-21T12:00:00') })
  assert.equal(running.checkIn, false)
  assert.equal(running.checkOut, true)
  assert.equal(running.decline, false)
  assert.equal(running.swap, false)

  const declined = driverShiftActions({ ...shift, status: 'declined' }, { now: at('2026-09-21T07:00:00') })
  assert.deepEqual([declined.checkIn, declined.confirm, declined.decline, declined.swap], [false, false, false, false])
  assert.equal(driverShiftActions({ ...shift, swapRequestStatus: 'pending' }, { now: at('2026-09-14T08:00:00') }).swap, false)
  assert.equal(driverShiftActions({ ...shift, swapRequestStatus: 'pending' }, { now: at('2026-09-14T08:00:00') }).cancelSwap, true)
})

test('night shift window runs past midnight', () => {
  const night = { ...shift, start: '19:00', end: '07:00' }
  assert.equal(driverShiftActions(night, { now: at('2026-09-22T06:30:00') }).checkIn, true)
  assert.equal(driverShiftActions(night, { now: at('2026-09-22T09:30:00') }).checkIn, false)
})

test('dispatch sees only actions that fit the shift', () => {
  const future = staffShiftActions(shift, { now: at('2026-09-14T08:00:00') })
  assert.equal(future.confirm, false)
  assert.equal(future.checkIn, false)
  assert.equal(future.complete, false)
  assert.equal(future.decline, true)
  assert.equal(future.cancel, true)

  const waiting = staffShiftActions({ ...shift, status: 'assigned' }, { now: at('2026-09-14T08:00:00') })
  assert.equal(waiting.confirm, true)

  const open = staffShiftActions({ ...shift, driverId: '', status: 'open' }, { now: at('2026-09-21T08:00:00') })
  assert.deepEqual([open.confirm, open.checkIn, open.complete, open.decline, open.messageDriver], [false, false, false, false, false])

  const ended = staffShiftActions(shift, { now: at('2026-09-21T20:00:00') })
  assert.equal(ended.checkIn, true)
  assert.equal(ended.complete, true)
  assert.equal(ended.ended, true)
  assert.equal(staffShiftActions(shift, { now: at('2026-09-22T08:00:00') }).checkIn, false)
  const completed = staffShiftActions({ ...shift, status: 'completed', actualStartAt: '2026-09-21T07:00', actualEndAt: '2026-09-21T19:00' }, { now: at('2026-09-21T20:00:00') })
  assert.deepEqual([completed.complete, completed.checkOut, completed.cancel, completed.settlement], [false, false, false, true])
})

test('checking in confirms a shift that still waits for the driver', () => {
  assert.equal(statusAfterCheckIn('assigned'), 'confirmed')
  assert.equal(statusAfterCheckIn('draft'), 'confirmed')
  assert.equal(statusAfterCheckIn('confirmed'), 'confirmed')
})
