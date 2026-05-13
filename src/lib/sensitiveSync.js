const driverNoticeKey = (driverId) => `driver:${driverId || ''}`
const legacyDeletedKey = (driverId) => `deleted:${driverNoticeKey(driverId)}`

const hasState = (items = [], key) => (items || []).includes(key)
const hasLegacyDeletedState = (items = [], driverId) => {
  const key = legacyDeletedKey(driverId)
  return (items || []).some((item) => item === key || String(item).startsWith(`${key}:`))
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

export function swapRequestRpcCalls(prevSwapRequests = [], changedSwapRequests = [], currentDriverId = '') {
  if (!currentDriverId) return { calls: [], denied: [] }
  const previousById = new Map((prevSwapRequests || []).map((request) => [request.id, request]))
  const calls = []
  const denied = []

  for (const request of changedSwapRequests || []) {
    if (!request?.id) continue
    const before = previousById.get(request.id)

    if (!before) {
      if (request.driverId !== currentDriverId) {
        denied.push(request.id)
        continue
      }
      calls.push({
        fn: 'rb_request_swap',
        args: {
          p_id: request.id,
          p_shift_id: request.shiftId,
          p_target_mode: request.targetMode || 'all',
          p_target_driver_id: request.targetDriverId || null,
          p_reason: request.reason || null,
          p_history: request.history || [],
          p_created_at: request.createdAt || null,
        },
      })
      continue
    }

    if (before.driverId === currentDriverId && request.status === 'cancelled') {
      calls.push({
        fn: 'rb_cancel_swap_request',
        args: {
          p_id: request.id,
          p_history: request.history || [],
          p_cancelled_at: request.cancelledAt || null,
        },
      })
      continue
    }

    const canAccept = before.status === 'pending' &&
      before.driverId !== currentDriverId &&
      (before.targetMode === 'all' || before.targetDriverId === currentDriverId)

    if (canAccept && request.status === 'accepted' && request.acceptedByDriverId === currentDriverId) {
      calls.push({
        fn: 'rb_accept_swap_request',
        args: {
          p_id: request.id,
          p_history: request.history || [],
          p_accepted_at: request.acceptedAt || null,
        },
      })
      continue
    }

    const canDeclineTargeted = before.status === 'pending' &&
      before.driverId !== currentDriverId &&
      before.targetMode === 'driver' &&
      before.targetDriverId === currentDriverId

    if (canDeclineTargeted && request.status === 'rejected') {
      calls.push({
        fn: 'rb_decline_swap_request',
        args: {
          p_id: request.id,
          p_history: request.history || [],
          p_rejected_reason: request.rejectedReason || null,
          p_resolved_at: request.resolvedAt || null,
        },
      })
      continue
    }

    denied.push(request.id)
  }

  return { calls, denied }
}

export function staffSwapResolutionRpcCalls(prevSwapRequests = [], changedSwapRequests = []) {
  const previousById = new Map((prevSwapRequests || []).map((request) => [request.id, request]))
  const calls = []
  const handledIds = new Set()
  const handledShiftIds = new Set()

  for (const request of changedSwapRequests || []) {
    if (!request?.id) continue
    const before = previousById.get(request.id)
    if (!before || !['pending', 'accepted'].includes(before.status)) continue
    if (!['approved', 'rejected', 'cancelled'].includes(request.status) || request.status === before.status) continue

    const approvedDriverId = request.approvedDriverId ||
      request.acceptedByDriverId ||
      (request.targetMode === 'open' ? request.driverId : '')

    calls.push({
      fn: 'rb_resolve_swap_request',
      args: {
        p_id: request.id,
        p_status: request.status,
        p_approved_driver_id: approvedDriverId || null,
        p_rejected_reason: request.rejectedReason || null,
        p_history: request.history || [],
        p_resolved_at: request.resolvedAt || null,
      },
    })
    handledIds.add(request.id)
    if (request.status !== 'cancelled' && request.shiftId) handledShiftIds.add(request.shiftId)
  }

  return { calls, handledIds, handledShiftIds }
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
