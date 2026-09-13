import test from 'node:test'
import assert from 'node:assert/strict'
import { activatedDriverPatch, canonicalDriverId, driverRemovalSummary, driverRemovalSummaryText, driverWithDuplicateEmail, isPendingDriver, mergeDriverDirectory, normalizeDriverEmail, PENDING_DRIVER_NOTE, withoutDriver } from '../src/lib/drivers.js'

test('driver email helpers prevent duplicate identities', () => {
  const drivers = [
    { id: 'linked', email: 'petr@example.test', profileId: 'profile_1' },
    { id: 'legacy', email: ' PETR@example.test ', profileId: '' },
  ]

  assert.equal(normalizeDriverEmail(' PETR@example.test '), 'petr@example.test')
  assert.equal(driverWithDuplicateEmail(drivers, 'petr@example.test', 'legacy')?.id, 'linked')
  assert.equal(canonicalDriverId(drivers, 'legacy'), 'linked')
  assert.equal(canonicalDriverId(drivers, 'linked'), 'linked')
})

test('canonicalDriverId keeps an unlinked driver when no unique linked match exists', () => {
  const drivers = [
    { id: 'legacy', email: 'driver@example.test', profileId: '' },
    { id: 'linked-a', email: 'driver@example.test', profileId: 'profile_1' },
    { id: 'linked-b', email: 'driver@example.test', profileId: 'profile_2' },
  ]

  assert.equal(canonicalDriverId(drivers, 'legacy'), 'legacy')
  assert.equal(canonicalDriverId(drivers, 'missing'), 'missing')
})

test('mergeDriverDirectory keeps full own row and only names for colleagues', () => {
  const own = [{ id: 'drv_me', profileId: 'profile_me', name: 'Já', phone: '+420 1', email: 'me@example.test', active: true, note: 'moje' }]
  const directory = [
    { id: 'drv_colleague', name: 'Kolega', active: true },
    { id: 'drv_me', name: 'Já', active: true },
    { id: 'drv_former', name: 'Bývalý', active: false },
  ]

  const merged = mergeDriverDirectory(own, directory)

  assert.deepEqual(merged.map((driver) => driver.id), ['drv_colleague', 'drv_me', 'drv_former'])
  assert.deepEqual(merged[0], { id: 'drv_colleague', profileId: '', name: 'Kolega', phone: '', email: '', active: true, note: '' })
  assert.equal(merged[1].phone, '+420 1')
  assert.equal(merged[2].active, false)
  assert.deepEqual(mergeDriverDirectory(own, []), own)
})

test('pending self-registered drivers are recognised and approval clears the pending note', () => {
  const pending = { id: 'drv_new', active: false, note: PENDING_DRIVER_NOTE }
  assert.equal(isPendingDriver(pending), true)
  assert.equal(isPendingDriver({ ...pending, active: true }), false)
  assert.equal(isPendingDriver({ id: 'drv_off', active: false, note: 'Odešel' }), false)

  assert.deepEqual(activatedDriverPatch(pending, { active: true }), { id: 'drv_new', active: true, note: '' })
  assert.equal(activatedDriverPatch(pending, { active: false, note: PENDING_DRIVER_NOTE }).note, PENDING_DRIVER_NOTE)
  assert.equal(activatedDriverPatch({ id: 'drv_1', active: true, note: 'Víkendy' }, { phone: '1' }).note, 'Víkendy')
})

const removalFixture = () => ({
  drivers: [{ id: 'drv_gone', name: 'Odchází', profileId: 'uid_gone' }, { id: 'drv_stay', name: 'Zůstává' }],
  shifts: [
    { id: 'sh_past', driverId: 'drv_gone', date: '2026-09-01' },
    { id: 'sh_future', driverId: 'drv_gone', date: '2026-09-20' },
    { id: 'sh_colleague', driverId: 'drv_stay', date: '2026-09-21' },
  ],
  settlements: [
    { id: 'set_past', shiftId: 'sh_past', driverId: 'drv_gone' },
    { id: 'set_reassigned', shiftId: 'sh_colleague', driverId: 'drv_gone' },
    { id: 'set_colleague', shiftId: 'sh_colleague', driverId: 'drv_stay' },
  ],
  swapRequests: [
    { id: 'swap_own', shiftId: 'sh_future', driverId: 'drv_gone', status: 'pending' },
    { id: 'swap_offered_to_gone', shiftId: 'sh_colleague', driverId: 'drv_stay', targetDriverId: 'drv_gone', status: 'pending' },
    { id: 'swap_history', shiftId: 'sh_colleague', driverId: 'drv_stay', acceptedByDriverId: 'drv_gone', status: 'approved' },
  ],
  notifications: [
    { id: 'ntf_driver', targetDriverId: 'drv_gone' },
    { id: 'ntf_staff_about_shift', shiftId: 'sh_past', targetRole: 'admin' },
    { id: 'ntf_colleague', targetDriverId: 'drv_stay' },
  ],
  availability: [{ id: 'av_gone', driverId: 'drv_gone' }, { id: 'av_stay', driverId: 'drv_stay' }],
  absences: [{ id: 'abs_gone', driverId: 'drv_gone' }],
  pushSubscriptions: [{ id: 'push_gone', driverId: 'drv_gone' }, { id: 'push_stay', driverId: 'drv_stay' }],
})

test('driver removal summary counts the history the database function deletes', () => {
  const summary = driverRemovalSummary(removalFixture(), 'drv_gone', '2026-09-13')

  assert.deepEqual(summary, { shifts: 2, upcomingShifts: 1, settlements: 2, swapRequests: 1, notifications: 2, availability: 2 })
  assert.equal(
    driverRemovalSummaryText(summary, { hasLogin: true }),
    'Smaže se: 2 směny (z toho 1 budoucí), 2 výčetky, 1 výměna, 2 notifikace, dostupnost a absence, přihlašovací účet.',
  )
  assert.equal(driverRemovalSummaryText({ shifts: 5, settlements: 0, swapRequests: 7, notifications: 12 }), 'Smaže se: 5 směn, 0 výčetek, 7 výměn, 12 notifikací.')
})

test('withoutDriver removes the driver with history and cancels colleague swaps waiting on them', () => {
  const next = withoutDriver(removalFixture(), 'drv_gone', '2026-09-13T10:00:00.000Z')

  assert.deepEqual(next.drivers.map((driver) => driver.id), ['drv_stay'])
  assert.deepEqual(next.shifts.map((shift) => shift.id), ['sh_colleague'])
  assert.deepEqual(next.settlements.map((settlement) => settlement.id), ['set_colleague'])
  assert.deepEqual(next.notifications.map((notice) => notice.id), ['ntf_colleague'])
  assert.deepEqual(next.availability.map((row) => row.id), ['av_stay'])
  assert.deepEqual(next.absences, [])
  assert.deepEqual(next.pushSubscriptions.map((device) => device.id), ['push_stay'])
  assert.deepEqual(next.swapRequests.map((request) => [request.id, request.status]), [['swap_offered_to_gone', 'cancelled'], ['swap_history', 'approved']])
  assert.equal(next.swapRequests[0].cancelledAt, '2026-09-13T10:00:00.000Z')
})
