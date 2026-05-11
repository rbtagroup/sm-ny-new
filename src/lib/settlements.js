import { intervalForShift, plannedDurationMinutes } from './dateTime.js'

export const settlementConfigDefaults = {
  commRate: 30,
  baseFull: 1000,
  baseHalf: 500,
  minTrzbaPerKm: 15,
  iacKmPerRide: 33,
  shkmKmPerRide: 7,
}

export const settlementInputDefaults = {
  driver: '',
  shift: 'den',
  rz: '',
  kmStart: '',
  kmEnd: '',
  trzba: '',
  pristavne: '',
  palivo: '',
  myti: '',
  kartou: '',
  fakturou: '',
  jine: '',
  cashActual: '',
  iacCount: '',
  shkmCount: '',
  note: '',
}

const settlementShiftLabels = {
  den: 'Denní',
  noc: 'Noční',
  odpo: 'Odpolední',
  pul: '1/2 směna',
  day: 'Denní',
  night: 'Noční',
  backup: 'Záloha',
  transfer: 'Převoz',
  custom: 'Vlastní',
}

const settlementMoney = (value) => `${Math.round(Number(value || 0)).toLocaleString('cs-CZ')} Kč`

export function settlementNumber(value) {
  const parsed = Number.parseFloat(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

export function settlementShiftCode(shift = {}) {
  const planned = plannedDurationMinutes(shift)
  if (planned > 0 && planned <= 6 * 60) return 'pul'
  if (shift.type === 'night') return 'noc'
  return 'den'
}

export function settlementShiftLabel(code) {
  return settlementShiftLabels[code] || code || '-'
}

export function settlementDefaultInputs(shift, data = {}, helpers = {}, existing = {}) {
  const driver = (data.drivers || []).find((d) => d.id === shift?.driverId)
  const vehicle = helpers.vehicle?.(shift?.vehicleId)
  return {
    ...settlementInputDefaults,
    driver: driver?.name || helpers.driverName?.(shift?.driverId) || '',
    shift: settlementShiftCode(shift),
    rz: vehicle?.plate || '',
    ...(existing || {}),
  }
}

export function normalizeSettlementInputs(inputs = {}) {
  return {
    driver: String(inputs.driver || '').trim(),
    shift: inputs.shift || 'den',
    rz: String(inputs.rz || '').trim(),
    kmStart: settlementNumber(inputs.kmStart),
    kmEnd: settlementNumber(inputs.kmEnd),
    trzba: settlementNumber(inputs.trzba),
    pristavne: settlementNumber(inputs.pristavne),
    palivo: settlementNumber(inputs.palivo),
    myti: settlementNumber(inputs.myti),
    kartou: settlementNumber(inputs.kartou),
    fakturou: settlementNumber(inputs.fakturou),
    jine: settlementNumber(inputs.jine),
    cashActual: settlementNumber(inputs.cashActual),
    hasCashActual: String(inputs.cashActual ?? '').trim() !== '',
    iacCount: settlementNumber(inputs.iacCount),
    shkmCount: settlementNumber(inputs.shkmCount),
  }
}

export function computeSettlementMetrics(inputs = {}, config = {}) {
  const cfg = { ...settlementConfigDefaults, ...(config || {}) }
  const values = normalizeSettlementInputs(inputs)
  const kmReal = Math.max(0, values.kmEnd - values.kmStart)
  const iacKm = values.iacCount * cfg.iacKmPerRide
  const shkmKm = values.shkmCount * cfg.shkmKmPerRide
  const invoiceKm = iacKm + shkmKm
  const chargedKm = Math.max(0, kmReal - invoiceKm)
  const minTrzba = chargedKm * cfg.minTrzbaPerKm
  const netto = values.trzba - values.pristavne
  const nonCash = values.kartou + values.fakturou
  const costs = values.palivo + values.myti + values.jine
  const fixedPayout = values.shift === 'pul' ? cfg.baseHalf : cfg.baseFull
  const commissionRate = cfg.commRate / 100
  const threshold = commissionRate > 0 ? fixedPayout / commissionRate : Number.POSITIVE_INFINITY
  const usesPercentage = netto > threshold
  const vyplata = netto > 0 ? Math.round(usesPercentage ? netto * commissionRate : fixedPayout) : 0
  const doplatek = Math.max(0, minTrzba - values.trzba)
  const delta = values.trzba - minTrzba
  const kOdevzdani = values.trzba - values.palivo - values.myti - values.kartou - values.fakturou - values.jine - vyplata
  const settlement = kOdevzdani + doplatek
  const cashExpected = settlement + vyplata
  const cashDiff = values.hasCashActual ? values.cashActual - cashExpected : 0

  return {
    ...values,
    config: cfg,
    shiftLabel: settlementShiftLabel(values.shift),
    kmReal,
    chargedKm,
    invoiceKm,
    iacKm,
    shkmKm,
    minTrzba,
    netto,
    nonCash,
    costs,
    usesPercentage,
    payoutMode: usesPercentage ? `Provize ${cfg.commRate} %` : `Fix ${settlementMoney(fixedPayout)}`,
    vyplata,
    doplatek,
    delta,
    kOdevzdani,
    settlement,
    cashExpected,
    cashDiff,
    nedoplatek: doplatek > 0,
  }
}

export function validateSettlementInputs(inputs = {}, config = {}) {
  const values = normalizeSettlementInputs(inputs)
  const errors = []
  if (!values.driver) errors.push('Vyplň jméno řidiče.')
  if (values.kmStart < 0) errors.push('Počáteční km nemohou být záporné.')
  if (values.kmEnd < 0) errors.push('Konečné km nemohou být záporné.')
  if (values.kmEnd < values.kmStart) errors.push('Konečný stav tachometru je menší než počáteční.')
  if (values.trzba <= 0) errors.push('Tržba musí být větší než 0.')
  ;['pristavne','palivo','myti','kartou','fakturou','jine','cashActual','iacCount','shkmCount'].forEach((key) => {
    if (values[key] < 0) errors.push(`${key} nesmí být záporné.`)
  })
  ;['iacCount','shkmCount'].forEach((key) => {
    if (!Number.isInteger(values[key])) errors.push(`${key} musí být celé číslo.`)
  })
  const metrics = computeSettlementMetrics(inputs, config)
  if (metrics.invoiceKm > metrics.kmReal) errors.push(`Smluvní km (${metrics.invoiceKm.toLocaleString('cs-CZ')}) jsou vyšší než najeté km (${metrics.kmReal.toLocaleString('cs-CZ')}).`)
  return [...new Set(errors)]
}

export function settlementForShift(data = {}, shiftId) {
  return (data.settlements || []).find((settlement) => settlement.shiftId === shiftId)
}

export function canOpenSettlement(shift) {
  return Boolean(shift?.actualEndAt || shift?.status === 'completed')
}

export function settlementNeedsDriverAction(settlement) {
  return !settlement || ['draft', 'returned'].includes(settlement.status)
}

export function settlementIsClosed(settlement) {
  return ['submitted', 'approved'].includes(settlement?.status)
}

export function shiftNeedsSettlementAction(shift, settlement) {
  return canOpenSettlement(shift) && settlementNeedsDriverAction(settlement)
}

export function shiftIsInStartWindow(shift, now = Date.now()) {
  if (!shift || shift.status !== 'confirmed' || shift.actualStartAt) return false
  const [startAt, endAt] = intervalForShift(shift)
  return now >= startAt - 60 * 60 * 1000 && now <= Math.max(endAt, startAt + 30 * 60 * 1000)
}
