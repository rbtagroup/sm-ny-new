import test from 'node:test'
import assert from 'node:assert/strict'
import {
  activeDriverPushDeviceCount,
  createDriverMessageNotice,
  driverMessageDeliveryLabel,
  driverMessageHistory,
  driverMessageLimits,
  driverMessageReadCount,
  driverMessageTargetDeviceCount,
  latestDriverMessageDeliveryLog,
} from '../src/lib/driverMessages.js'

const makeNotice = (input) => ({ id: 'ntf_1', ...input, targetRole: input.targetDriverId ? 'driver' : input.targetRole })

test('createDriverMessageNotice builds all-driver push notification', () => {
  const { notice, error } = createDriverMessageNotice(makeNotice, {
    targetMode: 'driver_all',
    title: 'Provoz',
    body: 'Zítra prosím přijďte o 10 minut dřív.',
  })

  assert.equal(error, undefined)
  assert.equal(notice.targetRole, 'driver_all')
  assert.equal(notice.targetDriverId, '')
  assert.equal(notice.type, 'staff-message')
})

test('createDriverMessageNotice builds concrete driver notification', () => {
  const { notice } = createDriverMessageNotice(makeNotice, {
    targetMode: 'driver',
    targetDriverId: 'drv_1',
    title: 'Auto',
    body: 'Vezmi dnes prosím Dacii.',
  })

  assert.equal(notice.targetRole, 'driver')
  assert.equal(notice.targetDriverId, 'drv_1')
})

test('createDriverMessageNotice validates required and bounded fields', () => {
  assert.equal(createDriverMessageNotice(makeNotice, { title: '', body: 'x' }).error, 'Vyplň titulek zprávy.')
  assert.equal(createDriverMessageNotice(makeNotice, { title: 'x', body: '' }).error, 'Vyplň text zprávy.')
  assert.equal(createDriverMessageNotice(makeNotice, { targetMode: 'driver', title: 'x', body: 'y' }).error, 'Vyber řidiče.')
  assert.equal(createDriverMessageNotice(makeNotice, { title: 'x'.repeat(driverMessageLimits.title + 1), body: 'y' }).error, `Titulek může mít maximálně ${driverMessageLimits.title} znaků.`)
})

test('activeDriverPushDeviceCount counts active driver devices by target', () => {
  const data = {
    pushSubscriptions: [
      { id: 'a', active: true, role: 'driver', driverId: 'drv_1' },
      { id: 'b', active: true, role: 'driver', driverId: 'drv_1' },
      { id: 'c', active: false, role: 'driver', driverId: 'drv_1' },
      { id: 'd', active: true, role: 'driver', driverId: 'drv_2' },
      { id: 'e', active: true, role: 'admin', driverId: '' },
    ],
  }

  assert.equal(activeDriverPushDeviceCount(data, { targetMode: 'driver_all' }), 3)
  assert.equal(activeDriverPushDeviceCount(data, { targetMode: 'driver', targetDriverId: 'drv_1' }), 2)
})

test('driverMessageHistory returns sent staff messages newest first', () => {
  const data = {
    notifications: [
      { id: 'info', type: 'info', at: '2026-05-18T10:00:00.000Z' },
      { id: 'old', type: 'staff-message', at: '2026-05-18T09:00:00.000Z' },
      { id: 'new', type: 'staff-message', at: '2026-05-18T11:00:00.000Z' },
    ],
  }

  assert.deepEqual(driverMessageHistory(data).map((message) => message.id), ['new', 'old'])
})

test('driverMessageTargetDeviceCount and read count summarize message history', () => {
  const data = {
    pushSubscriptions: [
      { id: 'a', active: true, role: 'driver', driverId: 'drv_1' },
      { id: 'b', active: false, role: 'driver', driverId: 'drv_1' },
      { id: 'c', active: true, role: 'driver', driverId: 'drv_2' },
    ],
  }
  const message = { targetDriverId: 'drv_1', readBy: ['driver:drv_1', 'driver:drv_1', 'staff:admin'] }

  assert.equal(driverMessageTargetDeviceCount(data, message), 1)
  assert.equal(driverMessageReadCount(message), 1)
})

test('driverMessageDeliveryLabel prefers persisted delivery logs', () => {
  const message = { id: 'msg_1', targetRole: 'driver_all' }
  const data = {
    pushSubscriptions: [{ id: 'a', active: true, role: 'driver', driverId: 'drv_1' }],
    pushDeliveryLogs: [
      { id: 'old', notificationId: 'msg_1', recipients: 1, sent: 1, failed: 0, createdAt: '2026-05-18T10:00:00.000Z' },
      { id: 'new', notificationId: 'msg_1', recipients: 2, sent: 1, failed: 1, createdAt: '2026-05-18T11:00:00.000Z', error: 'gone' },
    ],
  }

  assert.equal(latestDriverMessageDeliveryLog(data, message).id, 'new')
  assert.equal(driverMessageDeliveryLabel(data, message), '1/2 push · 1 chyba')
})
