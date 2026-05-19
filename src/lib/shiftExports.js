import {
  actualDurationMinutes,
  addDays,
  durationLabel,
  formatDate,
  todayISO,
} from './dateTime.js'
import { shiftTypeMap, statusMap } from './appConfig.js'
import { sortByDateTime } from './display.js'
import { attendanceRows } from './opsMetrics.js'

export function download(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function exportAttendanceCSV(data, helpers, from, to) {
  const rows = [['Řidič','Směn','Dokončeno','Plán minut','Reál minut','Rozdíl minut','Otevřené směny']]
  attendanceRows(data, helpers, from, to).forEach((row) => rows.push([row.driver.name, row.shifts.length, row.completed, row.plannedMinutes, row.actualMinutes, row.diffMinutes, row.open]))
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';')).join('\n')
  download(`rbshift-dochazka-${from}-${to}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8')
}

export function weekText(data, helpers, weekStart, count = 7) {
  const days = Array.from({ length: count }, (_, index) => addDays(weekStart, index))
  const lines = [`RB TAXI – plán směn ${formatDate(weekStart)} až ${formatDate(addDays(weekStart, count - 1))}`, '']
  days.forEach((day) => {
    const shifts = sortByDateTime(data.shifts.filter((shift) => shift.date === day))
    lines.push(`${formatDate(day)}:`)
    if (!shifts.length) lines.push('  volno / bez směn')
    shifts.forEach((shift) => {
      lines.push(`  ${shift.start}–${shift.end} · ${helpers.driverName(shift.driverId)} · ${helpers.vehicleName(shift.vehicleId)} · ${statusMap[shift.status]}`)
      if (shift.instruction) lines.push(`    Instrukce: ${shift.instruction}`)
    })
    lines.push('')
  })
  return lines.join('\n')
}

export function dayText(data, helpers, date) {
  const shifts = sortByDateTime(data.shifts.filter((shift) => shift.date === date))
  const lines = [`RB TAXI – plán ${formatDate(date)}`, '']
  if (!shifts.length) lines.push('Bez plánovaných směn.')
  shifts.forEach((shift) => {
    const extra = shift.declineReason ? ` · odmítnuto: ${shift.declineReason}` : ''
    lines.push(`${shift.start}–${shift.end} · ${helpers.driverName(shift.driverId)} · ${helpers.vehicleName(shift.vehicleId)} · ${statusMap[shift.status]}${extra}`)
    if (shift.instruction) lines.push(`Instrukce: ${shift.instruction}`)
  })
  return lines.join('\n')
}

export function driverText(data, helpers, driverId) {
  const driver = helpers.driver(driverId)
  const shifts = sortByDateTime(data.shifts.filter((shift) => shift.driverId === driverId && shift.date >= todayISO() && shift.status !== 'cancelled')).slice(0, 14)
  const lines = [`RB TAXI – tvoje směny${driver ? ` (${driver.name})` : ''}:`, '']
  if (!shifts.length) lines.push('Nemáš žádné plánované směny.')
  shifts.forEach((shift) => {
    lines.push(`${formatDate(shift.date)} ${shift.start}–${shift.end} · ${helpers.vehicleName(shift.vehicleId)} · ${statusMap[shift.status]}`)
    if (shift.instruction) lines.push(`  Instrukce: ${shift.instruction}`)
  })
  return lines.join('\n')
}

export function backup(data) {
  download(`rbshift-zaloha-${todayISO()}.json`, JSON.stringify(data, null, 2))
}

export function exportCSV(data, helpers) {
  const rows = [['Datum','Start','Konec','Řidič','Vozidlo','Typ','Stav','Poznámka','Instrukce','Důvod odmítnutí','Nástup','Ukončení','Reálný čas','Výměna','Kolize']]
  sortByDateTime(data.shifts).forEach((shift) => rows.push([shift.date, shift.start, shift.end, helpers.driverName(shift.driverId), helpers.vehicleName(shift.vehicleId), shiftTypeMap[shift.type] || shift.type, statusMap[shift.status] || shift.status, shift.note || '', shift.instruction || '', shift.declineReason || '', shift.actualStartAt || '', shift.actualEndAt || '', durationLabel(actualDurationMinutes(shift)), shift.swapRequestStatus || '', helpers.conflictMessages(shift).join(' | ')]))
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';')).join('\n')
  download(`rbshift-smeny-${todayISO()}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8')
}
