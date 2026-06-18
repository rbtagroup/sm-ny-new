export function localDateISO(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const todayISO = (date = new Date()) => localDateISO(date)

export function millisecondsUntilNextLocalDay(date = new Date()) {
  const nextDay = new Date(date)
  nextDay.setHours(24, 0, 0, 50)
  return Math.max(250, nextDay.getTime() - date.getTime())
}

export function minutes(value) {
  const [h, m] = String(value || '00:00').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return localDateISO(d)
}

export function startOfWeek(date) {
  const d = new Date(`${date}T12:00:00`)
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  return localDateISO(d)
}

export function formatDate(date, weekday = true) {
  return new Intl.DateTimeFormat('cs-CZ', weekday ? { weekday: 'short', day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
}

export function intervalForShift(s) {
  const start = new Date(`${s.date}T${s.start || '00:00'}:00`).getTime()
  let end = new Date(`${s.date}T${s.end || '00:00'}:00`).getTime()
  if (minutes(s.end) <= minutes(s.start)) end += 24 * 60 * 60 * 1000
  return [start, end]
}

export function overlapsShift(a, b) {
  const [a1, a2] = intervalForShift(a)
  const [b1, b2] = intervalForShift(b)
  return a1 < b2 && b1 < a2
}

export function overlapsTimeWindow(startA, endA, startB, endB) {
  const a = { date: todayISO(), start: startA, end: endA }
  const b = { date: todayISO(), start: startB, end: endB }
  return overlapsShift(a, b)
}

export function actualDurationMinutes(shift) {
  if (!shift.actualStartAt || !shift.actualEndAt) return null
  const start = new Date(shift.actualStartAt).getTime()
  const end = new Date(shift.actualEndAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return Math.round((end - start) / 60000)
}

export function plannedDurationMinutes(shift) {
  const [start, end] = intervalForShift(shift)
  return Math.max(0, Math.round((end - start) / 60000))
}

export function durationLabel(minutesTotal) {
  if (minutesTotal == null) return '—'
  const h = Math.floor(minutesTotal / 60)
  const m = minutesTotal % 60
  return h + ' h ' + m + ' min'
}

export function hoursLabel(minutesTotal) {
  if (minutesTotal == null) return '—'
  return (minutesTotal / 60).toLocaleString('cs-CZ', { maximumFractionDigits: 1 }) + ' h'
}

export function datetimeLocal(date = todayISO(), value = '07:00') {
  return `${date}T${value}`
}

export function datePart(value) {
  return value ? String(value).slice(0, 10) : ''
}

export function timePart(value) {
  return value ? String(value).slice(11, 16) : ''
}

export function dateInRange(date, from, to) {
  return date >= from && date <= to
}

export function weekdayOf(date) {
  return new Date(`${date}T12:00:00`).getDay()
}

export function formatDateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function localStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}
