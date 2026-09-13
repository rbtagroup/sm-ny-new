import test from 'node:test'
import assert from 'node:assert/strict'
import { applySwapRequestStatus, realtimeReloadKeys, shouldRefreshOnline, SYNC_SAFETY_POLL_MS } from '../src/lib/syncPolicy.js'

test('realtimeReloadKeys maps changed tables to app data keys', () => {
  assert.deepEqual(realtimeReloadKeys(['notifications']), ['notifications'])
  assert.deepEqual(realtimeReloadKeys(['shift_settlements', 'app_settings']), ['settlements', 'settings'])
  assert.deepEqual(realtimeReloadKeys(['swap_requests']).sort(), ['shifts', 'swapRequests'])
  assert.equal(realtimeReloadKeys([]), null, 'no table means a full reload')
  assert.equal(realtimeReloadKeys(['unknown_table']), null, 'unknown tables fall back to a full reload')
})

test('shouldRefreshOnline polls only without realtime and never on a hidden tab', () => {
  const now = 1_000_000_000
  assert.equal(shouldRefreshOnline({ reason: 'poll', hidden: true, now }), false)
  assert.equal(shouldRefreshOnline({ reason: 'poll', realtimeConnected: false, lastFullSyncAt: now - 1000, now }), true)
  assert.equal(shouldRefreshOnline({ reason: 'poll', realtimeConnected: true, lastFullSyncAt: now - 60_000, now }), false)
  assert.equal(shouldRefreshOnline({ reason: 'poll', realtimeConnected: true, lastFullSyncAt: now - SYNC_SAFETY_POLL_MS - 1, now }), true)
  assert.equal(shouldRefreshOnline({ reason: 'focus', realtimeConnected: true, lastFullSyncAt: now - 10_000, now }), false)
  assert.equal(shouldRefreshOnline({ reason: 'focus', realtimeConnected: true, lastFullSyncAt: now - 61_000, now }), true)
  assert.equal(shouldRefreshOnline({ reason: 'online', realtimeConnected: true, lastFullSyncAt: now, now }), true)
})

test('applySwapRequestStatus marks active swaps and clears stale pending markers', () => {
  const shifts = [
    { id: 'sh_active', swapRequestStatus: '' },
    { id: 'sh_stale', swapRequestStatus: 'pending' },
    { id: 'sh_done', swapRequestStatus: 'approved' },
  ]
  const once = applySwapRequestStatus(shifts, [{ shiftId: 'sh_active', status: 'accepted' }])
  assert.deepEqual(once.map((shift) => shift.swapRequestStatus), ['accepted', '', 'approved'])
  assert.deepEqual(applySwapRequestStatus(once, [{ shiftId: 'sh_active', status: 'accepted' }]), once)
})
