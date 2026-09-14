import test from 'node:test'
import assert from 'node:assert/strict'
import { attendanceRows } from '../src/lib/opsMetrics.js'

test('attendance compares worked time only with shifts that should already be over', () => {
  const data = {
    drivers: [{ id: 'drv_1', name: 'Roman', active: true }],
    shifts: [
      { id: 'done', driverId: 'drv_1', date: '2026-09-14', start: '07:00', end: '19:00', status: 'completed', actualStartAt: '2026-09-14T07:00', actualEndAt: '2026-09-14T19:00' },
      { id: 'running', driverId: 'drv_1', date: '2026-09-15', start: '07:00', end: '19:00', status: 'confirmed', actualStartAt: '2026-09-15T07:10' },
      { id: 'future', driverId: 'drv_1', date: '2026-09-17', start: '07:00', end: '19:00', status: 'confirmed' },
      { id: 'declined', driverId: 'drv_1', date: '2026-09-14', start: '19:00', end: '07:00', status: 'declined' },
    ],
  }
  const [row] = attendanceRows(data, {}, '2026-09-14', '2026-09-20', new Date('2026-09-15T12:00:00').getTime())
  assert.equal(row.shifts.length, 3)
  assert.equal(row.plannedMinutes, 12 * 60)
  assert.equal(row.actualMinutes, 12 * 60)
  assert.equal(row.open, 1)
})
