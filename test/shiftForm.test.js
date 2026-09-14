import test from 'node:test'
import assert from 'node:assert/strict'
import { gapShiftPreset, repeatPreviewText, repeatShiftDates, selectableRecords, shiftStatusOptions } from '../src/lib/shiftForm.js'

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

test('status options follow the driver choice and keep the edited status', () => {
  assert.equal(shiftStatusOptions({ hasDriver: false }), null)
  assert.deepEqual(Object.keys(shiftStatusOptions({ hasDriver: true })), ['draft', 'assigned', 'confirmed'])
  assert.deepEqual(Object.keys(shiftStatusOptions({ hasDriver: true, currentStatus: 'completed' })), ['draft', 'assigned', 'confirmed', 'completed'])
  assert.deepEqual(Object.keys(shiftStatusOptions({ hasDriver: true, currentStatus: 'open' })), ['draft', 'assigned', 'confirmed'])
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
