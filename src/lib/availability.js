import {
  dateInRange,
  datePart,
  formatDate,
  formatDateTime,
  intervalForShift,
  overlapsTimeWindow,
  weekdayOf,
} from './dateTime.js'
import { weekdayMap } from './appConfig.js'

export const availabilityKindMap = {
  available: 'Dostupný',
  unavailable: 'Nedostupný',
  preferred: 'Preferuje',
}

export const availabilityKindTone = {
  available: 'good',
  unavailable: 'bad',
  preferred: 'warn',
}

export function availabilityKind(slot) {
  const match = String(slot?.note || '').match(/^\[(available|unavailable|preferred)\]/)
  return match?.[1] || 'available'
}

export function availabilityNoteText(slot) {
  return String(slot?.note || '').replace(/^\[(available|unavailable|preferred)\]\s*/, '').trim()
}

export function availabilityLabel(slot) {
  if (slot.fromAt || slot.toAt) return `${formatDateTime(slot.fromAt)} → ${formatDateTime(slot.toAt)}`
  return `${slot.date ? formatDate(slot.date) : weekdayMap[slot.weekday]} ${slot.start}–${slot.end}`
}

export function availabilityRangeOverlaps(a, b) {
  if (!a?.fromAt || !a?.toAt || !b?.fromAt || !b?.toAt) return false
  const a1 = new Date(a.fromAt).getTime()
  const a2 = new Date(a.toAt).getTime()
  const b1 = new Date(b.fromAt).getTime()
  const b2 = new Date(b.toAt).getTime()
  return Number.isFinite(a1) && Number.isFinite(a2) && Number.isFinite(b1) && Number.isFinite(b2) && a1 < b2 && b1 < a2
}

export function availabilityRelevantToShift(slot, shift) {
  if (slot.fromAt || slot.toAt) {
    const fromDate = datePart(slot.fromAt)
    const toDate = datePart(slot.toAt || slot.fromAt)
    return fromDate && toDate && dateInRange(shift.date, fromDate, toDate)
  }
  return slot.date ? slot.date === shift.date : Number(slot.weekday) === weekdayOf(shift.date)
}

// True when the slot's time window touches the shift at all (used for "unavailable" entries).
export function availabilityOverlapsShift(slot, shift) {
  if (slot.fromAt || slot.toAt) {
    if (!slot.fromAt || !slot.toAt) return false
    const [s1, s2] = intervalForShift(shift)
    const a1 = new Date(slot.fromAt).getTime()
    const a2 = new Date(slot.toAt).getTime()
    return Number.isFinite(a1) && Number.isFinite(a2) && a1 < s2 && s1 < a2
  }
  return overlapsTimeWindow(shift.start, shift.end, slot.start, slot.end)
}

// How a driver's availability entries relate to a shift: 'unavailable' (said they cannot), 'available'
// (an available/preferred entry covers it), 'outside' (entries exist that day but none covers it) or '' (no entries).
export function availabilityStateForShift(entries = [], shift) {
  const relevant = entries.filter((slot) => availabilityRelevantToShift(slot, shift))
  if (relevant.some((slot) => availabilityKind(slot) === 'unavailable' && availabilityOverlapsShift(slot, shift))) return 'unavailable'
  const positive = relevant.filter((slot) => availabilityKind(slot) !== 'unavailable')
  if (!positive.length) return ''
  return positive.some((slot) => availabilityCoversShift(slot, shift)) ? 'available' : 'outside'
}

export function availabilityCoversShift(slot, shift) {
  if (slot.fromAt || slot.toAt) {
    if (!slot.fromAt || !slot.toAt) return false
    const [s1, s2] = intervalForShift(shift)
    const a1 = new Date(slot.fromAt).getTime()
    const a2 = new Date(slot.toAt).getTime()
    return Number.isFinite(a1) && Number.isFinite(a2) && a1 <= s1 && s2 <= a2
  }
  return overlapsTimeWindow(shift.start, shift.end, slot.start, slot.end)
}
