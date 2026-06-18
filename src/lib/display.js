import { formatDate, todayISO } from './dateTime.js'
import { roleMap, shiftTypeMap } from './appConfig.js'

export const money = (n) => `${Math.round(Number(n || 0)).toLocaleString('cs-CZ')} Kč`
export const time = (v) => v || '—'

export function formatNoticeDate(date) {
  const d = new Date(`${date}T12:00:00`)
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`
}

export function shiftTypeName(shift) {
  return shiftTypeMap[shift?.type] || 'Vlastní'
}

export function shiftNoticeBody(shift, helpers, suffix = '') {
  return [shiftTypeName(shift), `${formatNoticeDate(shift.date)} · ${shift.start}–${shift.end}`, helpers?.vehicleName?.(shift.vehicleId), suffix].filter(Boolean).join(' · ')
}

export function deviceLabelFromUserAgent(value = '') {
  const ua = String(value || '')
  if (/iPhone/i.test(ua)) return '📱 iPhone (Safari)'
  if (/iPad/i.test(ua)) return '📱 iPad (Safari)'
  if (/Android/i.test(ua) && /Firefox/i.test(ua)) return '📱 Android (Firefox)'
  if (/Android/i.test(ua) && /Chrome/i.test(ua)) return '📱 Android (Chrome)'
  if (/Macintosh/i.test(ua) && /Chrome/i.test(ua)) return '💻 Mac (Chrome)'
  if (/Macintosh/i.test(ua) && /Safari/i.test(ua)) return '💻 Mac (Safari)'
  if (/Windows/i.test(ua) && /Edg/i.test(ua)) return '💻 Windows (Edge)'
  if (/Windows/i.test(ua) && /Chrome/i.test(ua)) return '💻 Windows (Chrome)'
  return '📱 Neznámé zařízení'
}

export function driverInitials(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'Ř'
  const first = parts[0]?.[0] || ''
  const last = parts.length > 1 ? (parts[1]?.[0] || '') : ''
  return `${first}${last}`.toUpperCase() || 'Ř'
}

export function staffDisplayName(profile, currentDriver, role) {
  return profile?.name || profile?.fullName || profile?.full_name || currentDriver?.name || roleMap[role] || 'Uživatel'
}

export function staffInitials(profile, currentDriver, role) {
  return driverInitials(staffDisplayName(profile, currentDriver, role))
}

export function todayRangeTitle(date = todayISO()) {
  return new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(`${date}T12:00:00`))
}

export function statusCounts(shifts) {
  return shifts.reduce((acc, s) => ({ ...acc, [s.status]: (acc[s.status] || 0) + 1 }), {})
}

export function sortByDateTime(list) {
  return [...list].sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))
}

export function firstNamePart(name = '') {
  return String(name || '').trim().split(/\s+/).filter(Boolean)[0] || ''
}

export function lastInitialPart(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  return parts.length > 1 ? `${parts[parts.length - 1].slice(0, 1).toLocaleUpperCase('cs-CZ')}.` : ''
}

export function calendarDriverLabel(driverId, data, helpers) {
  if (!driverId) return 'Volná směna'
  const fullName = helpers.driverName(driverId)
  const firstName = firstNamePart(fullName)
  if (!firstName || fullName === 'Bez řidiče') return fullName || 'Bez řidiče'
  const sameFirstNameCount = (data.drivers || []).filter((driver) => firstNamePart(driver.name).toLocaleLowerCase('cs-CZ') === firstName.toLocaleLowerCase('cs-CZ')).length
  const initial = lastInitialPart(fullName)
  return sameFirstNameCount > 1 && initial ? `${firstName} ${initial}` : firstName
}

export function activeSwapForShift(shift, data = {}) {
  return (data.swapRequests || []).find((r) => r.shiftId === shift.id && ['pending','accepted'].includes(r.status))
}

export function calendarShiftLineClass(shift, conflicts = [], activeSwap = null) {
  if (conflicts.length || ['declined', 'cancelled'].includes(shift.status)) return 'line-bad'
  if (activeSwap || ['pending','accepted'].includes(shift.swapRequestStatus)) return 'line-swap'
  if (['confirmed', 'completed'].includes(shift.status)) return 'line-good'
  if (shift.status === 'open') return 'line-open'
  return 'line-waiting'
}
