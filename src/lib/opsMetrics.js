import {
  actualDurationMinutes,
  addDays,
  formatDate,
  overlapsTimeWindow,
  plannedDurationMinutes,
  startOfWeek,
  todayISO,
} from './dateTime.js'
import { sortByDateTime } from './display.js'

export function weekShifts(data, weekStart) {
  return sortByDateTime((data.shifts || []).filter((s) => s.date >= weekStart && s.date <= addDays(weekStart, 6)))
}

export function readinessChecks(data, helpers, weekStart = startOfWeek(todayISO())) {
  const week = weekShifts(data, weekStart)
  const activeWeek = week.filter((s) => !['cancelled', 'declined'].includes(s.status))
  const conflicts = activeWeek.flatMap((s) => helpers.conflictMessages(s).map((message) => ({ shift: s, message })))
  const gaps = coverageGaps(data, weekStart)
  const pendingSwaps = (data.swapRequests || []).filter((r) => ['pending','accepted'].includes(r.status))
  const openInterests = pendingSwaps.filter((r) => r.targetMode === 'open')
  const waiting = week.filter((s) => ['draft', 'assigned'].includes(s.status))
  const declined = week.filter((s) => s.status === 'declined')
  const runningOld = (data.shifts || []).filter((s) => s.actualStartAt && !s.actualEndAt && s.date < todayISO())
  const checks = [
    { key: 'drivers', label: 'Řidiči vyplnění', ok: data.drivers.some((d) => d.active), detail: `${data.drivers.filter((d) => d.active).length} aktivních řidičů` },
    { key: 'vehicles', label: 'Auta vyplněná', ok: data.vehicles.some((v) => v.active), detail: `${data.vehicles.filter((v) => v.active).length} aktivních aut` },
    { key: 'availability', label: 'Dostupnost zadaná', ok: (data.availability || []).length > 0, detail: `${(data.availability || []).length} pravidel dostupnosti` },
    { key: 'planned', label: 'Směny na týden naplánované', ok: week.length > 0, detail: `${week.length} směn v týdnu` },
    { key: 'conflicts', label: 'Žádné kolize', ok: conflicts.length === 0, detail: conflicts.length ? `${conflicts.length} kolizí` : 'Bez kolizí' },
    { key: 'coverage', label: 'Neobsazené směny vyřešené', ok: gaps.length === 0, detail: gaps.length ? `${gaps.length} děr v pokrytí` : 'Pokrytí OK' },
    { key: 'confirmed', label: 'Všichni řidiči potvrzeni', ok: waiting.length === 0, detail: waiting.length ? `${waiting.length} čeká na reakci` : 'Vše potvrzeno / hotovo' },
    { key: 'declined', label: 'Odmítnuté směny vyřešené', ok: declined.length === 0, detail: declined.length ? `${declined.length} odmítnuto` : 'Bez odmítnutí' },
    { key: 'swaps', label: 'Žádné čekající výměny', ok: pendingSwaps.length === 0, detail: pendingSwaps.length ? `${pendingSwaps.length} žádostí` : 'Bez žádostí' },
    { key: 'attendance', label: 'Nedořešená docházka', ok: runningOld.length === 0, detail: runningOld.length ? `${runningOld.length} starších běžících směn` : 'Docházka OK' },
  ]
  return { checks, conflicts, gaps, pendingSwaps, openInterests, waiting, declined, runningOld, week, activeWeek }
}

export function attendanceRows(data, helpers, from, to) {
  const rows = data.drivers.map((driver) => {
    const shifts = (data.shifts || []).filter((s) => s.driverId === driver.id && s.date >= from && s.date <= to)
    const plannedMinutes = shifts.reduce((sum, s) => sum + plannedDurationMinutes(s), 0)
    const actualMinutes = shifts.reduce((sum, s) => sum + (actualDurationMinutes(s) || 0), 0)
    const completed = shifts.filter((s) => s.status === 'completed').length
    const open = shifts.filter((s) => s.actualStartAt && !s.actualEndAt).length
    return { driver, shifts, plannedMinutes, actualMinutes, diffMinutes: actualMinutes - plannedMinutes, completed, open }
  })
  return rows.filter((row) => row.shifts.length || row.driver.active)
}

export function readinessText(data, helpers, weekStart) {
  const r = readinessChecks(data, helpers, weekStart)
  const ok = r.checks.filter((c) => c.ok).length
  const lines = [`RBSHIFT – audit týdne ${formatDate(weekStart)} až ${formatDate(addDays(weekStart, 6))}`, '', `Připravenost: ${ok}/${r.checks.length}`, '']
  r.checks.forEach((c) => lines.push(`${c.ok ? 'OK' : 'ŘEŠIT'} · ${c.label}: ${c.detail}`))
  if (r.gaps.length) {
    lines.push('', 'Chybí obsazení:')
    r.gaps.slice(0, 20).forEach((g) => lines.push(`${formatDate(g.day)} ${g.name} ${g.start}–${g.end}: chybí ${g.missing}`))
  }
  if (r.conflicts.length) {
    lines.push('', 'Kolize:')
    r.conflicts.slice(0, 20).forEach((c) => lines.push(`${c.shift.date} ${c.shift.start}–${c.shift.end}: ${c.message}`))
  }
  return lines.join('\n')
}

export function coverageGaps(data, weekStart = startOfWeek(todayISO())) {
  const slots = data.settings?.coverageSlots || []
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const active = data.shifts.filter((s) => !['cancelled', 'declined'].includes(s.status))
  return days.flatMap((day) => slots.map((slot) => {
    const planned = active.filter((s) => s.date === day && overlapsTimeWindow(s.start, s.end, slot.start, slot.end)).length
    return { day, ...slot, planned, missing: Math.max(0, Number(slot.minDrivers || 0) - planned) }
  })).filter((x) => x.missing > 0)
}
