import test from 'node:test'
import assert from 'node:assert/strict'
import { activeDriverPushDeviceCount, createDriverMessageNotice, driverMessageLimits } from '../src/lib/driverMessages.js'

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
