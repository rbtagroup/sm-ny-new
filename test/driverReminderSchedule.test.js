import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWeeklyCron,
  cronTimeValue,
  humanDriverReminderCron,
  isValidSimpleWeeklyCron,
  parseDriverReminderCron,
} from '../src/lib/driverReminderSchedule.js'

test('parseDriverReminderCron reads minute, hour, and weekday', () => {
  assert.deepEqual(parseDriverReminderCron('15 7 * * 2'), { minute: '15', hour: '7', weekday: '2' })
  assert.deepEqual(parseDriverReminderCron('bad value'), { minute: '0', hour: '18', weekday: '3' })
})

test('buildWeeklyCron creates simple weekly cron expressions', () => {
  assert.equal(buildWeeklyCron('4', '09:30'), '30 9 * * 4')
  assert.equal(cronTimeValue('5 6 * * 1'), '06:05')
})

test('isValidSimpleWeeklyCron rejects unsupported schedules', () => {
  assert.equal(isValidSimpleWeeklyCron('0 18 * * 3'), true)
  assert.equal(isValidSimpleWeeklyCron('60 18 * * 3'), false)
  assert.equal(isValidSimpleWeeklyCron('0 24 * * 3'), false)
  assert.equal(isValidSimpleWeeklyCron('0 18 * * 9'), false)
  assert.equal(isValidSimpleWeeklyCron('0 18 1 * 3'), false)
})

test('humanDriverReminderCron formats Czech user-facing label', () => {
  assert.equal(humanDriverReminderCron('0 18 * * 3'), 'Každou středu v 18:00')
  assert.equal(humanDriverReminderCron('bad value'), 'Neplatný cron formát')
})
