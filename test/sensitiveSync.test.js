import test from 'node:test'
import assert from 'node:assert/strict'
import { auditInsertRpcCalls, notificationStateRpcCalls, staffSwapResolutionRpcCalls, swapRequestRpcCalls } from '../src/lib/sensitiveSync.js'

test('notificationStateRpcCalls emits only changed read/delete state for current driver', () => {
  const calls = notificationStateRpcCalls(
    [{ id: 'n1', readBy: [], deletedBy: [] }],
    [{ id: 'n1', readBy: ['driver:drv_1'], deletedBy: ['driver:drv_1'] }],
    'drv_1',
  )

  assert.deepEqual(calls, [{
    fn: 'rb_set_notification_state',
    args: { p_notification_id: 'n1', p_read: true, p_deleted: true },
  }])
})

test('swapRequestRpcCalls routes new driver request to rb_request_swap', () => {
  const { calls, denied } = swapRequestRpcCalls([], [{
    id: 'swap_1',
    shiftId: 'sh_1',
    driverId: 'drv_1',
    targetMode: 'all',
    reason: 'Nemuzu',
    history: [{ at: '2026-05-11T10:00:00.000Z', text: 'Nabidnuto vsem.' }],
    createdAt: '2026-05-11T10:00:00.000Z',
  }], 'drv_1')

  assert.deepEqual(denied, [])
  assert.equal(calls[0].fn, 'rb_request_swap')
  assert.equal(calls[0].args.p_id, 'swap_1')
  assert.equal(calls[0].args.p_shift_id, 'sh_1')
})

test('swapRequestRpcCalls rejects foreign inserts and accepts targeted pending swaps', () => {
  const foreignInsert = swapRequestRpcCalls([], [{ id: 'swap_bad', driverId: 'drv_2', shiftId: 'sh_1' }], 'drv_1')
  assert.deepEqual(foreignInsert.denied, ['swap_bad'])

  const accept = swapRequestRpcCalls([{
    id: 'swap_2',
    driverId: 'drv_2',
    targetMode: 'driver',
    targetDriverId: 'drv_1',
    status: 'pending',
  }], [{
    id: 'swap_2',
    driverId: 'drv_2',
    targetMode: 'driver',
    targetDriverId: 'drv_1',
    status: 'accepted',
    acceptedByDriverId: 'drv_1',
  }], 'drv_1')

  assert.deepEqual(accept.denied, [])
  assert.equal(accept.calls[0].fn, 'rb_accept_swap_request')
})

test('swapRequestRpcCalls routes targeted swap decline to rb_decline_swap_request', () => {
  const declinedAt = '2026-05-11T10:30:00.000Z'
  const { calls, denied } = swapRequestRpcCalls([{
    id: 'swap_decline',
    driverId: 'drv_2',
    targetMode: 'driver',
    targetDriverId: 'drv_1',
    status: 'pending',
  }], [{
    id: 'swap_decline',
    driverId: 'drv_2',
    targetMode: 'driver',
    targetDriverId: 'drv_1',
    status: 'rejected',
    rejectedReason: 'Odmítnuto řidičem',
    resolvedAt: declinedAt,
    history: [{ at: declinedAt, text: 'Ridic odmitl nabidku.' }],
  }], 'drv_1')

  assert.deepEqual(denied, [])
  assert.deepEqual(calls, [{
    fn: 'rb_decline_swap_request',
    args: {
      p_id: 'swap_decline',
      p_history: [{ at: declinedAt, text: 'Ridic odmitl nabidku.' }],
      p_rejected_reason: 'Odmítnuto řidičem',
      p_resolved_at: declinedAt,
    },
  }])
})

test('swapRequestRpcCalls does not let a driver reject an all-driver swap offer', () => {
  const { calls, denied } = swapRequestRpcCalls([{
    id: 'swap_all_decline',
    driverId: 'drv_2',
    targetMode: 'all',
    targetDriverId: '',
    status: 'pending',
  }], [{
    id: 'swap_all_decline',
    driverId: 'drv_2',
    targetMode: 'all',
    targetDriverId: '',
    status: 'rejected',
  }], 'drv_1')

  assert.deepEqual(calls, [])
  assert.deepEqual(denied, ['swap_all_decline'])
})

test('auditInsertRpcCalls maps local audit entries to RPC payloads', () => {
  assert.deepEqual(auditInsertRpcCalls([{ id: 'log_1', text: 'Uprava', payload: { shiftId: 'sh_1' } }]), [{
    fn: 'rb_insert_audit_log',
    args: { p_id: 'log_1', p_action: 'Uprava', p_payload: { shiftId: 'sh_1' } },
  }])
})

test('staffSwapResolutionRpcCalls resolves accepted swaps through staff RPC', () => {
  const { calls, handledIds, handledShiftIds } = staffSwapResolutionRpcCalls([{
    id: 'swap_3',
    shiftId: 'sh_3',
    driverId: 'drv_old',
    acceptedByDriverId: 'drv_new',
    status: 'accepted',
  }], [{
    id: 'swap_3',
    shiftId: 'sh_3',
    driverId: 'drv_old',
    acceptedByDriverId: 'drv_new',
    approvedDriverId: 'drv_new',
    status: 'approved',
    resolvedAt: '2026-05-11T11:00:00.000Z',
    history: [{ at: '2026-05-11T11:00:00.000Z', text: 'Schvaleno.' }],
  }])

  assert.deepEqual([...handledIds], ['swap_3'])
  assert.deepEqual([...handledShiftIds], ['sh_3'])
  assert.deepEqual(calls, [{
    fn: 'rb_resolve_swap_request',
    args: {
      p_id: 'swap_3',
      p_status: 'approved',
      p_approved_driver_id: 'drv_new',
      p_rejected_reason: null,
      p_history: [{ at: '2026-05-11T11:00:00.000Z', text: 'Schvaleno.' }],
      p_resolved_at: '2026-05-11T11:00:00.000Z',
    },
  }])
})

test('staffSwapResolutionRpcCalls leaves shift cancellation upsert available', () => {
  const { calls, handledIds, handledShiftIds } = staffSwapResolutionRpcCalls([{
    id: 'swap_4',
    shiftId: 'sh_4',
    driverId: 'drv_old',
    status: 'pending',
  }], [{
    id: 'swap_4',
    shiftId: 'sh_4',
    driverId: 'drv_old',
    status: 'cancelled',
    resolvedAt: '2026-05-11T12:00:00.000Z',
  }])

  assert.equal(calls[0].fn, 'rb_resolve_swap_request')
  assert.deepEqual([...handledIds], ['swap_4'])
  assert.deepEqual([...handledShiftIds], [])
})
