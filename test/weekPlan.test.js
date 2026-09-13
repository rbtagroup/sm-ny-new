import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHelpers } from '../src/lib/shiftHelpers.js'
import { activeShiftsInWeek, planWeek } from '../src/lib/weekPlan.js'

const fixture = () => ({
  drivers: [
    { id: 'drv_a', name: 'Adam', active: true },
    { id: 'drv_b', name: 'Bára', active: true },
    { id: 'drv_old', name: 'Odešel', active: false },
  ],
  vehicles: [
    { id: 'car_1', name: 'Tesla', plate: 'RB 001', active: true },
    { id: 'car_2', name: 'Tesla', plate: 'RB 002', active: true },
  ],
  shifts: [
    { id: 'src_mon_day', date: '2026-09-14', start: '07:00', end: '19:00', driverId: 'drv_a', vehicleId: 'car_1', type: 'day', status: 'confirmed', note: 'Letiště' },
    { id: 'src_mon_night', date: '2026-09-14', start: '19:00', end: '07:00', driverId: 'drv_old', vehicleId: 'car_2', type: 'night', status: 'confirmed' },
    { id: 'src_tue_declined', date: '2026-09-15', start: '07:00', end: '19:00', driverId: 'drv_b', vehicleId: 'car_2', type: 'day', status: 'declined' },
    { id: 'src_wed_day', date: '2026-09-16', start: '07:00', end: '19:00', driverId: 'drv_b', vehicleId: 'car_2', type: 'day', status: 'completed', actualStartAt: '2026-09-16T07:02', actualEndAt: '2026-09-16T19:01' },
    { id: 'src_thu_day', date: '2026-09-17', start: '07:00', end: '19:00', driverId: 'drv_a', vehicleId: 'car_1', type: 'day', status: 'confirmed' },
    { id: 'src_thu_overlap', date: '2026-09-17', start: '12:00', end: '20:00', driverId: 'drv_a', vehicleId: 'car_2', type: 'custom', status: 'confirmed' },
    { id: 'target_duplicate', date: '2026-09-21', start: '07:00', end: '19:00', driverId: 'drv_a', vehicleId: 'car_1', type: 'day', status: 'assigned' },
    { id: 'target_busy', date: '2026-09-23', start: '08:00', end: '16:00', driverId: 'drv_b', vehicleId: 'car_1', type: 'day', status: 'assigned' },
  ],
  absences: [],
  serviceBlocks: [],
  availability: [],
  settings: { coverageSlots: [{ id: 'slot_day', name: 'Denní', start: '07:00', end: '19:00', minDrivers: 1 }] },
})

const ids = () => {
  let counter = 0
  return (prefix) => `${prefix}_new_${++counter}`
}

test('planWeek copies last week as drafts, skips duplicates and conflicts, and frees shifts of inactive drivers', () => {
  const { planned, skipped } = planWeek({ data: fixture(), targetWeekStart: '2026-09-21', buildHelpers, uid: ids() })

  assert.deepEqual(planned.map(({ shift }) => [shift.date, shift.start, shift.driverId, shift.status]), [
    ['2026-09-21', '19:00', '', 'open'],
    ['2026-09-24', '07:00', 'drv_a', 'draft'],
  ])
  assert.equal(planned[0].shift.vehicleId, 'car_2')
  assert.equal(planned[0].note, 'Řidič už není aktivní, směna bude volná.')

  assert.deepEqual(skipped.map(({ shift, reasons }) => [shift.date, shift.start, reasons[0]]), [
    ['2026-09-21', '07:00', 'Stejná směna už v týdnu je.'],
    ['2026-09-23', '07:00', 'Řidič Bára má ve stejném čase jinou směnu.'],
    ['2026-09-24', '12:00', 'Řidič Adam má ve stejném čase jinou směnu.'],
  ])
})

test('planWeek can keep conflicting copies and clears attendance from completed source shifts', () => {
  const { planned } = planWeek({ data: fixture(), targetWeekStart: '2026-09-21', allowConflicts: true, buildHelpers, uid: ids() })
  const wednesday = planned.find(({ shift }) => shift.date === '2026-09-23')

  assert.ok(wednesday, 'conflicting copy should be kept when allowed')
  assert.equal(wednesday.shift.status, 'draft')
  assert.equal(wednesday.shift.actualStartAt, '')
  assert.equal(wednesday.shift.actualEndAt, '')
  assert.equal(planned.filter(({ shift }) => shift.date === '2026-09-21' && shift.start === '07:00').length, 0, 'exact duplicates stay skipped')
})

test('planWeek fills coverage still missing after the copy with open shifts', () => {
  const { planned } = planWeek({ data: fixture(), targetWeekStart: '2026-09-21', fillGaps: true, buildHelpers, uid: ids() })
  const gapShifts = planned.filter(({ source }) => source === 'gap').map(({ shift }) => shift)

  assert.deepEqual(gapShifts.map((shift) => shift.date), ['2026-09-22', '2026-09-25', '2026-09-26', '2026-09-27'])
  for (const shift of gapShifts) {
    assert.equal(shift.status, 'open')
    assert.equal(shift.driverId, '')
    assert.equal(`${shift.start}–${shift.end}`, '07:00–19:00')
    assert.equal(shift.type, 'day')
  }
})

test('planWeek without copying only fills gaps and ids are unique', () => {
  const { planned, skipped } = planWeek({ data: fixture(), targetWeekStart: '2026-09-21', copyShifts: false, fillGaps: true, buildHelpers, uid: ids() })

  assert.equal(skipped.length, 0)
  assert.deepEqual(planned.map(({ shift }) => shift.date), ['2026-09-22', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'])
  assert.equal(new Set(planned.map(({ shift }) => shift.id)).size, planned.length)
  assert.equal(activeShiftsInWeek(fixture().shifts, '2026-09-14').length, 5, 'declined shifts do not count as planned')
})
