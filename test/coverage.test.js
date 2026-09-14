import test from 'node:test'
import assert from 'node:assert/strict'
import {
  coverageDayRows,
  coverageDaysLabel,
  coverageNeedFor,
  coverageNeedsList,
  coverageSlotAppliesOn,
  coverageSlotDays,
  coverageSlotForm,
  coverageSlotFromForm,
  removeCoverageSlot,
  saveCoverageSlot,
  setCoverageNeedsForDay,
  toggleCoverageDay,
} from '../src/lib/coverage.js'
import { coverageGaps } from '../src/lib/opsMetrics.js'
import { coverageNeedOn, coverageSlotAppliesOn as schedulerAppliesOn, normalizeCoverageNeeds, normalizeCoverageSlots } from '../supabase/functions/scheduler/coverageSlots.js'

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
  // a slot with no usual need still counts on days with a need of their own
  assert.equal(normalizeCoverageSlots({ coverageSlots: [{ ...peak, minDrivers: 0 }] }, []).length, 1)
  assert.equal(normalizeCoverageSlots({}, [{ id: 'd', name: 'D', start: '07:00', end: '19:00', minDrivers: 1 }]).length, 1)
  // deleted norms stay deleted instead of falling back to the defaults
  assert.equal(normalizeCoverageSlots({ coverageSlots: [] }, [{ id: 'd', name: 'D', start: '07:00', end: '19:00', minDrivers: 1 }]).length, 0)
})

const night = { id: 'cov_night', name: 'Noc', start: '22:00', end: '06:00', minDrivers: 1 }

test('a need set for one day wins over the weekly norm, also on days the slot normally skips', () => {
  const needs = coverageNeedsList({ coverageNeeds: [{ date: '2026-09-20', slotId: 'cov_peak', minDrivers: 10 }, { date: 'nonsense', slotId: 'x', minDrivers: 3 }, { date: '2026-09-19', slotId: 'cov_peak', minDrivers: '150' }] })
  assert.deepEqual(needs, [{ date: '2026-09-20', slotId: 'cov_peak', minDrivers: 10 }, { date: '2026-09-19', slotId: 'cov_peak', minDrivers: 99 }])
  assert.deepEqual(coverageNeedFor(peak, '2026-09-18', needs), { base: 2, need: 2, override: false })
  assert.deepEqual(coverageNeedFor(peak, '2026-09-20', needs), { base: 0, need: 10, override: true })
})

test('day rows count shifts, open shifts and what is still missing', () => {
  const data = {
    settings: { coverageSlots: [night, peak], coverageNeeds: [{ date: '2026-09-19', slotId: 'cov_night', minDrivers: 4 }] },
    shifts: [
      { id: 'a', date: '2026-09-19', start: '22:00', end: '06:00', driverId: 'd1', status: 'confirmed' },
      { id: 'b', date: '2026-09-19', start: '22:00', end: '06:00', driverId: '', status: 'open' },
      { id: 'c', date: '2026-09-19', start: '22:00', end: '06:00', driverId: 'd2', status: 'declined' },
    ],
  }
  const rows = coverageDayRows(data, '2026-09-19')
  assert.deepEqual(rows.map((row) => row.id), ['cov_peak', 'cov_night'])
  // the night shifts also cover the Saturday peak, so only the night still misses drivers
  const nightRow = rows.find((row) => row.id === 'cov_night')
  assert.deepEqual([nightRow.need, nightRow.base, nightRow.override, nightRow.planned, nightRow.open, nightRow.missing], [4, 1, true, 2, 1, 2])
  assert.deepEqual(coverageGaps(data, '2026-09-14').filter((gap) => gap.day === '2026-09-19').map((gap) => [gap.id, gap.need, gap.missing]), [['cov_night', 4, 2]])
})

test('saving the needs of a day keeps only real changes and forgets old or orphaned entries', () => {
  const settings = {
    coverageSlots: [night, peak],
    coverageNeeds: [
      { date: '2026-01-02', slotId: 'cov_night', minDrivers: 5 },
      { date: '2026-09-25', slotId: 'cov_night', minDrivers: 3 },
      { date: '2026-09-26', slotId: 'gone', minDrivers: 3 },
      { date: '2026-09-19', slotId: 'cov_peak', minDrivers: 6 },
    ],
  }
  const next = setCoverageNeedsForDay(settings, '2026-09-19', { cov_night: 10, cov_peak: 2 }, '2026-09-14')
  assert.deepEqual(next.coverageNeeds, [
    { date: '2026-09-19', slotId: 'cov_night', minDrivers: 10 },
    { date: '2026-09-25', slotId: 'cov_night', minDrivers: 3 },
  ])
  // untouched slots of the day keep their entry
  assert.deepEqual(setCoverageNeedsForDay(settings, '2026-09-19', { cov_night: 1 }, '2026-09-14').coverageNeeds.filter((entry) => entry.date === '2026-09-19'), [{ date: '2026-09-19', slotId: 'cov_peak', minDrivers: 6 }])
})

test('norm form validates the slot and stores days only when some are left out', () => {
  assert.match(coverageSlotFromForm({ name: ' ', start: '07:00', end: '19:00', days: [1] }, 'x').error, /název/)
  assert.match(coverageSlotFromForm({ name: 'Den', start: '07:00', end: '07:00', days: [1] }, 'x').error, /lišit/)
  assert.match(coverageSlotFromForm({ name: 'Den', start: '07:00', end: '19:00', days: [] }, 'x').error, /den/)
  assert.deepEqual(coverageSlotFromForm({ name: ' Ples ', start: '20:00', end: '04:00', minDrivers: '10', days: [6, 5] }, 'cov_ples').slot, { id: 'cov_ples', name: 'Ples', start: '20:00', end: '04:00', minDrivers: 10, days: [5, 6] })
  assert.equal('days' in coverageSlotFromForm(coverageSlotForm(night), 'cov_night').slot, false)
  assert.deepEqual(coverageSlotForm(peak).days, [5, 6])
})

test('adding, editing and removing slots keeps the needs consistent', () => {
  const settings = { coverageSlots: [night], coverageNeeds: [{ date: '2026-09-19', slotId: 'cov_night', minDrivers: 4 }] }
  const added = saveCoverageSlot(settings, peak)
  assert.deepEqual(added.coverageSlots.map((slot) => slot.id), ['cov_night', 'cov_peak'])
  assert.equal(saveCoverageSlot(added, { ...night, minDrivers: 3 }).coverageSlots[0].minDrivers, 3)
  const removed = removeCoverageSlot(added, 'cov_night')
  assert.deepEqual(removed.coverageSlots.map((slot) => slot.id), ['cov_peak'])
  assert.deepEqual(removed.coverageNeeds, [])
})

test('the scheduler applies needs of particular days the same way', () => {
  const payload = { coverageSlots: [night, { ...peak, minDrivers: 0 }], coverageNeeds: [{ date: '2026-09-20', slotId: 'cov_peak', minDrivers: 8 }, { date: '2026-09-19', slotId: 'cov_night', minDrivers: 0 }] }
  const slots = normalizeCoverageSlots(payload, [])
  const needs = normalizeCoverageNeeds(payload)
  const appNeeds = coverageNeedsList(payload)
  for (const day of ['2026-09-18', '2026-09-19', '2026-09-20']) {
    for (const slot of slots) {
      const appSlot = payload.coverageSlots.find((item) => item.id === slot.id)
      assert.equal(coverageNeedOn(slot, day, needs), coverageNeedFor(appSlot, day, appNeeds).need, `${slot.id} ${day}`)
    }
  }
  assert.equal(coverageNeedOn(slots[1], '2026-09-20', needs), 8)
  assert.equal(coverageNeedOn(slots[0], '2026-09-19', needs), 0)
})
