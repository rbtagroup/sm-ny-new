import { weekdayOf } from './dateTime.js'

// Weekdays in the order they are shown (Po … Ne) with JavaScript getDay() numbers (0 = neděle).
export const COVERAGE_WEEKDAYS = [[1, 'Po'], [2, 'Út'], [3, 'St'], [4, 'Čt'], [5, 'Pá'], [6, 'So'], [0, 'Ne']]

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
