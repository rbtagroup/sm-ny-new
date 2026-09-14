import test from 'node:test'
import assert from 'node:assert/strict'
import { coverageDaysLabel, coverageSlotAppliesOn, coverageSlotDays, toggleCoverageDay } from '../src/lib/coverage.js'
import { coverageGaps } from '../src/lib/opsMetrics.js'
import { coverageSlotAppliesOn as schedulerAppliesOn, normalizeCoverageSlots } from '../supabase/functions/scheduler/coverageSlots.js'

const peak = { id: 'cov_peak', name: 'Pá/Sobota špička', start: '20:00', end: '03:00', minDrivers: 2, days: [5, 6] }

test('coverage slots apply only on their weekdays', () => {
  // 2026-09-18 is a Friday, 2026-09-20 a Sunday
  assert.equal(coverageSlotAppliesOn(peak, '2026-09-18'), true)
  assert.equal(coverageSlotAppliesOn(peak, '2026-09-20'), false)
  assert.equal(coverageSlotAppliesOn({ ...peak, days: undefined }, '2026-09-20'), true)
  assert.equal(coverageSlotDays({ days: [0, 1, 2, 3, 4, 5, 6] }), null)
  assert.equal(coverageDaysLabel(peak), 'Pá, So')
  assert.equal(coverageDaysLabel({}), 'každý den')
})

test('toggling days keeps the list ordered and drops it for every day', () => {
  assert.deepEqual(toggleCoverageDay(peak, 0).days, [5, 6, 0])
  assert.deepEqual(toggleCoverageDay({ id: 'x' }, 3), { id: 'x', days: [1, 2, 4, 5, 6, 0] })
  assert.deepEqual(toggleCoverageDay({ id: 'x', days: [1, 2, 4, 5, 6, 0] }, 3), { id: 'x' })
  assert.deepEqual(toggleCoverageDay({ id: 'x', days: [5] }, 5), { id: 'x' })
})

test('coverage gaps skip slots on other weekdays', () => {
  const data = { settings: { coverageSlots: [peak, { id: 'cov_day', name: 'Den', start: '07:00', end: '19:00', minDrivers: 1 }] }, shifts: [] }
  const gaps = coverageGaps(data, '2026-09-14')
  assert.equal(gaps.filter((gap) => gap.id === 'cov_day').length, 7)
  assert.deepEqual(gaps.filter((gap) => gap.id === 'cov_peak').map((gap) => gap.day), ['2026-09-18', '2026-09-19'])
})

test('the scheduler reads the same weekday rules', () => {
  const [slot] = normalizeCoverageSlots({ coverageSlots: [peak] }, [])
  assert.deepEqual(slot.days, [5, 6])
  for (const day of ['2026-09-14', '2026-09-18', '2026-09-19', '2026-09-20']) assert.equal(schedulerAppliesOn(slot, day), coverageSlotAppliesOn(peak, day), day)
  assert.equal(normalizeCoverageSlots({ coverageSlots: [{ ...peak, minDrivers: 0 }] }, []).length, 0)
  assert.equal(normalizeCoverageSlots({}, [{ id: 'd', name: 'D', start: '07:00', end: '19:00', minDrivers: 1 }]).length, 1)
})
