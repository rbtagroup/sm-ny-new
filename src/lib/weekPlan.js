import { addDays } from './dateTime.js'
import { coverageGaps } from './opsMetrics.js'
import { inferShiftTemplateType } from './shiftTemplates.js'

const INACTIVE_STATUSES = new Set(['cancelled', 'declined'])

const dayOffset = (fromDate, toDate) => Math.round((new Date(`${toDate}T12:00:00`) - new Date(`${fromDate}T12:00:00`)) / 86400000)
const sameSlot = (a, b) => a.date === b.date && a.start === b.start && a.end === b.end && (a.driverId || '') === (b.driverId || '') && (a.vehicleId || '') === (b.vehicleId || '')

// Shifts that "Naplánovat týden" creates in targetWeekStart: a copy of sourceWeekStart and/or open shifts
// for coverage still missing afterwards. Conflicts are checked against existing shifts and the batch itself.
export function planWeek({ data, targetWeekStart, sourceWeekStart = addDays(targetWeekStart, -7), copyShifts = true, fillGaps = false, allowConflicts = false, buildHelpers, uid }) {
  const working = { ...data, shifts: [...(data.shifts || [])] }
  const planned = []
  const skipped = []
  const drivers = new Map((data.drivers || []).map((driver) => [driver.id, driver]))

  const accept = (shift, source, note = '') => {
    planned.push({ shift, source, note })
    working.shifts.push(shift)
  }

  if (copyShifts) {
    const sourceEnd = addDays(sourceWeekStart, 6)
    const sourceShifts = (data.shifts || [])
      .filter((shift) => shift.date >= sourceWeekStart && shift.date <= sourceEnd && !INACTIVE_STATUSES.has(shift.status))
      .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))

    for (const original of sourceShifts) {
      const driver = original.driverId ? drivers.get(original.driverId) : null
      const keepsDriver = Boolean(driver && driver.active !== false)
      const shift = {
        ...original,
        id: uid('sh'),
        date: addDays(targetWeekStart, dayOffset(sourceWeekStart, original.date)),
        driverId: keepsDriver ? original.driverId : '',
        status: keepsDriver ? 'draft' : 'open',
        declineReason: '',
        actualStartAt: '',
        actualEndAt: '',
        swapRequestStatus: '',
      }
      if (working.shifts.some((existing) => !INACTIVE_STATUSES.has(existing.status) && sameSlot(existing, shift))) {
        skipped.push({ shift, source: 'copy', reasons: ['Stejná směna už v týdnu je.'] })
        continue
      }
      const conflicts = buildHelpers(working).conflictMessages(shift)
      if (conflicts.length && !allowConflicts) {
        skipped.push({ shift, source: 'copy', reasons: conflicts })
        continue
      }
      accept(shift, 'copy', original.driverId && !keepsDriver ? 'Řidič už není aktivní, směna bude volná.' : '')
    }
  }

  if (fillGaps) {
    for (const gap of coverageGaps(working, targetWeekStart)) {
      for (let index = 0; index < gap.missing; index += 1) {
        accept({
          id: uid('sh'),
          date: gap.day,
          start: gap.start,
          end: gap.end,
          driverId: '',
          vehicleId: '',
          type: inferShiftTemplateType({ name: gap.name }),
          status: 'open',
          note: gap.name ? `Doplněno podle pokrytí: ${gap.name}` : 'Doplněno podle pokrytí',
          declineReason: '',
          actualStartAt: '',
          actualEndAt: '',
          swapRequestStatus: '',
        }, 'gap')
      }
    }
  }

  planned.sort((a, b) => `${a.shift.date} ${a.shift.start}`.localeCompare(`${b.shift.date} ${b.shift.start}`))
  return { planned, skipped }
}

export function activeShiftsInWeek(shifts = [], weekStart) {
  const weekEnd = addDays(weekStart, 6)
  return shifts.filter((shift) => shift.date >= weekStart && shift.date <= weekEnd && !INACTIVE_STATUSES.has(shift.status))
}
