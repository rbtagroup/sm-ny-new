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
