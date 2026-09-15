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

// "4 200", "4 200" (as cs-CZ formats it) and "12,5" all read as numbers
const settlementNumberText = (value) => String(value ?? '').replace(/\s/g, '')

export function settlementNumber(value) {
  const parsed = Number.parseFloat(settlementNumberText(value).replace(',', '.'))
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

export const settlementFieldLabels = {
  kmStart: 'Počáteční km',
  kmEnd: 'Konečné km',
  trzba: 'Tržba',
  pristavne: 'Přístavné',
  kartou: 'Kartou',
  fakturou: 'Fakturou',
  palivo: 'Palivo',
  myti: 'Mytí',
  jine: 'Jiné náklady',
  cashActual: 'Hotovost u sebe',
  iacCount: 'Jízdy IAC',
  shkmCount: 'Jízdy SHKM',
}

// What is wrong with each field, so the form can point at it; the first message of each field also feeds the list below.
export function settlementFieldErrors(inputs = {}, config = {}) {
  const values = normalizeSettlementInputs(inputs)
  const errors = {}
  if (!values.driver) errors.driver = 'Chybí jméno řidiče.'
  // text that is not a number would otherwise count as 0 or as its leading digits ("12abc" as 12)
  for (const key of Object.keys(settlementFieldLabels)) {
    const text = settlementNumberText(inputs[key])
    if (text && !/^-?\d+(?:[.,]\d+)?$/.test(text)) errors[key] = `${settlementFieldLabels[key]}: zadejte číslo.`
  }
  for (const key of ['kmStart', 'kmEnd', 'pristavne', 'kartou', 'fakturou', 'palivo', 'myti', 'jine', 'cashActual', 'iacCount', 'shkmCount']) {
    if (!errors[key] && values[key] < 0) errors[key] = `${settlementFieldLabels[key]} nemůže být záporné.`
  }
  if (!errors.kmStart && !errors.kmEnd && values.kmEnd < values.kmStart) errors.kmEnd = 'Konečný stav tachometru je menší než počáteční.'
  if (!errors.trzba && values.trzba <= 0) errors.trzba = 'Tržba musí být větší než 0.'
  for (const key of ['iacCount', 'shkmCount']) {
    if (!errors[key] && !Number.isInteger(values[key])) errors[key] = `${settlementFieldLabels[key]}: zadejte celé číslo.`
  }
  const metrics = computeSettlementMetrics(inputs, config)
  if (!errors.iacCount && !errors.shkmCount && metrics.invoiceKm > metrics.kmReal) errors.iacCount = `Smluvní km (${metrics.invoiceKm.toLocaleString('cs-CZ')}) jsou vyšší než najeté km (${metrics.kmReal.toLocaleString('cs-CZ')}).`
  return errors
}

export function validateSettlementInputs(inputs = {}, config = {}) {
  return [...new Set(Object.values(settlementFieldErrors(inputs, config)))]
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
