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

test('dashboard tasks put the soonest first, group conflicts per shift and offer reminders for unconfirmed shifts', async () => {
  const { CONFIRM_REMINDER_TYPE } = await import('../src/lib/dashboard.js')
  const now = new Date('2026-09-15T08:00:00').getTime()
  const data = {
    shifts: [
      { id: 'soon', date: '2026-09-15', start: '19:00', end: '07:00', driverId: 'd1', status: 'assigned' },
      { id: 'reminded', date: '2026-09-16', start: '07:00', end: '19:00', driverId: 'd2', status: 'draft' },
      { id: 'later', date: '2026-09-20', start: '07:00', end: '19:00', driverId: 'd1', status: 'assigned' },
      { id: 'clash', date: '2026-09-15', start: '06:00', end: '14:00', driverId: 'd2', status: 'confirmed' },
      { id: 'offer', date: '2026-09-17', start: '07:00', end: '19:00', driverId: 'd1', status: 'confirmed' },
    ],
    swapRequests: [
      { id: 'sw-open', shiftId: 'offer', driverId: 'd1', targetMode: 'all', status: 'pending', acceptedByDriverId: '', targetDriverId: '' },
    ],
    notifications: [{ id: 'n1', type: CONFIRM_REMINDER_TYPE, shiftId: 'reminded', at: '2026-09-15T07:00:00' }],
    settings: { coverageSlots: [] },
  }
  const helpers = {
    driverName: (id) => ({ d1: 'Roman', d2: 'Petra' })[id],
    conflictMessages: (shift) => shift.id === 'clash' ? ['Není vybrané vozidlo.', 'Řidič Petra má nepřítomnost.'] : [],
  }
  const { tasks, count, awaitingSoon } = dashboardOperationalIssues(data, helpers, '2026-09-15', now)
  assert.deepEqual(tasks.map((task) => task.key), ['conflict-clash', 'confirm-soon', 'confirm-reminded', 'swap-sw-open'])
  assert.equal(count, 4)
  assert.deepEqual(awaitingSoon.map((shift) => shift.id), ['soon', 'reminded'])
  assert.equal(tasks[0].detail, 'Není vybrané vozidlo. Řidič Petra má nepřítomnost.')
  assert.equal(tasks.find((task) => task.key === 'confirm-reminded').remindedRecently, true)
  assert.equal(tasks.find((task) => task.key === 'confirm-soon').remindedRecently, false)
  assert.equal(tasks.find((task) => task.kind === 'swap').approvable, false)
})
