import { availabilityStateForShift } from './availability.js'
import { dateInRange, overlapsShift } from './dateTime.js'

export function buildHelpers(data) {
  const driver = (id) => data.drivers.find((d) => d.id === id)
  const vehicle = (id) => data.vehicles.find((v) => v.id === id)
  const driverName = (id) => driver(id)?.name || 'Neobsazeno'
  const vehicleName = (id) => {
    const car = vehicle(id)
    return car ? `${car.name} · ${car.plate}` : 'Bez vozu'
  }
  const conflictMessages = (shift) => {
    if (!shift || ['cancelled', 'declined'].includes(shift.status)) return []
    const conflicts = []
    const d = driver(shift.driverId)
    const v = vehicle(shift.vehicleId)
    if (!shift.date || !shift.start || !shift.end) conflicts.push('Chybí datum nebo čas směny.')
    if (!d && shift.status !== 'open') conflicts.push('Není vybraný řidič.')
    if (!v && shift.status !== 'open') conflicts.push('Není vybrané vozidlo.')
    if (d && !d.active) conflicts.push(`Řidič ${d.name} je vyřazený.`)
    if (v && !v.active) conflicts.push(`Vozidlo ${v.name} je vyřazené.`)
    data.shifts.forEach((other) => {
      if (other.id === shift.id || ['cancelled', 'declined'].includes(other.status)) return
      if (!shift.date || !other.date || !shift.start || !shift.end || !other.start || !other.end) return
      if (shift.driverId && other.driverId === shift.driverId && overlapsShift(shift, other)) conflicts.push(`Řidič ${driverName(shift.driverId)} má ve stejném čase jinou směnu.`)
      if (shift.vehicleId && other.vehicleId === shift.vehicleId && overlapsShift(shift, other)) conflicts.push(`Vozidlo ${vehicleName(shift.vehicleId)} je ve stejném čase v jiné směně.`)
    })
    if (shift.driverId) data.absences.forEach((a) => {
      if (a.driverId === shift.driverId && dateInRange(shift.date, a.from, a.to)) conflicts.push(`Řidič ${driverName(shift.driverId)} má nepřítomnost: ${a.reason || 'bez důvodu'}.`)
    })
    if (shift.vehicleId) data.serviceBlocks.forEach((s) => {
      if (s.vehicleId === shift.vehicleId && dateInRange(shift.date, s.from, s.to)) conflicts.push(`Vozidlo ${vehicleName(shift.vehicleId)} je blokované: ${s.reason || 'servis'}.`)
    })
    const availability = shift.driverId ? availabilityStateForShift((data.availability || []).filter((a) => a.driverId === shift.driverId), shift) : ''
    if (availability === 'unavailable') conflicts.push(`Řidič ${driverName(shift.driverId)} je v tomto čase nedostupný.`)
    if (availability === 'outside') conflicts.push(`Řidič ${driverName(shift.driverId)} nemá v tomto čase zadanou dostupnost.`)
    return [...new Set(conflicts)]
  }
  return { driver, vehicle, driverName, vehicleName, conflictMessages }
}
