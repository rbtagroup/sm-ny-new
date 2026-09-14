import test from 'node:test'
import assert from 'node:assert/strict'
import { absenceFromForm, availabilityEntryFromForm, availabilityOnDay, availabilityWeekGrid } from '../src/lib/availabilityGrid.js'

test('an entry shows on the days it touches with a label for that day', () => {
  const night = { fromAt: '2026-09-18T22:00', toAt: '2026-09-19T06:00' }
  assert.equal(availabilityOnDay(night, '2026-09-18').label, 'od 22:00')
  assert.equal(availabilityOnDay(night, '2026-09-19').label, 'do 06:00')
  assert.equal(availabilityOnDay(night, '2026-09-20'), null)
  assert.equal(availabilityOnDay({ fromAt: '2026-09-18T07:00', toAt: '2026-09-18T19:00' }, '2026-09-18').label, '07:00–19:00')
  assert.equal(availabilityOnDay({ fromAt: '2026-09-17T20:00', toAt: '2026-09-19T00:00' }, '2026-09-18').label, 'celý den')
  assert.equal(availabilityOnDay({ fromAt: '2026-09-17T20:00', toAt: '2026-09-19T00:00' }, '2026-09-19'), null)
  // 2026-09-18 is a Friday
  const weekly = { weekday: 5, date: '', start: '18:00', end: '06:00' }
  assert.deepEqual(availabilityOnDay(weekly, '2026-09-18'), { label: '18:00–06:00', start: '18:00', end: '06:00', weekly: true })
  assert.equal(availabilityOnDay(weekly, '2026-09-19'), null)
  // an empty weekday is not Sunday
  assert.equal(availabilityOnDay({ weekday: '', date: '', start: '07:00', end: '19:00' }, '2026-09-20'), null)
  assert.equal(availabilityOnDay({ weekday: '', date: '2026-09-20', start: '00:00', end: '23:59' }, '2026-09-20').label, 'celý den')
})

test('the week grid lists active drivers with absences first, then availability by time', () => {
  const data = {
    drivers: [{ id: 'd2', name: 'Petra', active: true }, { id: 'd1', name: 'Milan', active: true }, { id: 'd3', name: 'Starý', active: false }],
    absences: [{ id: 'a1', driverId: 'd2', from: '2026-09-15', to: '2026-09-16', reason: 'Dovolená' }],
    availability: [
      { id: 'v2', driverId: 'd2', fromAt: '2026-09-15T14:00', toAt: '2026-09-15T22:00', note: '[unavailable] škola' },
      { id: 'v1', driverId: 'd2', fromAt: '2026-09-15T06:00', toAt: '2026-09-15T12:00', note: '[preferred]' },
      { id: 'v3', driverId: 'd1', weekday: 5, date: '', start: '18:00', end: '06:00', note: '' },
    ],
  }
  const grid = availabilityWeekGrid(data, '2026-09-14')
  assert.equal(grid.days.length, 7)
  assert.deepEqual(grid.rows.map((row) => row.driver.name), ['Milan', 'Petra'])
  const tuesday = grid.rows[1].cells[1]
  assert.deepEqual(tuesday.items.map((item) => [item.type, item.kind, item.label]), [['absence', 'absent', 'Dovolená'], ['availability', 'preferred', '06:00–12:00'], ['availability', 'unavailable', '14:00–22:00']])
  assert.equal(tuesday.items[2].note, 'škola')
  assert.deepEqual(grid.rows[0].cells.map((cell) => cell.items.length), [0, 0, 0, 0, 1, 0, 0])
})

test('new entries from the grid form: one day, a night into the next day, weekly repeat and absences', () => {
  const base = { driverId: 'd1', type: 'unavailable', date: '2026-09-18', start: '22:00', end: '06:00', note: ' zkouška ' }
  assert.deepEqual(availabilityEntryFromForm(base, 'av1').entry, { id: 'av1', driverId: 'd1', weekday: '', date: '', fromAt: '2026-09-18T22:00', toAt: '2026-09-19T06:00', start: '22:00', end: '06:00', note: '[unavailable] zkouška' })
  assert.deepEqual(availabilityEntryFromForm({ ...base, type: 'available', note: '', repeatWeekly: true }, 'av2').entry, { id: 'av2', driverId: 'd1', weekday: 5, date: '', fromAt: '', toAt: '', start: '22:00', end: '06:00', note: '[available]' })
  assert.equal(availabilityEntryFromForm({ ...base, start: '07:00', end: '07:00' }, 'x').error, 'Čas od a do se musí lišit.')
  assert.equal(availabilityEntryFromForm({ ...base, driverId: '' }, 'x').error, 'Vyberte řidiče.')
  assert.deepEqual(absenceFromForm({ driverId: 'd1', from: '2026-09-18', to: '2026-09-20', reason: ' Nemoc ' }, 'abs1').entry, { id: 'abs1', driverId: 'd1', from: '2026-09-18', to: '2026-09-20', reason: 'Nemoc' })
  assert.match(absenceFromForm({ driverId: 'd1', from: '2026-09-20', to: '2026-09-18' }, 'x').error, /pozdější/)
})
