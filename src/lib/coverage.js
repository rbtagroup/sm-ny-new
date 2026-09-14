import { addDays, overlapsTimeWindow, weekdayOf } from './dateTime.js'

// Weekdays in the order they are shown (Po … Ne) with JavaScript getDay() numbers (0 = neděle).
export const COVERAGE_WEEKDAYS = [[1, 'Po'], [2, 'Út'], [3, 'St'], [4, 'Čt'], [5, 'Pá'], [6, 'So'], [0, 'Ne']]
export const COVERAGE_NEED_MAX = 99
// Day-specific needs older than this are dropped whenever needs are saved.
const NEED_HISTORY_DAYS = 120
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export const clampCoverageNeed = (value) => Math.min(COVERAGE_NEED_MAX, Math.max(0, Math.round(Number(value) || 0)))

// A coverage slot without `days` applies every day; otherwise only on the listed weekdays.
export function coverageSlotDays(slot = {}) {
  const days = Array.isArray(slot.days) ? [...new Set(slot.days.map(Number).filter((day) => day >= 0 && day <= 6))] : []
  return days.length && days.length < 7 ? days : null
}

export function coverageSlotAppliesOnWeekday(slot, weekday) {
  const days = coverageSlotDays(slot)
  return !days || days.includes(weekday)
}

export function coverageSlotAppliesOn(slot, date) {
  const days = coverageSlotDays(slot)
  return !days || days.includes(weekdayOf(date))
}

// Toggling a weekday keeps the stored list short: all seven days (or none) means "every day".
export function toggleCoverageDay(slot, day) {
  const current = coverageSlotDays(slot) || COVERAGE_WEEKDAYS.map(([weekday]) => weekday)
  const next = current.includes(day) ? current.filter((item) => item !== day) : [...current, day]
  const ordered = COVERAGE_WEEKDAYS.map(([weekday]) => weekday).filter((weekday) => next.includes(weekday))
  const { days, ...rest } = slot
  return ordered.length && ordered.length < 7 ? { ...rest, days: ordered } : rest
}

export function coverageDaysLabel(slot) {
  const days = coverageSlotDays(slot)
  if (!days) return 'každý den'
  return COVERAGE_WEEKDAYS.filter(([weekday]) => days.includes(weekday)).map(([, label]) => label).join(', ')
}

// Needs set for one particular day ("so 20. 09. noc: 10 řidičů"), one entry per day and slot.
export function coverageNeedsList(settings = {}) {
  const byKey = new Map()
  for (const entry of Array.isArray(settings?.coverageNeeds) ? settings.coverageNeeds : []) {
    if (!ISO_DATE.test(String(entry?.date || '')) || !entry?.slotId) continue
    byKey.set(`${entry.date}|${entry.slotId}`, { date: entry.date, slotId: String(entry.slotId), minDrivers: clampCoverageNeed(entry.minDrivers) })
  }
  return [...byKey.values()]
}

// The usual need of a slot on a date (its weekly norm) and the need that applies there; a day-specific entry wins.
export function coverageNeedFor(slot, date, needs = []) {
  const base = coverageSlotAppliesOn(slot, date) ? clampCoverageNeed(slot.minDrivers) : 0
  const entry = needs.find((item) => item.date === date && item.slotId === slot.id)
  return { base, need: entry ? entry.minDrivers : base, override: Boolean(entry) }
}

// Every slot of a day with its need and the active shifts that overlap it; open shifts count, and are also counted apart.
export function coverageDayRows(data = {}, day) {
  const needs = coverageNeedsList(data.settings)
  const dayShifts = (data.shifts || []).filter((shift) => shift.date === day && !['cancelled', 'declined'].includes(shift.status))
  return (data.settings?.coverageSlots || [])
    .map((slot) => {
      const { base, need, override } = coverageNeedFor(slot, day, needs)
      const covering = dayShifts.filter((shift) => overlapsTimeWindow(shift.start, shift.end, slot.start, slot.end))
      return { day, ...slot, base, need, override, planned: covering.length, open: covering.filter((shift) => !shift.driverId).length, missing: Math.max(0, need - covering.length) }
    })
    .sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.name).localeCompare(String(b.name), 'cs'))
}

// Saves the needs of one day. A value equal to the usual norm is not stored, so later norm changes reach that day too.
export function setCoverageNeedsForDay(settings = {}, date, values = {}, today = '') {
  const slots = settings.coverageSlots || []
  const keepFrom = today ? addDays(today, -NEED_HISTORY_DAYS) : ''
  const needs = coverageNeedsList(settings).filter((entry) => slots.some((slot) => slot.id === entry.slotId))
  const otherDays = needs.filter((entry) => entry.date !== date && (!keepFrom || entry.date >= keepFrom))
  const thisDay = slots.flatMap((slot) => {
    const current = needs.find((entry) => entry.date === date && entry.slotId === slot.id)
    if (!Object.hasOwn(values, slot.id)) return current ? [current] : []
    const need = clampCoverageNeed(values[slot.id])
    return need === coverageNeedFor(slot, date).base ? [] : [{ date, slotId: slot.id, minDrivers: need }]
  })
  const coverageNeeds = [...otherDays, ...thisDay].sort((a, b) => a.date.localeCompare(b.date) || a.slotId.localeCompare(b.slotId))
  return { ...settings, coverageNeeds }
}

export const blankCoverageSlotForm = () => ({ name: '', start: '07:00', end: '19:00', minDrivers: 1, days: COVERAGE_WEEKDAYS.map(([day]) => day) })

export const coverageSlotForm = (slot = {}) => ({
  name: slot.name || '',
  start: slot.start || '07:00',
  end: slot.end || '19:00',
  minDrivers: clampCoverageNeed(slot.minDrivers),
  days: coverageSlotDays(slot) || COVERAGE_WEEKDAYS.map(([day]) => day),
})

// Validated slot from the norm form, or the reason it cannot be saved.
export function coverageSlotFromForm(form = {}, id) {
  const name = String(form.name || '').trim()
  if (!name) return { error: 'Vyplňte název pásma.' }
  if (!TIME.test(form.start || '') || !TIME.test(form.end || '')) return { error: 'Vyplňte začátek a konec pásma.' }
  if (form.start === form.end) return { error: 'Začátek a konec pásma se musí lišit.' }
  const days = COVERAGE_WEEKDAYS.map(([day]) => day).filter((day) => (form.days || []).includes(day))
  if (!days.length) return { error: 'Vyberte aspoň jeden den v týdnu.' }
  const slot = { id, name, start: form.start, end: form.end, minDrivers: clampCoverageNeed(form.minDrivers) }
  return { slot: days.length < 7 ? { ...slot, days } : slot }
}

export function saveCoverageSlot(settings = {}, slot) {
  const slots = settings.coverageSlots || []
  const exists = slots.some((item) => item.id === slot.id)
  return { ...settings, coverageSlots: exists ? slots.map((item) => (item.id === slot.id ? slot : item)) : [...slots, slot] }
}

// Removing a slot also drops the needs set for it on particular days.
export function removeCoverageSlot(settings = {}, slotId) {
  return {
    ...settings,
    coverageSlots: (settings.coverageSlots || []).filter((slot) => slot.id !== slotId),
    coverageNeeds: coverageNeedsList(settings).filter((entry) => entry.slotId !== slotId),
  }
}
