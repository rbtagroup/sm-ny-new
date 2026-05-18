export const defaultDriverReminderCron = '0 18 * * 3'

export const weekdayCronMap = {
  0: 'neděle',
  1: 'pondělí',
  2: 'úterý',
  3: 'středa',
  4: 'čtvrtek',
  5: 'pátek',
  6: 'sobota',
}

const weekdayHumanMap = {
  0: 'neděli',
  1: 'pondělí',
  2: 'úterý',
  3: 'středu',
  4: 'čtvrtek',
  5: 'pátek',
  6: 'sobotu',
}

export function parseDriverReminderCron(value = defaultDriverReminderCron) {
  const parts = String(value || defaultDriverReminderCron).trim().split(/\s+/)
  if (parts.length !== 5) return { minute: '0', hour: '18', weekday: '3' }
  return { minute: parts[0], hour: parts[1], weekday: parts[4] }
}

export function buildWeeklyCron(weekday = '3', timeValue = '18:00') {
  const [hour = '18', minute = '00'] = String(timeValue || '18:00').split(':')
  return `${Number(minute || 0)} ${Number(hour || 18)} * * ${weekday}`
}

export function cronTimeValue(cron = defaultDriverReminderCron) {
  const parsed = parseDriverReminderCron(cron)
  return `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`
}

export function isValidSimpleWeeklyCron(value = '') {
  const parts = String(value || '').trim().split(/\s+/)
  if (parts.length !== 5) return false
  const [minute, hour, dayOfMonth, month, weekday] = parts
  const nMinute = Number(minute)
  const nHour = Number(hour)
  const nWeekday = Number(weekday)
  return Number.isInteger(nMinute) && nMinute >= 0 && nMinute <= 59 &&
    Number.isInteger(nHour) && nHour >= 0 && nHour <= 23 &&
    dayOfMonth === '*' && month === '*' &&
    Number.isInteger(nWeekday) && nWeekday >= 0 && nWeekday <= 6
}

export function humanDriverReminderCron(value = defaultDriverReminderCron) {
  if (!isValidSimpleWeeklyCron(value)) return 'Neplatný cron formát'
  const parsed = parseDriverReminderCron(value)
  return `Každou ${weekdayHumanMap[Number(parsed.weekday)] || 'středu'} v ${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`
}
