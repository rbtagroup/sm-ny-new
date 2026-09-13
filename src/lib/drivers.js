export function normalizeDriverEmail(value = '') {
  return String(value || '').trim().toLowerCase()
}

export function driverWithDuplicateEmail(drivers = [], email = '', exceptId = '') {
  const normalizedEmail = normalizeDriverEmail(email)
  if (!normalizedEmail) return null
  return (drivers || []).find((driver) =>
    driver?.id !== exceptId &&
    normalizeDriverEmail(driver?.email) === normalizedEmail,
  ) || null
}

export function canonicalDriverId(drivers = [], driverId = '') {
  if (!driverId) return ''
  const selected = (drivers || []).find((driver) => driver?.id === driverId)
  if (!selected || selected.profileId) return driverId

  const normalizedEmail = normalizeDriverEmail(selected.email)
  if (!normalizedEmail) return driverId
  const linkedMatches = (drivers || []).filter((driver) =>
    driver?.profileId &&
    normalizeDriverEmail(driver.email) === normalizedEmail,
  )
  return linkedMatches.length === 1 ? linkedMatches[0].id : driverId
}

// Řidič vidí u kolegů jen jméno a stav; plný záznam (telefon, e-mail, poznámka) má jen svůj vlastní.
export function mergeDriverDirectory(visibleDrivers = [], directory = []) {
  if (!Array.isArray(directory) || !directory.length) return visibleDrivers || []
  const visibleById = new Map((visibleDrivers || []).filter((driver) => driver?.id).map((driver) => [driver.id, driver]))
  const merged = directory
    .filter((row) => row?.id)
    .map((row) => visibleById.get(row.id) || { id: row.id, profileId: '', name: row.name || '', phone: '', email: '', active: row.active !== false, note: '' })
  const mergedIds = new Set(merged.map((driver) => driver.id))
  for (const driver of visibleById.values()) {
    if (!mergedIds.has(driver.id)) merged.push(driver)
  }
  return merged
}

export const PENDING_DRIVER_NOTE = 'Čeká na schválení dispečinkem.'

// Samoregistrace s neznámým e-mailem čeká na aktivaci dispečinkem.
export function isPendingDriver(driver) {
  return driver?.active === false && String(driver?.note || '').trim() === PENDING_DRIVER_NOTE
}

export function activatedDriverPatch(driver = {}, changes = {}) {
  const next = { ...driver, ...changes }
  if (next.active !== false && String(next.note || '').trim() === PENDING_DRIVER_NOTE) next.note = ''
  return next
}

// Řádky, které úplné smazání řidiče odstraní; odpovídá private.rb_delete_driver_completely.
function driverRemovalScope(data = {}, driverId = '') {
  const shiftIds = new Set((data.shifts || []).filter((shift) => shift?.driverId === driverId).map((shift) => shift.id))
  return {
    shifts: (shift) => shiftIds.has(shift?.id),
    settlements: (settlement) => settlement?.driverId === driverId || shiftIds.has(settlement?.shiftId),
    swapRequests: (request) => request?.driverId === driverId || shiftIds.has(request?.shiftId),
    notifications: (notice) => notice?.targetDriverId === driverId || shiftIds.has(notice?.shiftId),
    availability: (row) => row?.driverId === driverId,
    absences: (row) => row?.driverId === driverId,
    pushSubscriptions: (device) => device?.driverId === driverId,
  }
}

export function driverRemovalSummary(data = {}, driverId = '', today = '') {
  const scope = driverRemovalScope(data, driverId)
  const count = (key) => (data[key] || []).filter(scope[key]).length
  return {
    shifts: count('shifts'),
    upcomingShifts: (data.shifts || []).filter((shift) => scope.shifts(shift) && Boolean(today) && String(shift.date || '') >= today).length,
    settlements: count('settlements'),
    swapRequests: count('swapRequests'),
    notifications: count('notifications'),
    availability: count('availability') + count('absences'),
  }
}

// Lokální obdoba private.rb_delete_driver_completely pro režim bez Supabase.
export function withoutDriver(data = {}, driverId = '', now = new Date().toISOString()) {
  const scope = driverRemovalScope(data, driverId)
  const next = { ...data, drivers: (data.drivers || []).filter((driver) => driver?.id !== driverId) }
  for (const key of Object.keys(scope)) {
    if (Array.isArray(data[key])) next[key] = data[key].filter((row) => !scope[key](row))
  }
  next.swapRequests = (next.swapRequests || []).map((request) => (
    ['pending', 'accepted'].includes(request?.status) && (request.targetDriverId === driverId || request.acceptedByDriverId === driverId)
      ? { ...request, status: 'cancelled', cancelledAt: now, resolvedAt: now }
      : request
  ))
  return next
}

export const czechCount = (count, one, few, many) => `${count} ${count === 1 ? one : count >= 2 && count <= 4 ? few : many}`

export function driverRemovalSummaryText(summary = {}, { hasLogin = false } = {}) {
  const parts = [
    czechCount(summary.shifts || 0, 'směna', 'směny', 'směn') + (summary.upcomingShifts ? ` (z toho ${summary.upcomingShifts} budoucí)` : ''),
    czechCount(summary.settlements || 0, 'výčetka', 'výčetky', 'výčetek'),
    czechCount(summary.swapRequests || 0, 'výměna', 'výměny', 'výměn'),
    czechCount(summary.notifications || 0, 'notifikace', 'notifikace', 'notifikací'),
  ]
  if (summary.availability) parts.push('dostupnost a absence')
  if (hasLogin) parts.push('přihlašovací účet')
  return `Smaže se: ${parts.join(', ')}.`
}
