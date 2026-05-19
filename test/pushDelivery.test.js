import test from 'node:test'
import assert from 'node:assert/strict'
import { pushDeliveryWarning, sendPushForNotifications } from '../src/lib/pushDelivery.js'

const configuredEnv = {
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon',
  VITE_VAPID_PUBLIC_KEY: 'vapid',
}

test('sendPushForNotifications skips missing prerequisites before calling backend', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    throw new Error('should not call fetch')
  }

  assert.deepEqual(await sendPushForNotifications([], 'token', { env: configuredEnv, fetchImpl }), { skipped: true, reason: 'no-notifications' })
  assert.deepEqual(await sendPushForNotifications([{ title: 'Test' }], 'token', { env: {}, fetchImpl }), { skipped: true, reason: 'supabase-not-configured' })
  assert.deepEqual(await sendPushForNotifications([{ title: 'Test' }], '', { env: configuredEnv, fetchImpl }), { skipped: true, reason: 'missing-auth-token' })
  assert.equal(calls, 0)
})

test('sendPushForNotifications posts clean notifications to backend', async () => {
  const result = await sendPushForNotifications([{ title: 'Test' }, { body: 'missing title' }, { title: 'No push', push: false }], 'token', {
    env: configuredEnv,
    fetchImpl: async (url, options) => {
      assert.equal(url, '/api/send-push')
      assert.equal(options.method, 'POST')
      assert.equal(options.headers.Authorization, 'Bearer token')
      assert.deepEqual(JSON.parse(options.body).notifications, [{ title: 'Test' }])
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, sent: 1, failed: 0 }),
      }
    },
  })

  assert.deepEqual(result, { status: 200, ok: true, sent: 1, failed: 0 })
})

test('sendPushForNotifications skips notices marked as app-only', async () => {
  let calls = 0
  const result = await sendPushForNotifications([{ title: 'Pouze do aplikace', push: false }], 'token', {
    env: configuredEnv,
    fetchImpl: async () => {
      calls += 1
      throw new Error('should not call fetch')
    },
  })

  assert.deepEqual(result, { skipped: true, reason: 'no-notifications' })
  assert.equal(calls, 0)
})

test('pushDeliveryWarning keeps user-facing push failure text friendly', () => {
  assert.equal(pushDeliveryWarning({ skipped: true, reason: 'missing-auth-token' }), 'missing-auth-token')
  assert.equal(pushDeliveryWarning({ ok: false, error: 'notifications: new row violates row-level security policy' }), 'Akci se nepodařilo uložit kvůli oprávnění. Obnov aplikaci a zkus to znovu, případně kontaktuj dispečink.')
  assert.equal(pushDeliveryWarning({ ok: true, failed: 2 }), '2 zařízení nedostalo push')
  assert.equal(pushDeliveryWarning({ ok: true, failed: 0 }), '')
})
