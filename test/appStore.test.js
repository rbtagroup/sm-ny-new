import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTOBACKUP_KEY, clearStore, LEGACY_STORAGE_KEYS, readStore, seed, STORAGE_KEY, writeStore } from '../src/lib/appStore.js'

function installLocalStorage() {
  const store = new Map()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  })
  return () => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete globalThis.localStorage
  }
}

test('seed creates a complete local demo data shape', () => {
  const data = seed()

  assert.ok(data.drivers.length >= 4)
  assert.ok(data.vehicles.length >= 3)
  assert.ok(data.shifts.length >= 4)
  assert.deepEqual(data.notifications, [])
  assert.deepEqual(data.pushDeliveryLogs, [])
  assert.equal(data.settings.companyName, 'RBSHIFT')
})

test('writeStore omits push subscription secrets and readStore hydrates defaults', () => {
  const restore = installLocalStorage()
  try {
    const data = seed()
    writeStore({
      ...data,
      pushSubscriptions: [{ id: 'push_1', endpoint: 'https://example.test/push', subscription: { keys: { auth: 'secret' } } }],
      shifts: [{ id: 'sh_custom', date: '2026-05-18', start: '07:00', end: '19:00' }],
    })

    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY))
    assert.deepEqual(raw.pushSubscriptions, [])

    const restored = readStore()
    assert.equal(restored.shifts[0].id, 'sh_custom')
    assert.equal(restored.shifts[0].declineReason, '')
    assert.equal(restored.shifts[0].swapRequestStatus, '')
    assert.deepEqual(restored.pushSubscriptions, [])
    assert.deepEqual(restored.pushDeliveryLogs, [])
  } finally {
    restore()
  }
})

test('clearStore removes the local data snapshot, backup and legacy keys', () => {
  const restore = installLocalStorage()
  try {
    writeStore(seed())
    localStorage.setItem(LEGACY_STORAGE_KEYS[0], '{}')
    localStorage.setItem('unrelated-key', 'keep')

    clearStore()

    assert.equal(localStorage.getItem(STORAGE_KEY), null)
    assert.equal(localStorage.getItem(AUTOBACKUP_KEY), null)
    assert.equal(localStorage.getItem(LEGACY_STORAGE_KEYS[0]), null)
    assert.equal(localStorage.getItem('unrelated-key'), 'keep')
  } finally {
    restore()
  }
})
