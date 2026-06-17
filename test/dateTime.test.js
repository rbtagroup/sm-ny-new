import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays, startOfWeek, todayISO } from '../src/lib/dateTime.js'

test('todayISO uses the local calendar date around midnight', () => {
  assert.equal(todayISO(new Date(2026, 5, 18, 0, 13)), '2026-06-18')
})

test('date arithmetic returns local calendar dates', () => {
  assert.equal(addDays('2026-06-18', 1), '2026-06-19')
  assert.equal(startOfWeek('2026-06-18'), '2026-06-15')
})
