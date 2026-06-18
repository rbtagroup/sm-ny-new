import { startOfWeek } from './dateTime.js'
import { coverageGaps } from './opsMetrics.js'
import { sortByDateTime } from './display.js'

export function dashboardOperationalIssues(data = {}, helpers = {}, today = '') {
  const shifts = data.shifts || []
  const futureShifts = shifts.filter((shift) => shift.date >= today)
  const activeShifts = futureShifts.filter((shift) => !['cancelled', 'declined'].includes(shift.status))
  const conflicts = activeShifts.flatMap((shift) =>
    (helpers.conflictMessages?.(shift) || []).map((message) => ({ shift, message })),
  )
  const declined = sortByDateTime(futureShifts.filter((shift) => shift.status === 'declined'))
  const shiftById = new Map(shifts.map((shift) => [shift.id, shift]))
  const pendingSwaps = (data.swapRequests || []).filter((request) => {
    if (!['pending', 'accepted'].includes(request.status)) return false
    const shift = shiftById.get(request.shiftId)
    return !shift || shift.date >= today
  })
  const gaps = coverageGaps(data, startOfWeek(today)).filter((gap) => gap.day >= today)

  return {
    conflicts,
    declined,
    pendingSwaps,
    gaps,
    count: conflicts.length + declined.length + pendingSwaps.length + gaps.length,
  }
}
