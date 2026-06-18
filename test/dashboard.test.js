import test from 'node:test'
import assert from 'node:assert/strict'
import { dashboardOperationalIssues } from '../src/lib/dashboard.js'

test('dashboard priorities include every visible issue and exclude historical gaps', () => {
  const data = {
    shifts: [
      { id: 'past-conflict', date: '2026-06-17', start: '01:00', end: '02:00', status: 'confirmed' },
      { id: 'today-conflict', date: '2026-06-18', start: '01:00', end: '02:00', status: 'confirmed' },
      { id: 'future-declined', date: '2026-06-19', start: '03:00', end: '04:00', status: 'declined' },
      { id: 'past-swap-shift', date: '2026-06-17', start: '04:00', end: '05:00', status: 'confirmed' },
      { id: 'future-swap-shift', date: '2026-06-20', start: '04:00', end: '05:00', status: 'confirmed' },
    ],
    swapRequests: [
      { id: 'past-swap', shiftId: 'past-swap-shift', status: 'pending' },
      { id: 'future-swap', shiftId: 'future-swap-shift', status: 'accepted' },
    ],
    settings: {
      coverageSlots: [{ id: 'day', name: 'Denní', start: '07:00', end: '19:00', minDrivers: 1 }],
    },
  }
  const helpers = {
    conflictMessages: (shift) => shift.id.endsWith('conflict') ? ['Kolize'] : [],
  }

  const issues = dashboardOperationalIssues(data, helpers, '2026-06-18')

  assert.deepEqual(issues.conflicts.map((item) => item.shift.id), ['today-conflict'])
  assert.deepEqual(issues.declined.map((shift) => shift.id), ['future-declined'])
  assert.deepEqual(issues.pendingSwaps.map((request) => request.id), ['future-swap'])
  assert.deepEqual(issues.gaps.map((gap) => gap.day), ['2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21'])
  assert.equal(issues.count, 7)
})
