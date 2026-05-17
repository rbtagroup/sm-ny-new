import { roleMap } from './appConfig.js'
import {
  isNoticeRead,
  isNoticeVisibleInInbox,
  markNoticeDeleted,
  markNoticeRead,
  unmarkNoticeDeleted,
} from './notifications.js'

export function notificationContext({ currentDriver = null, isDriver = false, profile = null, swapRequests = [] } = {}) {
  return { currentDriver, isDriver: Boolean(isDriver), profile, swapRequests: swapRequests || [] }
}

export function noticeCreatedAt(notice) {
  return notice?.at || notice?.createdAt || ''
}

export function sortNotificationsNewestFirst(items = []) {
  return [...items].sort((a, b) => new Date(noticeCreatedAt(b) || 0).getTime() - new Date(noticeCreatedAt(a) || 0).getTime())
}

export function visibleInboxNotifications(data = {}, contextInput = {}) {
  const context = notificationContext({ ...contextInput, swapRequests: contextInput.swapRequests || data.swapRequests || [] })
  return sortNotificationsNewestFirst((data.notifications || []).filter((notice) =>
    isNoticeVisibleInInbox(notice, context.currentDriver, context.isDriver, context.swapRequests, context.profile),
  ))
}

export function inboxDateKey(value) {
  const date = value ? new Date(value) : new Date()
  return new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function groupInboxNotifications(items = [], now = new Date()) {
  const todayKey = inboxDateKey(now)
  const yesterdayKey = inboxDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  const groups = [
    ['Dnes', items.filter((notice) => inboxDateKey(noticeCreatedAt(notice)) === todayKey)],
    ['Včera', items.filter((notice) => inboxDateKey(noticeCreatedAt(notice)) === yesterdayKey)],
    ['Starší', items.filter((notice) => {
      const key = inboxDateKey(noticeCreatedAt(notice))
      return key !== todayKey && key !== yesterdayKey
    })],
  ]
  return groups.filter(([, groupItems]) => groupItems.length)
}

export function notificationInboxState(data = {}, contextInput = {}, now = new Date()) {
  const context = notificationContext({ ...contextInput, swapRequests: contextInput.swapRequests || data.swapRequests || [] })
  const visible = visibleInboxNotifications(data, context)
  const unread = visible.filter((notice) => !isNoticeRead(notice, context.currentDriver, context.isDriver, context.profile))
  return {
    visible,
    unread,
    visibleIds: new Set(visible.map((notice) => notice.id)),
    groups: groupInboxNotifications(visible, now),
    hasRead: visible.length > unread.length,
  }
}

export function isInboxNoticeRead(notice, contextInput = {}) {
  const context = notificationContext(contextInput)
  return isNoticeRead(notice, context.currentDriver, context.isDriver, context.profile)
}

export function markInboxNotificationsRead(notifications = [], ids = [], contextInput = {}) {
  const context = notificationContext(contextInput)
  const idSet = ids instanceof Set ? ids : new Set((ids || []).filter(Boolean))
  if (!idSet.size) return notifications
  return notifications.map((notice) => idSet.has(notice.id) ? markNoticeRead(notice, context.currentDriver, context.isDriver, context.profile) : notice)
}

export function markInboxNotificationsDeleted(notifications = [], ids = [], contextInput = {}) {
  const context = notificationContext(contextInput)
  const idSet = ids instanceof Set ? ids : new Set((ids || []).filter(Boolean))
  if (!idSet.size) return notifications
  return notifications.map((notice) => idSet.has(notice.id) ? markNoticeDeleted(notice, context.currentDriver, context.isDriver, context.profile) : notice)
}

export function restoreInboxNotifications(notifications = [], ids = [], contextInput = {}) {
  const context = notificationContext(contextInput)
  const idSet = ids instanceof Set ? ids : new Set((ids || []).filter(Boolean))
  if (!idSet.size) return notifications
  return notifications.map((notice) => idSet.has(notice.id) ? unmarkNoticeDeleted(notice, context.currentDriver, context.isDriver, context.profile) : notice)
}

export function notificationTargetLabel(notice, helpers = {}) {
  if (notice?.targetDriverId) return `Řidič: ${helpers.driverName?.(notice.targetDriverId) || notice.targetDriverId}`
  if (notice?.targetRole === 'driver_all') return 'Všichni řidiči'
  if (notice?.targetRole === 'all') return 'Všichni'
  if (notice?.targetRole === 'dispatcher') return 'Dispečink'
  if (notice?.targetRole === 'admin') return 'Staff'
  return roleMap[notice?.targetRole] || notice?.targetRole || 'Bez cíle'
}
