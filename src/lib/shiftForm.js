import { addDays, formatDate, startOfWeek } from './dateTime.js'
import { czechCount } from './drivers.js'
import { statusMap } from './appConfig.js'
import { normalizeShiftTemplates } from './shiftTemplates.js'

// Dates a new shift is created for. Week-based repeats never reach back before the chosen day.
export function repeatShiftDates(date, repeat = 'none') {
  if (!date) return []
  if (repeat === 'daily7') return Array.from({ length: 7 }, (_, index) => addDays(date, index))
  if (repeat === 'workweek') return Array.from({ length: 5 }, (_, index) => addDays(startOfWeek(date), index)).filter((day) => day >= date)
  if (repeat === 'weekend') return [5, 6].map((index) => addDays(startOfWeek(date), index)).filter((day) => day >= date)
  return [date]
}

export function repeatPreviewText(dates = []) {
  if (!dates.length) return 'Pro zvolený den nevznikne žádná směna. Vyber jiný den nebo jiné opakování.'
  // formatted dates already end with a dot ("čt 17. 09.")
  return `Vytvoří se ${czechCount(dates.length, 'směna', 'směny', 'směn')}: ${dates.map((day) => formatDate(day)).join(', ')}`
}

const plannableStatuses = ['draft', 'assigned', 'confirmed']

// A shift without a driver is always open; with a driver dispatch picks between draft, waiting and confirmed.
// The current status of an edited shift stays selectable so saving never changes it silently.
export function shiftStatusOptions({ hasDriver, currentStatus = '' } = {}) {
  if (!hasDriver) return null
  const keys = [...plannableStatuses]
  if (currentStatus && currentStatus !== 'open' && !keys.includes(currentStatus) && statusMap[currentStatus]) keys.push(currentStatus)
  return Object.fromEntries(keys.map((key) => [key, statusMap[key]]))
}

// Inactive people and cars stay out of the pickers unless the edited shift already uses them.
export function selectableRecords(records = [], selectedId = '') {
  return records.filter((record) => record.active !== false || record.id === selectedId)
}

// Prefill for "create shift" from a missing coverage slot.
export function gapShiftPreset(gap, settings = {}) {
  const template = normalizeShiftTemplates(settings).find((tpl) => tpl.active && tpl.start === gap.start && tpl.end === gap.end)
  return {
    date: gap.day,
    start: gap.start,
    end: gap.end,
    type: template?.type || 'custom',
    template: template?.id || 'custom',
    // the slot name only adds information when no template already names the shift
    note: template ? '' : (gap.name || ''),
  }
}
