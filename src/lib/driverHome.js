import { addDays, formatDate, intervalForShift, todayISO } from './dateTime.js'
import { sortByDateTime } from './display.js'
import {
  canOpenSettlement,
  settlementForShift,
  settlementIsClosed,
  shiftIsInStartWindow,
  shiftNeedsSettlementAction,
} from './settlements.js'
import { driverShiftActions } from './shiftActions.js'

const hiddenDriverStatuses = new Set(['cancelled', 'declined', 'rejected'])

export function driverShiftIsDashboardVisible(shift, { data = {}, currentDriver, nowTs = Date.now(), today = todayISO(), settlementActionCutoff } = {}) {
  if (shift.driverId !== currentDriver?.id || hiddenDriverStatuses.has(shift.status)) return false
  const cutoff = settlementActionCutoff ?? new Date(`${addDays(today, -1)}T00:00:00`).getTime()
  const settlement = settlementForShift(data, shift.id)
  if (canOpenSettlement(shift) && settlementIsClosed(settlement)) return false
  const [, endAt] = intervalForShift(shift)
  if (shiftNeedsSettlementAction(shift, settlement)) {
    const actualEndAt = shift.actualEndAt ? new Date(shift.actualEndAt).getTime() : 0
    return Math.max(endAt, actualEndAt) >= cutoff
  }
  return shift.date >= today || endAt >= nowTs
}

export function selectDriverHomeState(data = {}, { currentDriver, swapDraft, actionDialog, nowTs = Date.now(), today = todayISO() } = {}) {
  const shiftsSource = data.shifts || []
  const swapRequests = data.swapRequests || []
  const drivers = data.drivers || []
  const settlementActionCutoff = new Date(`${addDays(today, -1)}T00:00:00`).getTime()
  const isVisibleShift = (shift) => driverShiftIsDashboardVisible(shift, { data, currentDriver, nowTs, today, settlementActionCutoff })

  const shifts = sortByDateTime(shiftsSource.filter(isVisibleShift)).slice(0, 30)
  const openShifts = sortByDateTime(shiftsSource.filter((shift) => shift.status === 'open' && !shift.driverId && shift.date >= today)).slice(0, 30)
  const myOpenInterests = swapRequests.filter((request) => request.targetMode === 'open' && request.driverId === currentDriver?.id && ['pending', 'accepted'].includes(request.status))
  const swapShift = swapDraft ? shiftsSource.find((shift) => shift.id === swapDraft.shiftId) : null
  const swapColleagues = drivers.filter((driver) => driver.active !== false && driver.id !== currentDriver?.id)
  const actionRequest = actionDialog?.requestId ? swapRequests.find((request) => request.id === actionDialog.requestId) : null
  const actionShift = actionDialog?.shiftId
    ? shiftsSource.find((shift) => shift.id === actionDialog.shiftId)
    : (actionRequest ? shiftsSource.find((shift) => shift.id === actionRequest.shiftId) : null)
  const awaiting = shifts.filter((shift) => ['assigned', 'draft', 'pending'].includes(shift.status))
  const running = shifts.find((shift) => (shift.actualStartAt && !shift.actualEndAt) || shift.status === 'in_progress')
  const settlementActionShift = shifts.find((shift) => shiftNeedsSettlementAction(shift, settlementForShift(data, shift.id)))
  const todayAwaiting = awaiting.find((shift) => shift.date === today)
  const startWindowShift = shifts.find((shift) => shiftIsInStartWindow(shift, nowTs))
  const incomingSwaps = swapRequests
    .filter((request) => request.status === 'pending' && request.driverId !== currentDriver?.id && (request.targetMode === 'all' || request.targetDriverId === currentDriver?.id))
    .map((request) => ({ request, shift: shiftsSource.find((shift) => shift.id === request.shiftId) }))
    .filter((item) => item.shift && item.shift.date >= today)

  return {
    actionRequest,
    actionShift,
    awaiting,
    focus: running || settlementActionShift || todayAwaiting || startWindowShift,
    incomingSwaps,
    myOpenInterests,
    openShifts,
    shifts,
    swapColleagues,
    swapShift,
  }
}

const minutesText = (minutes) => {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours ? `${hours} h${rest ? ` ${rest} min` : ''}` : `${rest} min`
}

const daysBetween = (fromDate, toDate) => Math.round((new Date(`${toDate}T12:00:00`) - new Date(`${fromDate}T12:00:00`)) / 86400000)

// "dnes", "zítra", "čt 17. 09." for the big time on the driver home.
export function driverDayLabel(date, today = todayISO()) {
  if (date === today) return 'Dnes'
  if (date === addDays(today, 1)) return 'Zítra'
  return formatDate(date)
}

// How far away a shift start is, in words a driver reads at a glance.
export function startsInLabel(shift, nowTs = Date.now(), today = todayISO()) {
  const [startAt] = intervalForShift(shift)
  const minutes = Math.ceil((startAt - nowTs) / 60000)
  if (minutes <= 0) return `začala před ${minutesText(-minutes)}`
  if (minutes < 60 * 6) return `nástup za ${minutesText(minutes)}`
  // the day itself is shown above the time, so the countdown only says how far away it is
  if (minutes < 60 * 48) return `za ${Math.round(minutes / 60)} h`
  const days = daysBetween(today, shift.date)
  return `za ${days} ${days >= 5 ? 'dní' : 'dny'}`
}

export function endsInLabel(shift, nowTs = Date.now()) {
  const [, endAt] = intervalForShift(shift)
  const minutes = Math.ceil((endAt - nowTs) / 60000)
  return minutes > 0 ? `končí za ${minutesText(minutes)}` : `měla skončit před ${minutesText(-minutes)}`
}

// The one thing the driver should do now: finish a running shift, hand in a settlement, check in,
// confirm a waiting shift, or just see the next one.
export function driverNowState(data = {}, { currentDriver, nowTs = Date.now(), today = todayISO() } = {}) {
  const { shifts } = selectDriverHomeState(data, { currentDriver, nowTs, today })
  const settlementOf = (shift) => settlementForShift(data, shift.id) || null
  const actionsOf = (shift) => driverShiftActions(shift, { now: nowTs, hasSettlement: Boolean(settlementOf(shift)) })
  const running = shifts.find((shift) => shift.actualStartAt && !shift.actualEndAt)
  if (running) return { kind: 'running', shift: running, settlement: null }
  const settlementShift = shifts.find((shift) => shiftNeedsSettlementAction(shift, settlementOf(shift)))
  if (settlementShift) return { kind: 'settlement', shift: settlementShift, settlement: settlementOf(settlementShift) }
  const checkInShift = shifts.find((shift) => actionsOf(shift).checkIn)
  if (checkInShift) return { kind: 'checkIn', shift: checkInShift, settlement: null }
  const waiting = shifts.find((shift) => actionsOf(shift).confirm)
  if (waiting) return { kind: 'confirm', shift: waiting, settlement: null }
  const next = shifts.find((shift) => !['completed', 'cancelled', 'declined'].includes(shift.status) && intervalForShift(shift)[0] > nowTs)
  return next ? { kind: 'next', shift: next, settlement: null } : { kind: 'idle', shift: null, settlement: null }
}
