export const createNoticeFactory = (uid) => ({ title, body = '', targetDriverId = '', targetRole = 'admin', type = 'info', shiftId = '' }) => ({
  id: uid('ntf'),
  at: new Date().toISOString(),
  title,
  body,
  targetDriverId,
  targetRole,
  type,
  shiftId,
  readBy: [],
  deletedBy: [],
})

export function addNotificationsToData(data, notices) {
  const clean = (Array.isArray(notices) ? notices : [notices]).filter(Boolean)
  if (!clean.length) return data
  return { ...data, notifications: [...clean, ...(data.notifications || [])].slice(0, 500) }
}

export function noticeUserKey(currentDriver, isDriver) {
  return isDriver ? `driver:${currentDriver?.id || ''}` : 'admin'
}

export function noticeDeletedKey(currentDriver, isDriver) {
  return `deleted:${noticeUserKey(currentDriver, isDriver)}`
}

export function isNoticeDeleted(notice, currentDriver, isDriver) {
  const userKey = noticeUserKey(currentDriver, isDriver)
  const legacyKey = noticeDeletedKey(currentDriver, isDriver)
  return (notice.deletedBy || []).includes(userKey) ||
    (notice.readBy || []).some((x) => x === legacyKey || String(x).startsWith(`${legacyKey}:`))
}

export function isNoticeVisible(notice, currentDriver, isDriver) {
  if (!notice || isNoticeDeleted(notice, currentDriver, isDriver)) return false
  if (!isDriver) return true
  if (notice.targetRole === 'all' || notice.targetRole === 'driver_all') return true
  return Boolean(currentDriver?.id && notice.targetDriverId === currentDriver.id)
}

export function isNoticeRead(notice, currentDriver, isDriver) {
  const key = noticeUserKey(currentDriver, isDriver)
  return (notice.readBy || []).includes(key)
}

export function markNoticeRead(notice, currentDriver, isDriver) {
  const key = noticeUserKey(currentDriver, isDriver)
  return { ...notice, readBy: [...new Set([...(notice.readBy || []), key])] }
}

export function markNoticeDeleted(notice, currentDriver, isDriver) {
  const key = noticeUserKey(currentDriver, isDriver)
  return { ...notice, deletedBy: [...new Set([...(notice.deletedBy || []), key])] }
}

export function unmarkNoticeDeleted(notice, currentDriver, isDriver) {
  const key = noticeUserKey(currentDriver, isDriver)
  const legacyKey = noticeDeletedKey(currentDriver, isDriver)
  return {
    ...notice,
    deletedBy: (notice.deletedBy || []).filter((x) => x !== key),
    readBy: (notice.readBy || []).filter((x) => x !== legacyKey && !String(x).startsWith(`${legacyKey}:`)),
  }
}
