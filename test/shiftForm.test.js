import test from 'node:test'
import assert from 'node:assert/strict'
import { gapShiftPreset, repeatPreviewText, repeatShiftDates, selectableRecords } from '../src/lib/shiftForm.js'

test('week repeats start at the chosen day and never create earlier days', () => {
  // 2026-09-16 is a Wednesday
  assert.deepEqual(repeatShiftDates('2026-09-16', 'workweek'), ['2026-09-16', '2026-09-17', '2026-09-18'])
  assert.deepEqual(repeatShiftDates('2026-09-14', 'workweek'), ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'])
  assert.deepEqual(repeatShiftDates('2026-09-20', 'weekend'), ['2026-09-20'])
  assert.deepEqual(repeatShiftDates('2026-09-19', 'workweek'), [])
  assert.deepEqual(repeatShiftDates('2026-09-16', 'daily7'), ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22'])
  assert.deepEqual(repeatShiftDates('2026-09-16', 'none'), ['2026-09-16'])
})

test('repeat preview names every created day', () => {
  assert.equal(repeatPreviewText(['2026-09-16', '2026-09-17']), 'Vytvoří se 2 směny: st 16. 09., čt 17. 09.')
  assert.match(repeatPreviewText([]), /nevznikne žádná směna/)
})

test('inactive drivers stay out of the picker unless already on the shift', () => {
  const drivers = [{ id: 'a', active: true }, { id: 'b', active: false }, { id: 'c' }]
  assert.deepEqual(selectableRecords(drivers).map((d) => d.id), ['a', 'c'])
  assert.deepEqual(selectableRecords(drivers, 'b').map((d) => d.id), ['a', 'b', 'c'])
})

test('missing coverage prefills the day, time and matching template', () => {
  const settings = { shiftTemplates: [{ id: 'tpl_night', name: 'Noční', start: '19:00', end: '07:00', type: 'night', active: true }] }
  assert.deepEqual(gapShiftPreset({ day: '2026-09-15', id: 'cov_night', name: 'Noční', start: '19:00', end: '07:00' }, settings), {
    date: '2026-09-15', start: '19:00', end: '07:00', type: 'night', template: 'tpl_night', note: '',
  })
  assert.deepEqual(gapShiftPreset({ day: '2026-09-18', name: 'Akce / plesy', start: '18:00', end: '02:00' }, settings), {
    date: '2026-09-18', start: '18:00', end: '02:00', type: 'custom', template: 'custom', note: 'Akce / plesy',
  })
})

test('date ranges read as Czech dates', async () => {
  const { dateRangeLabel } = await import('../src/lib/display.js')
  assert.equal(dateRangeLabel('2026-09-14', '2026-09-16'), 'po 14. 09. – st 16. 09.')
  assert.equal(dateRangeLabel('2026-09-14', '2026-09-14'), 'po 14. 09.')
  assert.equal(dateRangeLabel('2026-09-14T08:00', ''), '2026-09-14T08:00')
})

test('driver picker puts drivers who can drive first and says why others cannot', async () => {
  const { driverChoices } = await import('../src/lib/shiftForm.js')
  const data = {
    drivers: [
      { id: 'busy', name: 'Milan', active: true },
      { id: 'free', name: 'Roman', active: true },
      { id: 'absent', name: 'Anna', active: true },
      { id: 'cannot', name: 'Petra', active: true },
      { id: 'ready', name: 'Lukáš', active: true },
      { id: 'gone', name: 'Old', active: false },
    ],
    shifts: [{ id: 'other', driverId: 'busy', date: '2026-09-21', start: '12:00', end: '20:00', status: 'confirmed' }],
    absences: [{ id: 'abs', driverId: 'absent', from: '2026-09-20', to: '2026-09-22', reason: 'dovolená' }],
    availability: [
      { id: 'a1', driverId: 'cannot', weekday: 1, start: '06:00', end: '18:00', note: '[unavailable] škola' },
      { id: 'a2', driverId: 'ready', weekday: 1, start: '06:00', end: '20:00', note: '[available]' },
    ],
  }
  const shift = { id: 'new', date: '2026-09-21', start: '07:00', end: '19:00' }
  assert.deepEqual(driverChoices(data, shift).map((c) => `${c.driver.name}:${c.state}`), ['Lukáš:available', 'Roman:free', 'Milan:busy', 'Petra:unavailable', 'Anna:absent'])
  assert.equal(driverChoices(data, shift).find((c) => c.driver.id === 'busy').note, 'má směnu 12:00–20:00')
  assert.equal(driverChoices(data, shift, 'gone').at(-1).state, 'inactive')
})

test('unavailable entries are conflicts, not availability', async () => {
  const { buildHelpers } = await import('../src/lib/shiftHelpers.js')
  const data = {
    drivers: [{ id: 'petra', name: 'Petra', active: true }],
    vehicles: [{ id: 'car', name: 'Tesla', plate: 'RB 001', active: true }],
    shifts: [], absences: [], serviceBlocks: [],
    availability: [{ id: 'a1', driverId: 'petra', weekday: 1, start: '06:00', end: '18:00', note: '[unavailable]' }],
  }
  const messages = buildHelpers(data).conflictMessages({ id: 's', date: '2026-09-21', start: '07:00', end: '15:00', driverId: 'petra', vehicleId: 'car', status: 'assigned' })
  assert.deepEqual(messages, ['Řidič Petra je v tomto čase nedostupný.'])
  const evening = buildHelpers(data).conflictMessages({ id: 's', date: '2026-09-21', start: '19:00', end: '23:00', driverId: 'petra', vehicleId: 'car', status: 'assigned' })
  assert.deepEqual(evening, [])
})

test('templates are recognised from the shift times', async () => {
  const { matchingTemplateId } = await import('../src/lib/shiftForm.js')
  const settings = { shiftTemplates: [{ id: 'tpl_day', name: 'Denní', start: '07:00', end: '19:00', type: 'day', active: true }] }
  assert.equal(matchingTemplateId(settings, '07:00', '19:00'), 'tpl_day')
  assert.equal(matchingTemplateId(settings, '08:00', '19:00'), 'custom')
})

test('filling a slot creates a shift for each picked driver and open shifts for the rest', async () => {
  const { coverShifts } = await import('../src/lib/shiftForm.js')
  let counter = 0
  const settings = { shiftTemplates: [{ id: 'tpl_night', name: 'Noční', start: '19:00', end: '07:00', type: 'night', active: true }] }
  const gap = { day: '2026-09-19', id: 'cov_night', name: 'Noc', start: '19:00', end: '07:00' }
  const shifts = coverShifts({ gap, picks: [{ driverId: 'd1', vehicleId: 'car1' }, { driverId: 'd2', vehicleId: '' }], openCount: 2, confirmed: true, settings, uid: (prefix) => `${prefix}_${++counter}` })
  assert.deepEqual(shifts.map((shift) => [shift.id, shift.driverId, shift.vehicleId, shift.status]), [
    ['sh_1', 'd1', 'car1', 'confirmed'],
    ['sh_2', 'd2', '', 'confirmed'],
    ['sh_3', '', '', 'open'],
    ['sh_4', '', '', 'open'],
  ])
  assert.ok(shifts.every((shift) => shift.date === '2026-09-19' && shift.start === '19:00' && shift.end === '07:00' && shift.type === 'night' && shift.note === ''))
  assert.equal(coverShifts({ gap, picks: [{ driverId: 'd1' }], settings: {}, uid: (prefix) => `${prefix}_x` })[0].status, 'assigned')
})

test('a batch reports cars used twice and lists drivers still without a car together', async () => {
  const { coverBatchProblems, coverShifts, vehicleChoices } = await import('../src/lib/shiftForm.js')
  const { buildHelpers } = await import('../src/lib/shiftHelpers.js')
  const data = {
    drivers: [{ id: 'd1', name: 'Roman', active: true }, { id: 'd2', name: 'Petra', active: true }, { id: 'd3', name: 'Milan', active: true }],
    vehicles: [{ id: 'car1', name: 'Tesla', plate: 'RB 001', active: true }, { id: 'car2', name: 'Octavia', plate: 'RB 002', active: true }, { id: 'car3', name: 'VAN', plate: 'RB 007', active: true }, { id: 'car4', name: 'Staré', plate: 'RB 000', active: false }],
    shifts: [{ id: 'old', date: '2026-09-19', start: '18:00', end: '23:00', driverId: 'd9', vehicleId: 'car2', status: 'confirmed' }],
    absences: [],
    serviceBlocks: [{ vehicleId: 'car3', from: '2026-09-18', to: '2026-09-20', reason: 'pneu' }],
    availability: [],
  }
  let counter = 0
  const gap = { day: '2026-09-19', id: 'cov_night', name: 'Noc', start: '22:00', end: '06:00' }
  const shifts = coverShifts({ gap, picks: [{ driverId: 'd1', vehicleId: 'car1' }, { driverId: 'd2', vehicleId: 'car1' }, { driverId: 'd3', vehicleId: '' }], uid: (prefix) => `${prefix}_${++counter}` })
  const problems = coverBatchProblems(data, shifts, buildHelpers)
  assert.deepEqual(problems, ['Zatím bez vozu: Milan.', 'Vozidlo Tesla · RB 001 je ve stejném čase v jiné směně.'])
  assert.deepEqual(vehicleChoices(data, { id: 'slot', date: gap.day, start: gap.start, end: gap.end }).map((choice) => [choice.vehicle.id, choice.state, choice.note]), [
    ['car1', 'free', ''],
    ['car2', 'busy', 'jede 18:00–23:00'],
    ['car3', 'blocked', 'servis: pneu'],
  ])
})
