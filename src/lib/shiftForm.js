import { addDays, dateInRange, formatDate, overlapsShift, startOfWeek } from './dateTime.js'
import { czechCount } from './drivers.js'
import { normalizeShiftTemplates } from './shiftTemplates.js'
import { availabilityStateForShift } from './availability.js'

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

const choiceOrder = { available: 0, free: 1, outside: 2, busy: 3, unavailable: 4, absent: 5, inactive: 6 }

// Drivers for the shift picker with what stands in the way of this shift; those who can drive come first.
export function driverChoices(data = {}, shift = {}, selectedId = '') {
  const hasTime = Boolean(shift.date && shift.start && shift.end)
  const choice = (driver) => {
    if (driver.active === false) return { state: 'inactive', note: 'neaktivní' }
    if (!hasTime) return { state: 'free', note: '' }
    const candidate = { ...shift, driverId: driver.id }
    const absence = (data.absences || []).find((item) => item.driverId === driver.id && dateInRange(shift.date, item.from, item.to))
    if (absence) return { state: 'absent', note: absence.reason ? `nepřítomnost: ${absence.reason}` : 'nepřítomnost' }
    const busy = (data.shifts || []).find((other) => other.id !== shift.id && other.driverId === driver.id && !['cancelled', 'declined'].includes(other.status) && other.date && other.start && other.end && overlapsShift(candidate, other))
    if (busy) return { state: 'busy', note: `má směnu ${busy.start}–${busy.end}` }
    const availability = availabilityStateForShift((data.availability || []).filter((item) => item.driverId === driver.id), candidate)
    if (availability === 'unavailable') return { state: 'unavailable', note: 'hlásí, že nemůže' }
    if (availability === 'outside') return { state: 'outside', note: 'mimo zadanou dostupnost' }
    if (availability === 'available') return { state: 'available', note: 'hlásí dostupnost' }
    return { state: 'free', note: 'bez kolize' }
  }
  return selectableRecords(data.drivers || [], selectedId)
    .map((driver) => ({ driver, ...choice(driver) }))
    .sort((a, b) => choiceOrder[a.state] - choiceOrder[b.state] || String(a.driver.name).localeCompare(String(b.driver.name), 'cs'))
}

export const driverChoiceIsClear = (choice) => ['available', 'free'].includes(choice.state)

// Active cars for a shift, free ones first, with what already holds the busy ones.
export function vehicleChoices(data = {}, shift = {}) {
  const choice = (vehicle) => {
    const block = (data.serviceBlocks || []).find((item) => item.vehicleId === vehicle.id && dateInRange(shift.date, item.from, item.to))
    if (block) return { state: 'blocked', note: block.reason ? `servis: ${block.reason}` : 'servis' }
    const busy = (data.shifts || []).find((other) => other.id !== shift.id && other.vehicleId === vehicle.id && !['cancelled', 'declined'].includes(other.status) && other.date && other.start && other.end && overlapsShift(shift, other))
    return busy ? { state: 'busy', note: `jede ${busy.start}–${busy.end}` } : { state: 'free', note: '' }
  }
  return (data.vehicles || [])
    .filter((vehicle) => vehicle.active !== false)
    .map((vehicle) => ({ vehicle, ...choice(vehicle) }))
    .sort((a, b) => (a.state === 'free' ? 0 : 1) - (b.state === 'free' ? 0 : 1) || String(a.vehicle.name).localeCompare(String(b.vehicle.name), 'cs'))
}

// Shifts that fill a coverage slot at once: one for each picked driver and open shifts drivers can sign up for.
export function coverShifts({ gap, picks = [], openCount = 0, confirmed = false, settings = {}, uid }) {
  const preset = gapShiftPreset(gap, settings)
  const base = { date: preset.date, start: preset.start, end: preset.end, type: preset.type, note: preset.note, instruction: '', declineReason: '', actualStartAt: '', actualEndAt: '', swapRequestStatus: '' }
  return [
    ...picks.map((pick) => ({ id: uid('sh'), ...base, driverId: pick.driverId, vehicleId: pick.vehicleId || '', status: confirmed ? 'confirmed' : 'assigned' })),
    ...Array.from({ length: Math.max(0, Math.floor(Number(openCount) || 0)) }, () => ({ id: uid('sh'), ...base, driverId: '', vehicleId: '', status: 'open' })),
  ]
}

// Problems of a batch of new shifts, checked against the plan and each other. Cars still missing are listed together.
export function coverBatchProblems(data = {}, shifts = [], buildHelpers) {
  const helpers = buildHelpers({ ...data, shifts: [...(data.shifts || []), ...shifts] })
  const withoutCar = []
  const other = new Set()
  for (const shift of shifts) {
    for (const message of helpers.conflictMessages(shift)) {
      if (message === 'Není vybrané vozidlo.') withoutCar.push(helpers.driverName(shift.driverId))
      else other.add(message)
    }
  }
  return [...(withoutCar.length ? [`Zatím bez vozu: ${withoutCar.join(', ')}.`] : []), ...other]
}

// The template whose times match the shift, so the picker shows it instead of "Vlastní čas".
export function matchingTemplateId(settings = {}, start = '', end = '') {
  return normalizeShiftTemplates(settings).find((tpl) => tpl.active && tpl.start === start && tpl.end === end)?.id || 'custom'
}
