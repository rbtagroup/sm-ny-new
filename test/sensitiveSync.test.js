import test from 'node:test'
import assert from 'node:assert/strict'
import { auditInsertRpcCalls, driverPushSubscriptionRowsForSync, driverSettlementRowsForSync, driverShiftUpdatePatch, notificationStateRpcCalls, removedNotificationStateRpcCalls, staffSwapResolutionRpcCalls, swapRequestRpcCalls, swapRequestRpcCallsWithSideEffects } from '../src/lib/sensitiveSync.js'

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

test('removedNotificationStateRpcCalls hides removed driver-visible notices without physical delete', () => {
  const calls = removedNotificationStateRpcCalls([
    { id: 'own', targetDriverId: 'drv_1', readBy: ['driver:drv_1'], deletedBy: [] },
    { id: 'broadcast', targetRole: 'driver_all', readBy: [], deletedBy: [] },
    { id: 'other', targetDriverId: 'drv_2', readBy: [], deletedBy: [] },
    { id: 'already-hidden', targetDriverId: 'drv_1', readBy: [], deletedBy: ['driver:drv_1'] },
  ], ['own', 'broadcast', 'other', 'already-hidden'], 'drv_1')

  assert.deepEqual(calls, [{
    fn: 'rb_set_notification_state',
    args: { p_notification_id: 'own', p_read: null, p_deleted: true },
  }, {
    fn: 'rb_set_notification_state',
    args: { p_notification_id: 'broadcast', p_read: null, p_deleted: true },
  }])
})

test('driverShiftUpdatePatch keeps driver shift sync inside RLS guard columns', () => {
  const patch = driverShiftUpdatePatch({
    id: 'sh_1',
    shift_date: '2026-05-18',
    start_time: '07:00',
    end_time: '19:00',
    driver_id: 'drv_1',
    vehicle_id: 'car_1',
    type: 'day',
    note: 'Do not sync from driver',
    instruction: 'Do not sync from driver',
    status: 'completed',
    decline_reason: '',
    actual_start_at: '2026-05-18T07:00:00.000Z',
    actual_end_at: '2026-05-18T19:00:00.000Z',
    swap_request_status: 'cancelled',
  })

  assert.deepEqual(patch, {
    status: 'completed',
    decline_reason: '',
    actual_start_at: '2026-05-18T07:00:00.000Z',
    actual_end_at: '2026-05-18T19:00:00.000Z',
    swap_request_status: 'cancelled',
  })
})

test('driverSettlementRowsForSync excludes foreign and approved settlement rows', () => {
  assert.deepEqual(driverSettlementRowsForSync([
    { id: 'draft', driverId: 'drv_1', status: 'draft' },
    { id: 'submitted', driverId: 'drv_1', status: 'submitted' },
    { id: 'returned', driverId: 'drv_1', status: 'returned' },
    { id: 'approved', driverId: 'drv_1', status: 'approved' },
    { id: 'foreign', driverId: 'drv_2', status: 'draft' },
  ], 'drv_1').map((row) => row.id), ['draft', 'submitted', 'returned'])
})

test('driverPushSubscriptionRowsForSync keeps only current driver device rows', () => {
  assert.deepEqual(driverPushSubscriptionRowsForSync([
    { id: 'own', profileId: 'profile_1', driverId: 'drv_1', role: 'driver' },
    { id: 'staff-role', profileId: 'profile_1', driverId: 'drv_1', role: 'admin' },
    { id: 'foreign-driver', profileId: 'profile_1', driverId: 'drv_2', role: 'driver' },
    { id: 'foreign-profile', profileId: 'profile_2', driverId: 'drv_1', role: 'driver' },
  ], { profileId: 'profile_1', currentDriverId: 'drv_1' }).map((row) => row.id), ['own'])
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

test('swapRequestRpcCallsWithSideEffects bundles swap notifications and audit into one RPC', () => {
  const createdAt = '2026-05-11T10:00:00.000Z'
  const notice = { id: 'ntf_1', shiftId: 'sh_1', title: 'Nabídka', targetDriverId: 'drv_2' }
  const audit = { id: 'log_1', text: 'Řidič požádal o výměnu.' }
  const { calls, handledNotificationIds, handledAuditIds } = swapRequestRpcCallsWithSideEffects([], [{
    id: 'swap_1',
    shiftId: 'sh_1',
    driverId: 'drv_1',
    targetMode: 'driver',
    targetDriverId: 'drv_2',
    status: 'pending',
    createdAt,
  }], 'drv_1', { includeSideEffects: true, notifications: [notice], auditRows: [audit] })

  assert.equal(calls[0].fn, 'rb_request_swap_with_notifications')
  assert.equal(calls[0].args.p_shift_id, 'sh_1')
  assert.deepEqual(calls[0].args.p_notifications, [notice])
  assert.deepEqual(calls[0].args.p_audit_rows, [audit])
  assert.deepEqual([...handledNotificationIds], ['ntf_1'])
  assert.deepEqual([...handledAuditIds], ['log_1'])
})

test('swapRequestRpcCallsWithSideEffects consumes shared audit rows once', () => {
  const audit = { id: 'log_shared', text: 'Hromadná synchronizace výměn.' }
  const { calls, handledAuditIds } = swapRequestRpcCallsWithSideEffects([], [{
    id: 'swap_1',
    shiftId: 'sh_1',
    driverId: 'drv_1',
    targetMode: 'all',
    status: 'pending',
  }, {
    id: 'swap_2',
    shiftId: 'sh_2',
    driverId: 'drv_1',
    targetMode: 'all',
    status: 'pending',
  }], 'drv_1', { includeSideEffects: true, auditRows: [audit] })

  assert.deepEqual(calls.map((call) => call.args.p_audit_rows), [[audit], []])
  assert.deepEqual([...handledAuditIds], ['log_shared'])
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

test('staffSwapResolutionRpcCalls can bundle resolution side effects', () => {
  const notice = { id: 'ntf_staff', shiftId: 'sh_3', title: 'Schváleno', targetDriverId: 'drv_new' }
  const audit = { id: 'log_staff', text: 'Výměna schválena.' }
  const { calls, handledNotificationIds, handledAuditIds } = staffSwapResolutionRpcCalls([{
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
  }], { includeSideEffects: true, notifications: [notice], auditRows: [audit] })

  assert.equal(calls[0].fn, 'rb_resolve_swap_request_with_notifications')
  assert.deepEqual(calls[0].args.p_notifications, [notice])
  assert.deepEqual(calls[0].args.p_audit_rows, [audit])
  assert.deepEqual([...handledNotificationIds], ['ntf_staff'])
  assert.deepEqual([...handledAuditIds], ['log_staff'])
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
