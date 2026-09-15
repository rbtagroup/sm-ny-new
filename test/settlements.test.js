import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeSettlementMetrics,
  settlementDefaultInputs,
  shiftIsInStartWindow,
  validateSettlementInputs,
} from '../src/lib/settlements.js'

test('computeSettlementMetrics calculates payout, invoice kilometers, and cash diff', () => {
  const metrics = computeSettlementMetrics({
    driver: 'Roman',
    shift: 'den',
    kmStart: '1000',
    kmEnd: '1100',
    trzba: '2500',
    pristavne: '100',
    palivo: '400',
    myti: '50',
    kartou: '600',
    fakturou: '300',
    jine: '20',
    cashActual: '1130',
    iacCount: '1',
    shkmCount: '2',
  })

  assert.equal(metrics.kmReal, 100)
  assert.equal(metrics.invoiceKm, 47)
  assert.equal(metrics.chargedKm, 53)
  assert.equal(metrics.minTrzba, 795)
  assert.equal(metrics.vyplata, 1000)
  assert.equal(metrics.settlement, 130)
  assert.equal(metrics.cashExpected, 1130)
  assert.equal(metrics.cashDiff, 0)
  assert.equal(metrics.payoutMode.replace(/\s/g, ' '), 'Fix 1 000 Kč')
})

test('validateSettlementInputs rejects impossible tachometer and invoice kilometers', () => {
  assert.ok(validateSettlementInputs({
    driver: 'Roman',
    kmStart: '100',
    kmEnd: '90',
    trzba: '100',
  }).includes('Konečný stav tachometru je menší než počáteční.'))

  assert.ok(validateSettlementInputs({
    driver: 'Roman',
    kmStart: '0',
    kmEnd: '10',
    trzba: '100',
    iacCount: '1',
  }).some((error) => error.startsWith('Smluvní km')))
})

test('settlementDefaultInputs derives driver, plate, and half-shift code', () => {
  const inputs = settlementDefaultInputs(
    { id: 'sh_1', date: '2026-05-11', start: '07:00', end: '12:00', driverId: 'drv_1', vehicleId: 'car_1' },
    { drivers: [{ id: 'drv_1', name: 'Roman' }] },
    { vehicle: () => ({ plate: 'RB 001' }) },
  )

  assert.equal(inputs.driver, 'Roman')
  assert.equal(inputs.rz, 'RB 001')
  assert.equal(inputs.shift, 'pul')
})

test('shiftIsInStartWindow accepts one hour before start through active shift span', () => {
  const shift = { date: '2026-05-11', start: '07:00', end: '19:00', status: 'confirmed', actualStartAt: '' }
  assert.equal(shiftIsInStartWindow(shift, new Date('2026-05-11T06:00:00').getTime()), true)
  assert.equal(shiftIsInStartWindow(shift, new Date('2026-05-11T05:59:00').getTime()), false)
})

test('settlement errors point at the field with a readable message', async () => {
  const { settlementFieldErrors } = await import('../src/lib/settlements.js')
  assert.deepEqual(settlementFieldErrors({ driver: 'Roman', kmStart: '120', kmEnd: '100', trzba: '', palivo: '-5', iacCount: '1.5' }), {
    palivo: 'Palivo nemůže být záporné.',
    kmEnd: 'Konečný stav tachometru je menší než počáteční.',
    trzba: 'Tržba musí být větší než 0.',
    iacCount: 'Jízdy IAC: zadejte celé číslo.',
  })
  assert.deepEqual(settlementFieldErrors({ driver: 'Roman', kmStart: '0', kmEnd: '300', trzba: '2500' }), {})
  assert.deepEqual(settlementFieldErrors({ driver: 'Roman', kmStart: '152 300', kmEnd: '152 545', trzba: '4 200,50', palivo: '350', cashActual: '' }), {})
  assert.deepEqual(settlementFieldErrors({ driver: 'Roman', kmStart: '100', kmEnd: '12abc', trzba: '2500', myti: '1.2.3' }), {
    kmEnd: 'Konečné km: zadejte číslo.',
    myti: 'Mytí: zadejte číslo.',
  })
})

test('settlement numbers ignore spaces used as thousands separators', async () => {
  const { settlementNumber } = await import('../src/lib/settlements.js')
  assert.equal(settlementNumber('4 200'), 4200)
  assert.equal(settlementNumber('4 200,5'), 4200.5)
  assert.equal(settlementNumber(''), 0)
})
