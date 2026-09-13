import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalDriverId, driverWithDuplicateEmail, normalizeDriverEmail } from '../src/lib/drivers.js'

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
