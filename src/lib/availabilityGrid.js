import { addDays, dateInRange, datePart, isPlausiblePlanDate, timePart, weekdayOf } from './dateTime.js'
import { availabilityKind, availabilityNoteText } from './availability.js'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY_END = '24:00'

export const availabilityPresets = [
  ['day', 'Celý den', '00:00', '23:59'],
  ['morning', 'Ranní', '06:00', '14:00'],
  ['afternoon', 'Odpolední', '14:00', '22:00'],
  ['night', 'Noční', '22:00', '06:00'],
]

const fullDay = (start, end) => start === '00:00' && (end === DAY_END || end === '23:59')

// How an availability entry shows on one day, or null when it does not touch that day.
export function availabilityOnDay(slot = {}, day) {
  if (slot.fromAt || slot.toAt) {
    if (!slot.fromAt || !slot.toAt) return null
    const fromDate = datePart(slot.fromAt)
    const toDate = datePart(slot.toAt)
    if (!dateInRange(day, fromDate, toDate)) return null
    const start = fromDate === day ? timePart(slot.fromAt) : '00:00'
    const end = toDate === day ? timePart(slot.toAt) : DAY_END
    // a range that ends at midnight does not reach into the next day
    if (fromDate < day && end === '00:00') return null
    if (fullDay(start, end)) return { label: 'celý den', start, end, weekly: false }
    if (end === DAY_END) return { label: `od ${start}`, start, end, weekly: false }
    if (fromDate < day) return { label: `do ${end}`, start, end, weekly: false }
    return { label: `${start}–${end}`, start, end, weekly: false }
  }
  const weekly = !slot.date && String(slot.weekday ?? '') !== ''
  if (slot.date ? slot.date !== day : !weekly || Number(slot.weekday) !== weekdayOf(day)) return null
  return { label: fullDay(slot.start, slot.end) ? 'celý den' : `${slot.start}–${slot.end}`, start: slot.start || '00:00', end: slot.end || DAY_END, weekly }
}

// Active drivers × the seven days of a week, each cell with the driver's absences and availability that day.
export function availabilityWeekGrid(data = {}, weekStart) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const drivers = (data.drivers || []).filter((driver) => driver.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), 'cs'))
  const cellItems = (driverId, day) => [
    ...(data.absences || [])
      .filter((absence) => absence.driverId === driverId && dateInRange(day, absence.from, absence.to))
      .map((absence) => ({ id: absence.id, type: 'absence', kind: 'absent', label: absence.reason || 'nepřítomnost', weekly: false, note: '', entry: absence })),
    ...(data.availability || [])
      .filter((slot) => slot.driverId === driverId)
      .map((slot) => ({ slot, onDay: availabilityOnDay(slot, day) }))
      .filter(({ onDay }) => onDay)
      .sort((a, b) => a.onDay.start.localeCompare(b.onDay.start))
      .map(({ slot, onDay }) => ({ id: slot.id, type: 'availability', kind: availabilityKind(slot), label: onDay.label, weekly: onDay.weekly, note: availabilityNoteText(slot), entry: slot })),
  ]
  return { days, rows: drivers.map((driver) => ({ driver, cells: days.map((day) => ({ day, items: cellItems(driver.id, day) })) })) }
}

// A new availability entry for one day, or for that weekday every week. A night past midnight ends the next day.
export function availabilityEntryFromForm(form = {}, id) {
  if (!form.driverId) return { error: 'Vyberte řidiče.' }
  if (!isPlausiblePlanDate(form.date)) return { error: 'Vyberte den.' }
  if (!TIME.test(form.start || '') || !TIME.test(form.end || '')) return { error: 'Vyplňte čas od a do.' }
  if (form.start === form.end) return { error: 'Čas od a do se musí lišit.' }
  const kind = ['available', 'preferred', 'unavailable'].includes(form.type) ? form.type : 'available'
  const note = `[${kind}] ${String(form.note || '').trim()}`.trim()
  if (form.repeatWeekly) return { entry: { id, driverId: form.driverId, weekday: weekdayOf(form.date), date: '', fromAt: '', toAt: '', start: form.start, end: form.end, note } }
  const endDate = form.end < form.start ? addDays(form.date, 1) : form.date
  return { entry: { id, driverId: form.driverId, weekday: '', date: '', fromAt: `${form.date}T${form.start}`, toAt: `${endDate}T${form.end}`, start: form.start, end: form.end, note } }
}

export function absenceFromForm(form = {}, id) {
  if (!form.driverId) return { error: 'Vyberte řidiče.' }
  if (!isPlausiblePlanDate(form.from) || !isPlausiblePlanDate(form.to)) return { error: 'Zkontrolujte datum, rok musí být mezi 2020 a 2100.' }
  if (form.to < form.from) return { error: 'Datum do musí být stejné nebo pozdější než od.' }
  return { entry: { id, driverId: form.driverId, from: form.from, to: form.to, reason: String(form.reason || '').trim() } }
}
