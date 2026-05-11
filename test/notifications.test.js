import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createNoticeFactory,
  isNoticeDeleted,
  isNoticeRead,
  isNoticeVisible,
  markNoticeDeleted,
  markNoticeRead,
  unmarkNoticeDeleted,
} from '../src/lib/notifications.js'

const driver = { id: 'drv_1' }
const makeNotice = createNoticeFactory((prefix) => `${prefix}_1`)

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
