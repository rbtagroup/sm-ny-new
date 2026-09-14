// Pásma pokrytí ze sdíleného nastavení. Pásmo bez `days` platí každý den, jinak jen v uvedené dny týdne (0 = neděle).
// Uložený seznam pásem platí i prázdný (dispečink je smazal); výchozí pásma jen když nastavení pásma vůbec nemá.
export function normalizeCoverageSlots(payload = {}, defaults = []) {
  const slots = Array.isArray(payload?.coverageSlots) ? payload.coverageSlots : defaults
  return slots
    .map((slot, index) => {
      const days = Array.isArray(slot.days) ? [...new Set(slot.days.map(Number).filter((day) => day >= 0 && day <= 6))] : []
      return {
        id: String(slot.id || `slot_${index + 1}`),
        name: String(slot.name || `Pásmo ${index + 1}`),
        start: String(slot.start || '07:00').slice(0, 5),
        end: String(slot.end || '19:00').slice(0, 5),
        minDrivers: clampNeed(slot.minDrivers),
        days: days.length && days.length < 7 ? days : null,
      }
    })
    .filter((slot) => slot.start && slot.end)
}

// Potřeba nastavená na konkrétní den (např. ples: 10 řidičů na noc), jeden záznam na den a pásmo.
export function normalizeCoverageNeeds(payload = {}) {
  const byKey = new Map()
  for (const entry of Array.isArray(payload?.coverageNeeds) ? payload.coverageNeeds : []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry?.date || '')) || !entry?.slotId) continue
    byKey.set(`${entry.date}|${entry.slotId}`, { date: entry.date, slotId: String(entry.slotId), minDrivers: clampNeed(entry.minDrivers) })
  }
  return [...byKey.values()]
}

export function coverageSlotAppliesOn(slot, dateISO) {
  if (!slot?.days) return true
  const [y, m, d] = String(dateISO).split('-').map(Number)
  return slot.days.includes(new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay())
}

// Kolik řidičů pásmo v daný den potřebuje: potřeba na konkrétní den má přednost před týdenní normou.
export function coverageNeedOn(slot, dateISO, needs = []) {
  const entry = needs.find((item) => item.date === dateISO && item.slotId === slot.id)
  if (entry) return entry.minDrivers
  return coverageSlotAppliesOn(slot, dateISO) ? slot.minDrivers : 0
}

function clampNeed(value) {
  return Math.min(99, Math.max(0, Math.round(Number(value) || 0)))
}
