import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays, isPlausiblePlanDate, millisecondsUntilNextLocalDay, startOfWeek, todayISO } from '../src/lib/dateTime.js'

test('todayISO uses the local calendar date around midnight', () => {
  assert.equal(todayISO(new Date(2026, 5, 18, 0, 13)), '2026-06-18')
})

test('date arithmetic returns local calendar dates', () => {
  assert.equal(addDays('2026-06-18', 1), '2026-06-19')
  assert.equal(startOfWeek('2026-06-18'), '2026-06-15')
})

test('midnight refresh delay targets the next local day', () => {
  assert.equal(millisecondsUntilNextLocalDay(new Date(2026, 5, 18, 23, 59, 59, 900)), 250)
  assert.equal(millisecondsUntilNextLocalDay(new Date(2026, 5, 18, 12, 0, 0, 0)), 43_200_050)
})

test('plan dates reject implausible years typed into date inputs', () => {
  assert.equal(isPlausiblePlanDate('2026-09-21'), true)
  assert.equal(isPlausiblePlanDate('2020-01-01'), true)
  assert.equal(isPlausiblePlanDate('2100-12-31'), true)
  assert.equal(isPlausiblePlanDate('0005-05-04'), false)
  assert.equal(isPlausiblePlanDate('2101-01-01'), false)
  assert.equal(isPlausiblePlanDate(''), false)
  assert.equal(isPlausiblePlanDate('21.09.2026'), false)
})
