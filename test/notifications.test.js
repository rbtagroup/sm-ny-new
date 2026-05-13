import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createNoticeFactory,
  isNoticeDeleted,
  isNoticeRead,
  isNoticeVisible,
  isNoticeVisibleInInbox,
  markNoticeDeleted,
  markNoticeRead,
  unmarkNoticeDeleted,
} from '../src/lib/notifications.js'

const driver = { id: 'drv_1' }
const makeNotice = createNoticeFactory((prefix) => `${prefix}_1`)

test('driver-targeted notices default to driver target role', () => {
  const notice = makeNotice({ title: 'Test', targetDriverId: driver.id })
  const adminNotice = makeNotice({ title: 'Admin' })

  assert.equal(notice.targetRole, 'driver')
  assert.equal(adminNotice.targetRole, 'admin')
})

test('read and deleted state are tracked separately', () => {
  const notice = makeNotice({ title: 'Test', targetDriverId: driver.id })
  const read = markNoticeRead(notice, driver, true)
  const deleted = markNoticeDeleted(read, driver, true)

  assert.equal(isNoticeRead(deleted, driver, true), true)
  assert.equal(isNoticeDeleted(deleted, driver, true), true)
  assert.equal(isNoticeVisible(deleted, driver, true), false)
  assert.deepEqual(deleted.readBy, ['driver:drv_1'])
  assert.deepEqual(deleted.deletedBy, ['driver:drv_1'])
})

test('legacy deleted readBy tokens are still hidden and can be undone', () => {
  const legacy = {
    id: 'ntf_legacy',
    targetDriverId: driver.id,
    targetRole: 'driver',
    readBy: ['deleted:driver:drv_1:2026-05-11T10:00:00.000Z'],
    deletedBy: [],
  }

  assert.equal(isNoticeDeleted(legacy, driver, true), true)
  assert.equal(isNoticeDeleted(unmarkNoticeDeleted(legacy, driver, true), driver, true), false)
})

test('driver inbox hides stale swap offer notifications after the request is no longer pending', () => {
  const notice = {
    id: 'ntf_swap',
    targetDriverId: driver.id,
    targetRole: 'driver',
    type: 'swap-offer',
    shiftId: 'sh_1',
    readBy: [],
    deletedBy: [],
  }
  const pendingRequest = {
    id: 'swap_1',
    shiftId: 'sh_1',
    driverId: 'drv_2',
    targetMode: 'driver',
    targetDriverId: driver.id,
    status: 'pending',
  }

  assert.equal(isNoticeVisibleInInbox(notice, driver, true, [pendingRequest]), true)
  assert.equal(isNoticeVisibleInInbox(notice, driver, true, [{ ...pendingRequest, status: 'rejected' }]), false)
  assert.equal(isNoticeVisibleInInbox(notice, driver, true, [{ ...pendingRequest, status: 'accepted' }]), false)
})

test('driver inbox keeps result notifications even without an active swap request', () => {
  const notice = {
    id: 'ntf_rejected',
    targetDriverId: driver.id,
    targetRole: 'driver',
    type: 'swap-rejected',
    shiftId: 'sh_1',
    readBy: [],
    deletedBy: [],
  }

  assert.equal(isNoticeVisibleInInbox(notice, driver, true, []), true)
})
