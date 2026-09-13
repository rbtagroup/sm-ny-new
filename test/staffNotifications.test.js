import test from 'node:test'
import assert from 'node:assert/strict'
import { PENDING_DRIVER_NOTE } from '../src/lib/drivers.js'
import { splitStaffInbox, staffNoticeState } from '../src/lib/staffNotifications.js'

const today = '2026-09-14'
const data = {
  drivers: [
    { id: 'drv_new', active: false, note: PENDING_DRIVER_NOTE },
    { id: 'drv_ok', active: true, note: '' },
  ],
  shifts: [
    { id: 'sh_declined', date: today, start: '07:00', end: '19:00', driverId: 'drv_ok', status: 'declined' },
    { id: 'sh_reassigned', date: today, start: '07:00', end: '19:00', driverId: 'drv_ok', status: 'assigned' },
  ],
  swapRequests: [
    { id: 'sw_pending', shiftId: 'sh_swap_pending', status: 'pending', targetMode: 'all' },
    { id: 'sw_accepted', shiftId: 'sh_swap_accepted', status: 'accepted', targetMode: 'driver' },
    { id: 'sw_done', shiftId: 'sh_swap_done', status: 'approved', targetMode: 'all' },
    { id: 'sw_interest', shiftId: 'sh_open', status: 'pending', targetMode: 'open' },
  ],
  settlements: [
    { id: 'set_waiting', shiftId: 'sh_settle_waiting', status: 'submitted' },
    { id: 'set_approved', shiftId: 'sh_settle_done', status: 'approved' },
  ],
  settings: { coverageSlots: [{ id: 'slot_day', name: 'Denní', start: '07:00', end: '19:00', minDrivers: 1 }] },
}
const state = (notice, options = {}) => staffNoticeState({ targetRole: 'admin', ...notice }, data, { today, ...options })

test('notices sent to drivers and plain reports never wait for dispatch', () => {
  assert.equal(state({ type: 'new-shift', targetDriverId: 'drv_ok', targetRole: 'driver' }), 'sent')
  assert.equal(state({ type: 'open-shift', targetRole: 'driver_all' }), 'sent')
  for (const type of ['driver-confirmed', 'attendance-start', 'attendance-end', 'swap-cancelled', 'swap-rejected']) {
    assert.equal(state({ type }), 'info', type)
  }
})

test('action notices resolve themselves once dispatch handled the underlying item', () => {
  assert.equal(state({ type: 'driver-declined', shiftId: 'sh_declined' }), 'open')
  assert.equal(state({ type: 'driver-declined', shiftId: 'sh_reassigned' }), 'resolved')
  assert.equal(state({ type: 'driver-declined', shiftId: 'sh_deleted' }), 'resolved')

  assert.equal(state({ type: 'swap-request', shiftId: 'sh_swap_pending' }), 'open')
  assert.equal(state({ type: 'swap-request', shiftId: 'sh_swap_accepted' }), 'open')
  assert.equal(state({ type: 'swap-request', shiftId: 'sh_swap_done' }), 'resolved')
  assert.equal(state({ type: 'swap-accepted', shiftId: 'sh_swap_accepted' }), 'open')
  assert.equal(state({ type: 'swap-accepted', shiftId: 'sh_swap_pending' }), 'resolved')
  assert.equal(state({ type: 'open-shift-interest', shiftId: 'sh_open' }), 'open')
  assert.equal(state({ type: 'open-shift-interest', shiftId: 'sh_swap_pending' }), 'resolved')

  assert.equal(state({ type: 'settlement-submitted', shiftId: 'sh_settle_waiting' }), 'open')
  assert.equal(state({ type: 'settlement-submitted', shiftId: 'sh_settle_done' }), 'resolved')

  assert.equal(state({ id: 'ntf_driver_pending_drv_new', type: 'driver-signup-pending' }), 'open')
  assert.equal(state({ id: 'ntf_driver_pending_drv_ok', type: 'driver-signup-pending' }), 'resolved')
  assert.equal(state({ id: 'ntf_driver_pending_drv_gone', type: 'driver-signup-pending' }), 'resolved')
})

test('coverage notices stay open only while the next 48 hours still miss drivers', () => {
  assert.equal(state({ type: `daily-coverage:${today}` }), 'open', 'tomorrow has no shift yet')
  const covered = { ...data, shifts: [...data.shifts, { id: 'sh_tomorrow', date: '2026-09-15', start: '07:00', end: '19:00', driverId: 'drv_ok', status: 'confirmed' }] }
  assert.equal(staffNoticeState({ targetRole: 'admin', type: `daily-coverage:${today}` }, covered, { today }), 'resolved')
  assert.equal(state({ type: 'daily-coverage:2026-09-10' }), 'resolved', 'older daily notices are superseded')
})

test('other staff notices wait until they are read and the inbox splits accordingly', () => {
  assert.equal(state({ type: 'system-push-failed' }), 'open')
  assert.equal(state({ type: 'system-push-failed' }, { read: true }), 'resolved')

  const notices = [
    { id: 'a', targetRole: 'admin', type: 'swap-accepted', shiftId: 'sh_swap_accepted' },
    { id: 'b', targetRole: 'admin', type: 'swap-accepted', shiftId: 'sh_swap_accepted' },
    { id: 'c', targetRole: 'admin', type: 'driver-confirmed' },
    { id: 'd', targetRole: 'driver', targetDriverId: 'drv_ok', type: 'new-shift' },
    { id: 'e', targetRole: 'admin', type: 'info' },
  ]
  const inbox = splitStaffInbox(notices, data, { today, isRead: (notice) => ['b', 'e'].includes(notice.id) })
  assert.deepEqual(inbox.open.map((notice) => notice.id), ['a', 'b'])
  assert.deepEqual(inbox.openUnread.map((notice) => notice.id), ['a'])
  assert.deepEqual(inbox.done.map((notice) => notice.id), ['c', 'e'])
  assert.deepEqual(inbox.sent.map((notice) => notice.id), ['d'])
})
