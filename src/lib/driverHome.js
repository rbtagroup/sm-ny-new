import { addDays, intervalForShift, todayISO } from './dateTime.js'
import { sortByDateTime } from './display.js'
import {
  canOpenSettlement,
  settlementForShift,
  settlementIsClosed,
  shiftIsInStartWindow,
  shiftNeedsSettlementAction,
} from './settlements.js'

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
