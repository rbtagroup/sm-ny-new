const driverNoticeKey = (driverId) => `driver:${driverId || ''}`
const legacyDeletedKey = (driverId) => `deleted:${driverNoticeKey(driverId)}`

const hasState = (items = [], key) => (items || []).includes(key)
const hasLegacyDeletedState = (items = [], driverId) => {
  const key = legacyDeletedKey(driverId)
  return (items || []).some((item) => item === key || String(item).startsWith(`${key}:`))
}
const pickDefined = (row = {}, keys = []) => Object.fromEntries(keys
  .filter((key) => row[key] !== undefined)
  .map((key) => [key, row[key]]))

export function driverShiftUpdatePatch(dbShiftRow = {}) {
  return pickDefined(dbShiftRow, [
    'status',
    'decline_reason',
    'actual_start_at',
    'actual_end_at',
    'swap_request_status',
  ])
}

export function driverSettlementRowsForSync(settlements = [], currentDriverId = '') {
  if (!currentDriverId) return []
  const editableStatuses = new Set(['draft', 'submitted', 'returned'])
  return (settlements || []).filter((settlement) =>
    settlement?.driverId === currentDriverId &&
    editableStatuses.has(settlement.status || 'draft'),
  )
}

export function driverPushSubscriptionRowsForSync(pushSubscriptions = [], { profileId = '', currentDriverId = '' } = {}) {
  if (!profileId || !currentDriverId) return []
  return (pushSubscriptions || []).filter((subscription) =>
    subscription?.profileId === profileId &&
    subscription?.driverId === currentDriverId &&
    (subscription.role || 'driver') === 'driver',
  )
}

export function notificationStateRpcCalls(prevNotifications = [], changedNotifications = [], currentDriverId = '') {
  if (!currentDriverId) return []
  const previousById = new Map((prevNotifications || []).map((notice) => [notice.id, notice]))
  const key = driverNoticeKey(currentDriverId)

  return (changedNotifications || [])
    .map((notice) => {
      const before = previousById.get(notice.id)
      if (!before) return null
      const readBefore = hasState(before.readBy, key)
      const readAfter = hasState(notice.readBy, key)
      const deletedBefore = hasState(before.deletedBy, key) || hasLegacyDeletedState(before.readBy, currentDriverId)
      const deletedAfter = hasState(notice.deletedBy, key) || hasLegacyDeletedState(notice.readBy, currentDriverId)
      if (readBefore === readAfter && deletedBefore === deletedAfter) return null
      return {
        fn: 'rb_set_notification_state',
        args: {
          p_notification_id: notice.id,
          p_read: readBefore === readAfter ? null : readAfter,
          p_deleted: deletedBefore === deletedAfter ? null : deletedAfter,
        },
      }
    })
    .filter(Boolean)
}

export function removedNotificationStateRpcCalls(prevNotifications = [], removedNotificationIds = [], currentDriverId = '') {
  if (!currentDriverId) return []
  const removedIds = removedNotificationIds instanceof Set
    ? removedNotificationIds
    : new Set((removedNotificationIds || []).filter(Boolean))
  if (!removedIds.size) return []

  const key = driverNoticeKey(currentDriverId)
  const canDriverSeeNotice = (notice) =>
    notice?.targetDriverId === currentDriverId ||
    notice?.targetRole === 'all' ||
    notice?.targetRole === 'driver_all'

  return (prevNotifications || [])
    .filter((notice) => notice?.id && removedIds.has(notice.id) && canDriverSeeNotice(notice))
    .filter((notice) => !hasState(notice.deletedBy, key) && !hasLegacyDeletedState(notice.readBy, currentDriverId))
    .map((notice) => ({
      fn: 'rb_set_notification_state',
      args: {
        p_notification_id: notice.id,
        p_read: null,
        p_deleted: true,
      },
    }))
}

export function swapRequestRpcCalls(prevSwapRequests = [], changedSwapRequests = [], currentDriverId = '') {
  return swapRequestRpcCallsWithSideEffects(prevSwapRequests, changedSwapRequests, currentDriverId)
}

const sideEffectPayload = (request, options = {}) => {
  const consumedNotificationIds = options.consumedNotificationIds || new Set()
  const consumedAuditIds = options.consumedAuditIds || new Set()
  const notifications = (options.notifications || [])
    .filter((notice) => notice?.shiftId === request?.shiftId)
    .filter((notice) => !notice?.id || !consumedNotificationIds.has(notice.id))
  const auditRows = (options.auditRows || [])
    .filter((row) => !row?.id || !consumedAuditIds.has(row.id))
  return {
    p_notifications: notifications,
    p_audit_rows: auditRows,
    handledNotificationIds: notifications.map((notice) => notice.id).filter(Boolean),
    handledAuditIds: auditRows.map((row) => row.id).filter(Boolean),
  }
}

const withSideEffects = (fn, args, request, options = {}) => {
  if (!options.includeSideEffects) return { call: { fn, args }, handledNotificationIds: [], handledAuditIds: [] }
  const { handledNotificationIds, handledAuditIds, ...payload } = sideEffectPayload(request, options)
  return {
    call: {
      fn: `${fn}_with_notifications`,
      args: { ...args, ...payload },
    },
    handledNotificationIds,
    handledAuditIds,
  }
}

export function swapRequestRpcCallsWithSideEffects(prevSwapRequests = [], changedSwapRequests = [], currentDriverId = '', options = {}) {
  if (!currentDriverId) return { calls: [], denied: [] }
  const previousById = new Map((prevSwapRequests || []).map((request) => [request.id, request]))
  const calls = []
  const denied = []
  const handledNotificationIds = new Set()
  const handledAuditIds = new Set()
  const addCall = (fn, args, request) => {
    const sideEffectCall = withSideEffects(fn, args, request, { ...options, consumedNotificationIds: handledNotificationIds, consumedAuditIds: handledAuditIds })
    calls.push(sideEffectCall.call)
    sideEffectCall.handledNotificationIds.forEach((id) => handledNotificationIds.add(id))
    sideEffectCall.handledAuditIds.forEach((id) => handledAuditIds.add(id))
  }

  for (const request of changedSwapRequests || []) {
    if (!request?.id) continue
    const before = previousById.get(request.id)

    if (!before) {
      if (request.driverId !== currentDriverId) {
        denied.push(request.id)
        continue
      }
      addCall('rb_request_swap', {
        p_id: request.id,
        p_shift_id: request.shiftId,
        p_target_mode: request.targetMode || 'all',
        p_target_driver_id: request.targetDriverId || null,
        p_reason: request.reason || null,
        p_history: request.history || [],
        p_created_at: request.createdAt || null,
      }, request)
      continue
    }

    if (before.driverId === currentDriverId && request.status === 'cancelled') {
      addCall('rb_cancel_swap_request', {
        p_id: request.id,
        p_history: request.history || [],
        p_cancelled_at: request.cancelledAt || null,
      }, request)
      continue
    }

    const canAccept = before.status === 'pending' &&
      before.driverId !== currentDriverId &&
      (before.targetMode === 'all' || before.targetDriverId === currentDriverId)

    if (canAccept && request.status === 'accepted' && request.acceptedByDriverId === currentDriverId) {
      addCall('rb_accept_swap_request', {
        p_id: request.id,
        p_history: request.history || [],
        p_accepted_at: request.acceptedAt || null,
      }, request)
      continue
    }

    const canDeclineTargeted = before.status === 'pending' &&
      before.driverId !== currentDriverId &&
      before.targetMode === 'driver' &&
      before.targetDriverId === currentDriverId

    if (canDeclineTargeted && request.status === 'rejected') {
      addCall('rb_decline_swap_request', {
        p_id: request.id,
        p_history: request.history || [],
        p_rejected_reason: request.rejectedReason || null,
        p_resolved_at: request.resolvedAt || null,
      }, request)
      continue
    }

    denied.push(request.id)
  }

  return { calls, denied, handledNotificationIds, handledAuditIds }
}

export function staffSwapResolutionRpcCalls(prevSwapRequests = [], changedSwapRequests = [], options = {}) {
  const previousById = new Map((prevSwapRequests || []).map((request) => [request.id, request]))
  const calls = []
  const handledIds = new Set()
  const handledShiftIds = new Set()
  const handledNotificationIds = new Set()
  const handledAuditIds = new Set()

  for (const request of changedSwapRequests || []) {
    if (!request?.id) continue
    const before = previousById.get(request.id)
    if (!before || !['pending', 'accepted'].includes(before.status)) continue
    if (!['approved', 'rejected', 'cancelled'].includes(request.status) || request.status === before.status) continue

    const approvedDriverId = request.approvedDriverId ||
      request.acceptedByDriverId ||
      (request.targetMode === 'open' ? request.driverId : '')

    const sideEffectCall = withSideEffects('rb_resolve_swap_request', {
      p_id: request.id,
      p_status: request.status,
      p_approved_driver_id: approvedDriverId || null,
      p_rejected_reason: request.rejectedReason || null,
      p_history: request.history || [],
      p_resolved_at: request.resolvedAt || null,
    }, request, { ...options, consumedNotificationIds: handledNotificationIds, consumedAuditIds: handledAuditIds })
    calls.push(sideEffectCall.call)
    sideEffectCall.handledNotificationIds.forEach((id) => handledNotificationIds.add(id))
    sideEffectCall.handledAuditIds.forEach((id) => handledAuditIds.add(id))
    handledIds.add(request.id)
    if (request.status !== 'cancelled' && request.shiftId) handledShiftIds.add(request.shiftId)
  }

  return { calls, handledIds, handledShiftIds, handledNotificationIds, handledAuditIds }
}

export function auditInsertRpcCalls(auditRows = []) {
  return (auditRows || [])
    .filter((row) => row?.id && (row.text || row.action))
    .map((row) => ({
      fn: 'rb_insert_audit_log',
      args: {
        p_id: row.id,
        p_action: row.text || row.action,
        p_payload: row.payload || {},
      },
    }))
}
