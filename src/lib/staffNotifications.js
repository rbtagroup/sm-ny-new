import { addDays, startOfWeek } from './dateTime.js'
import { isPendingDriver } from './drivers.js'
import { coverageGaps } from './opsMetrics.js'

// Reports of what already happened; the plan and history show them, so they never wait for dispatch.
export const STAFF_INFO_TYPES = new Set(['driver-confirmed', 'attendance-start', 'attendance-end', 'swap-cancelled', 'swap-rejected'])

export function isSentToDrivers(notice = {}) {
  return Boolean(notice.targetDriverId) || ['driver', 'driver_all', 'all'].includes(notice.targetRole)
}

const hasSwap = (data, shiftId, statuses, predicate = () => true) =>
  (data.swapRequests || []).some((request) => request?.shiftId === shiftId && statuses.includes(request.status) && predicate(request))

function coverageStillMissing(data, day, today) {
  const window = [day, addDays(day, 1)].filter((date) => date >= today)
  const weeks = [...new Set(window.map((date) => startOfWeek(date)))]
  return weeks.some((week) => coverageGaps(data, week).some((gap) => window.includes(gap.day)))
}

// 'open' waits for dispatch, 'resolved' was handled since, 'info' only reports, 'sent' went to drivers.
export function staffNoticeState(notice = {}, data = {}, { today = '', read = false } = {}) {
  if (isSentToDrivers(notice)) return 'sent'
  const type = String(notice.type || '')
  if (STAFF_INFO_TYPES.has(type)) return 'info'

  if (type === 'driver-declined') {
    const shift = (data.shifts || []).find((item) => item.id === notice.shiftId)
    return shift?.status === 'declined' ? 'open' : 'resolved'
  }
  if (type === 'swap-request') return hasSwap(data, notice.shiftId, ['pending', 'accepted']) ? 'open' : 'resolved'
  if (type === 'swap-accepted') return hasSwap(data, notice.shiftId, ['accepted']) ? 'open' : 'resolved'
  if (type === 'open-shift-interest') return hasSwap(data, notice.shiftId, ['pending'], (request) => request.targetMode === 'open') ? 'open' : 'resolved'
  if (type === 'settlement-submitted') {
    return (data.settlements || []).some((settlement) => settlement?.shiftId === notice.shiftId && settlement.status === 'submitted') ? 'open' : 'resolved'
  }
  if (type === 'driver-signup-pending') {
    const driverId = String(notice.id || '').replace(/^ntf_driver_pending_/, '')
    const driver = (data.drivers || []).find((item) => item.id === driverId)
    return driver && isPendingDriver(driver) ? 'open' : 'resolved'
  }
  if (type.startsWith('daily-coverage:') && today) {
    const day = type.slice('daily-coverage:'.length)
    return day >= today && coverageStillMissing(data, day, today) ? 'open' : 'resolved'
  }
  return read ? 'resolved' : 'open'
}

export function splitStaffInbox(notices = [], data = {}, { today = '', isRead = () => false } = {}) {
  const inbox = { open: [], done: [], sent: [], openUnread: [] }
  for (const notice of notices) {
    const read = isRead(notice)
    const state = staffNoticeState(notice, data, { today, read })
    if (state === 'open') {
      inbox.open.push(notice)
      if (!read) inbox.openUnread.push(notice)
    } else if (state === 'sent') {
      inbox.sent.push(notice)
    } else {
      inbox.done.push(notice)
    }
  }
  return inbox
}
