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
