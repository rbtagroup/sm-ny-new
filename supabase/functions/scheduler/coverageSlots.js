// Pásma pokrytí ze sdíleného nastavení. Pásmo bez `days` platí každý den, jinak jen v uvedené dny týdne (0 = neděle).
export function normalizeCoverageSlots(payload = {}, defaults = []) {
  const fromSettings = Array.isArray(payload?.coverageSlots) ? payload.coverageSlots : []
  const slots = fromSettings.length ? fromSettings : defaults
  return slots
    .map((slot, index) => {
      const days = Array.isArray(slot.days) ? [...new Set(slot.days.map(Number).filter((day) => day >= 0 && day <= 6))] : []
      return {
        id: String(slot.id || `slot_${index + 1}`),
        name: String(slot.name || `Pásmo ${index + 1}`),
        start: String(slot.start || '07:00').slice(0, 5),
        end: String(slot.end || '19:00').slice(0, 5),
        minDrivers: Math.max(0, Number(slot.minDrivers || 0)),
        days: days.length && days.length < 7 ? days : null,
      }
    })
    .filter((slot) => slot.minDrivers && slot.start && slot.end)
}

export function coverageSlotAppliesOn(slot, dateISO) {
  if (!slot?.days) return true
  const [y, m, d] = String(dateISO).split('-').map(Number)
  return slot.days.includes(new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay())
}
