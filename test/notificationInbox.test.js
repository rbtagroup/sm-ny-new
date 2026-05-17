import test from 'node:test'
import assert from 'node:assert/strict'
import {
  markInboxNotificationsDeleted,
  markInboxNotificationsRead,
  notificationInboxState,
  notificationTargetLabel,
  restoreInboxNotifications,
} from '../src/lib/notificationInbox.js'
import { isNoticeDeleted, isNoticeRead } from '../src/lib/notifications.js'

const driver = { id: 'drv_1' }

test('notificationInboxState returns sorted visible notices with shared unread counts and groups', () => {
  const data = {
    swapRequests: [],
    notifications: [
      { id: 'old', at: '2026-05-15T10:00:00.000Z', title: 'Old', targetDriverId: driver.id, targetRole: 'driver', readBy: [], deletedBy: [] },
      { id: 'other-driver', at: '2026-05-18T11:00:00.000Z', title: 'Hidden', targetDriverId: 'drv_2', targetRole: 'driver', readBy: [], deletedBy: [] },
      { id: 'yesterday', at: '2026-05-17T09:00:00.000Z', title: 'Yesterday', targetDriverId: driver.id, targetRole: 'driver', readBy: ['driver:drv_1'], deletedBy: [] },
      { id: 'today', at: '2026-05-18T08:00:00.000Z', title: 'Today', targetDriverId: driver.id, targetRole: 'driver', readBy: [], deletedBy: [] },
    ],
  }

  const state = notificationInboxState(data, { currentDriver: driver, isDriver: true }, new Date('2026-05-18T12:00:00.000Z'))

  assert.deepEqual(state.visible.map((notice) => notice.id), ['today', 'yesterday', 'old'])
  assert.deepEqual(state.unread.map((notice) => notice.id), ['today', 'old'])
  assert.deepEqual(state.groups.map(([label, items]) => [label, items.map((notice) => notice.id)]), [
    ['Dnes', ['today']],
    ['Včera', ['yesterday']],
    ['Starší', ['old']],
  ])
  assert.equal(state.hasRead, true)
})

test('notification inbox keeps stale swap offers out of driver counts', () => {
  const notice = { id: 'swap-offer', at: '2026-05-18T08:00:00.000Z', title: 'Swap', targetDriverId: driver.id, targetRole: 'driver', type: 'swap-offer', shiftId: 'sh_1', readBy: [], deletedBy: [] }
  const request = { id: 'swap_1', shiftId: 'sh_1', driverId: 'drv_2', targetMode: 'driver', targetDriverId: driver.id, status: 'pending' }

  const pending = notificationInboxState({ notifications: [notice], swapRequests: [request] }, { currentDriver: driver, isDriver: true })
  const rejected = notificationInboxState({ notifications: [notice], swapRequests: [{ ...request, status: 'rejected' }] }, { currentDriver: driver, isDriver: true })

  assert.deepEqual(pending.visible.map((item) => item.id), ['swap-offer'])
  assert.deepEqual(rejected.visible, [])
})

test('notification inbox mutations are scoped to the current recipient', () => {
  const notice = { id: 'n1', title: 'Notice', targetRole: 'admin', readBy: [], deletedBy: [] }
  const anna = { id: 'staff_anna', role: 'admin' }
  const boris = { id: 'staff_boris', role: 'dispatcher' }

  const [read] = markInboxNotificationsRead([notice], ['n1'], { profile: anna, isDriver: false })
  const [deleted] = markInboxNotificationsDeleted([read], new Set(['n1']), { profile: anna, isDriver: false })
  const [restored] = restoreInboxNotifications([deleted], ['n1'], { profile: anna, isDriver: false })

  assert.equal(isNoticeRead(deleted, null, false, anna), true)
  assert.equal(isNoticeRead(deleted, null, false, boris), false)
  assert.equal(isNoticeDeleted(deleted, null, false, anna), true)
  assert.equal(isNoticeDeleted(restored, null, false, anna), false)
})

test('notificationTargetLabel keeps staff and driver target labels consistent', () => {
  assert.equal(notificationTargetLabel({ targetDriverId: 'drv_1' }, { driverName: () => 'Jiří Dostál' }), 'Řidič: Jiří Dostál')
  assert.equal(notificationTargetLabel({ targetRole: 'driver_all' }), 'Všichni řidiči')
  assert.equal(notificationTargetLabel({ targetRole: 'dispatcher' }), 'Dispečink')
  assert.equal(notificationTargetLabel({ targetRole: 'unknown' }), 'unknown')
})
