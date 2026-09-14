import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSwapRequest, swapApprovalDriverId } from '../src/lib/swapRequests.js'

const helpers = { driverName: (id) => ({ d1: 'Roman', d2: 'Petra' })[id] || 'Neobsazeno', vehicleName: () => 'Bez vozu' }
let counter = 0
const makeNotice = (notice) => ({ id: `ntf_${++counter}`, ...notice })
const shift = { id: 'sh1', date: '2026-09-19', start: '19:00', end: '07:00', driverId: 'd1', status: 'assigned', type: 'night' }

test('approving a swap hands the shift to the colleague who took it and confirms it', () => {
  const data = { shifts: [shift], swapRequests: [{ id: 'sw1', shiftId: 'sh1', driverId: 'd1', targetMode: 'all', acceptedByDriverId: 'd2', status: 'accepted', history: [] }], notifications: [] }
  const { data: next, message } = resolveSwapRequest(data, { requestId: 'sw1', status: 'approved', helpers, makeNotice, now: '2026-09-15T10:00:00.000Z' })
  assert.deepEqual([next.shifts[0].driverId, next.shifts[0].status, next.shifts[0].swapRequestStatus], ['d2', 'confirmed', 'approved'])
  assert.equal(next.swapRequests[0].status, 'approved')
  assert.equal(next.swapRequests[0].approvedDriverId, 'd2')
  assert.equal(next.swapRequests[0].history.at(-1).at, '2026-09-15T10:00:00.000Z')
  assert.deepEqual(next.notifications.map((notice) => notice.targetDriverId), ['d1', 'd2'])
  assert.match(message, /Petra/)
})

test('an offer to everyone cannot be approved before someone takes it, rejecting tells both drivers', () => {
  const waiting = { id: 'sw2', shiftId: 'sh1', driverId: 'd1', targetMode: 'all', acceptedByDriverId: '', targetDriverId: '', status: 'pending' }
  assert.equal(swapApprovalDriverId(waiting), '')
  const data = { shifts: [shift], swapRequests: [waiting], notifications: [] }
  assert.match(resolveSwapRequest(data, { requestId: 'sw2', status: 'approved', helpers, makeNotice }).error, /kolega/)
  const rejected = resolveSwapRequest({ ...data, swapRequests: [{ ...waiting, acceptedByDriverId: 'd2', status: 'accepted' }] }, { requestId: 'sw2', status: 'rejected', helpers, makeNotice }).data
  assert.equal(rejected.shifts[0].driverId, 'd1')
  assert.equal(rejected.swapRequests[0].rejectedReason, 'Zamítnuto adminem')
  assert.deepEqual(rejected.notifications.map((notice) => notice.targetDriverId), ['d1', 'd2'])
  assert.match(resolveSwapRequest(data, { requestId: 'missing', status: 'approved', helpers, makeNotice }).error, /neexistuje/)
})
