import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalDriverId, driverWithDuplicateEmail, mergeDriverDirectory, normalizeDriverEmail } from '../src/lib/drivers.js'

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
