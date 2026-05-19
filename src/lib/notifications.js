export const createNoticeFactory = (uid) => ({ title, body = '', targetDriverId = '', targetRole = 'admin', type = 'info', shiftId = '', push = true, skipPush = false, excludePushDriverIds = [] }) => {
  const notice = {
    id: uid('ntf'),
    at: new Date().toISOString(),
    title,
    body,
    targetDriverId,
    targetRole: targetDriverId ? 'driver' : targetRole,
    type,
    shiftId,
    readBy: [],
    deletedBy: [],
  }
  if (push === false || skipPush) notice.push = false
  const excluded = [...new Set((excludePushDriverIds || []).filter(Boolean))]
  if (excluded.length) notice.excludePushDriverIds = excluded
  return notice
}

export function addNotificationsToData(data, notices) {
  const clean = (Array.isArray(notices) ? notices : [notices]).filter(Boolean)
  if (!clean.length) return data
  return { ...data, notifications: [...clean, ...(data.notifications || [])].slice(0, 500) }
}

export function noticeUserKey(currentDriver, isDriver, profile = null) {
  if (isDriver) return `driver:${currentDriver?.id || ''}`
  if (profile?.id) return `staff:${profile.id}`
  return profile?.role ? `staff:${profile.role}` : 'admin'
}

export function noticeDeletedKey(currentDriver, isDriver, profile = null) {
  return `deleted:${noticeUserKey(currentDriver, isDriver, profile)}`
}

function legacyNoticeUserKeys(isDriver) {
  return isDriver ? [] : ['admin']
}

export function isNoticeDeleted(notice, currentDriver, isDriver, profile = null) {
  const keys = [noticeUserKey(currentDriver, isDriver, profile), ...legacyNoticeUserKeys(isDriver)]
  return keys.some((userKey) => {
    const legacyKey = `deleted:${userKey}`
    return (notice.deletedBy || []).includes(userKey) ||
      (notice.readBy || []).some((x) => x === legacyKey || String(x).startsWith(`${legacyKey}:`))
  })
}

export function isNoticeVisible(notice, currentDriver, isDriver, profile = null) {
  if (!notice || isNoticeDeleted(notice, currentDriver, isDriver, profile)) return false
  if (!isDriver) return true
  if (notice.targetRole === 'all' || notice.targetRole === 'driver_all') return true
  return Boolean(currentDriver?.id && notice.targetDriverId === currentDriver.id)
}

export function isNoticeVisibleInInbox(notice, currentDriver, isDriver, swapRequests = [], profile = null) {
  if (!isNoticeVisible(notice, currentDriver, isDriver, profile)) return false
  if (!isDriver || notice.type !== 'swap-offer' || !notice.shiftId) return true

  return (swapRequests || []).some((request) =>
    request?.shiftId === notice.shiftId &&
    request.status === 'pending' &&
    request.driverId !== currentDriver?.id &&
    (request.targetMode === 'all' || request.targetDriverId === currentDriver?.id),
  )
}

export function isNoticeRead(notice, currentDriver, isDriver, profile = null) {
  const keys = [noticeUserKey(currentDriver, isDriver, profile), ...legacyNoticeUserKeys(isDriver)]
  return keys.some((key) => (notice.readBy || []).includes(key))
}

export function markNoticeRead(notice, currentDriver, isDriver, profile = null) {
  const key = noticeUserKey(currentDriver, isDriver, profile)
  return { ...notice, readBy: [...new Set([...(notice.readBy || []), key])] }
}

export function markNoticeDeleted(notice, currentDriver, isDriver, profile = null) {
  const key = noticeUserKey(currentDriver, isDriver, profile)
  return { ...notice, deletedBy: [...new Set([...(notice.deletedBy || []), key])] }
}

export function unmarkNoticeDeleted(notice, currentDriver, isDriver, profile = null) {
  const key = noticeUserKey(currentDriver, isDriver, profile)
  const legacyKeys = [noticeDeletedKey(currentDriver, isDriver, profile), ...legacyNoticeUserKeys(isDriver).map((legacy) => `deleted:${legacy}`)]
  return {
    ...notice,
    deletedBy: (notice.deletedBy || []).filter((x) => x !== key),
    readBy: (notice.readBy || []).filter((x) => !legacyKeys.some((legacyKey) => x === legacyKey || String(x).startsWith(`${legacyKey}:`))),
  }
}
