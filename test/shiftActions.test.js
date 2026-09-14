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

test('next step for dispatch follows the shift life', async () => {
  const { staffNextStep, staffShiftActions: actions } = await import('../src/lib/shiftActions.js')
  const next = (s, now, settlement = null) => staffNextStep(s, actions(s, { now: at(now), hasSettlement: Boolean(settlement) }), settlement)
  assert.equal(next({ ...shift, driverId: '', status: 'open' }, '2026-09-14T08:00:00'), 'assign')
  assert.equal(next({ ...shift, status: 'assigned' }, '2026-09-14T08:00:00'), 'confirm')
  assert.equal(next(shift, '2026-09-21T06:30:00'), 'checkIn')
  assert.equal(next({ ...shift, actualStartAt: '2026-09-21T06:50' }, '2026-09-21T12:00:00'), 'checkOut')
  assert.equal(next(shift, '2026-09-21T20:00:00'), 'complete')
  assert.equal(next({ ...shift, status: 'completed', actualStartAt: '2026-09-21T07:00', actualEndAt: '2026-09-21T19:00' }, '2026-09-21T20:00:00'), 'settlement')
  assert.equal(next({ ...shift, status: 'completed', actualStartAt: '2026-09-21T07:00', actualEndAt: '2026-09-21T19:00' }, '2026-09-21T20:00:00', { status: 'approved' }), '')
  assert.equal(next(shift, '2026-09-14T08:00:00'), '')
})

test('action list offers only fitting actions and keeps destructive ones last', async () => {
  const { staffActionItems, staffShiftActions: actions } = await import('../src/lib/shiftActions.js')
  const all = ['assign', 'confirm', 'checkIn', 'checkOut', 'settlement', 'complete', 'edit', 'message', 'duplicate', 'decline', 'cancel', 'delete']
  const future = staffActionItems(shift, actions(shift, { now: at('2026-09-14T08:00:00') }), null, all)
  assert.deepEqual(future.map((item) => item.key), ['edit', 'message', 'duplicate', 'decline', 'cancel', 'delete'])
  assert.deepEqual(future.filter((item) => item.tone === 'danger').map((item) => item.key), ['decline', 'cancel', 'delete'])
  const open = staffActionItems({ ...shift, driverId: '', status: 'open' }, actions({ ...shift, driverId: '', status: 'open' }, { now: at('2026-09-14T08:00:00') }), null, ['assign', 'edit', 'message', 'delete'])
  assert.deepEqual(open.map((item) => item.key), ['assign', 'edit', 'delete'])
  const done = { ...shift, status: 'completed', actualStartAt: '2026-09-21T07:00', actualEndAt: '2026-09-21T19:00' }
  const settlementItem = staffActionItems(done, actions(done, { now: at('2026-09-21T20:00:00'), hasSettlement: true }), { status: 'draft' }, all).find((item) => item.key === 'settlement')
  assert.equal(settlementItem.label, 'Otevřít výčetku')
})

test('shift progress marks finished steps and the current one', async () => {
  const { shiftProgress } = await import('../src/lib/shiftActions.js')
  const states = (s, settlement) => shiftProgress(s, settlement).steps.map((step) => `${step.label}:${step.state}`)
  assert.deepEqual(states({ ...shift, driverId: '', status: 'open' }), ['Obsazeno:current', 'Potvrzeno:todo', 'Nástup:todo', 'Konec:todo', 'Výčetka:todo'])
  assert.deepEqual(states({ ...shift, status: 'assigned' }), ['Obsazeno:done', 'Potvrzeno:current', 'Nástup:todo', 'Konec:todo', 'Výčetka:todo'])
  assert.deepEqual(states({ ...shift, actualStartAt: '2026-09-21T07:00' }), ['Obsazeno:done', 'Potvrzeno:done', 'Nástup:done', 'Konec:current', 'Výčetka:todo'])
  assert.deepEqual(states({ ...shift, status: 'completed' }, { status: 'submitted' }), ['Obsazeno:done', 'Potvrzeno:done', 'Nástup:done', 'Konec:done', 'Ke schválení:current'])
  assert.deepEqual(states({ ...shift, status: 'completed' }, { status: 'approved' }), ['Obsazeno:done', 'Potvrzeno:done', 'Nástup:done', 'Konec:done', 'Výčetka:done'])
  assert.deepEqual(shiftProgress({ ...shift, status: 'declined' }), { closed: 'declined', steps: [] })
})

test('a declined shift offers finding a replacement as the next step', async () => {
  const { staffActionItems, staffNextStep, staffShiftActions: actions } = await import('../src/lib/shiftActions.js')
  const declined = { ...shift, status: 'declined', declineReason: 'nemoc' }
  const can = actions(declined, { now: at('2026-09-14T08:00:00') })
  assert.equal(staffNextStep(declined, can), 'reassign')
  const items = staffActionItems(declined, can, null, ['assign', 'reassign', 'edit', 'delete'])
  assert.deepEqual(items.map((item) => item.key), ['reassign', 'edit', 'delete'])
  assert.equal(items[0].label, 'Najít náhradu')
})
