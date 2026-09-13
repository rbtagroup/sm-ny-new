import { ONLINE_TABLES, tableName } from './supabaseData.js'

export const SYNC_FALLBACK_POLL_MS = 30_000
export const SYNC_SAFETY_POLL_MS = 5 * 60_000
export const SYNC_FOCUS_REFRESH_MS = 60_000

const keyByTable = new Map(ONLINE_TABLES.map((key) => [tableName(key), key]))

// Realtime událost stačí dočíst jen pro změněné tabulky; null znamená úplné načtení.
export function realtimeReloadKeys(tables = []) {
  if (!tables.length) return null
  const keys = new Set()
  for (const table of tables) {
    if (table === 'app_settings') {
      keys.add('settings')
      continue
    }
    const key = keyByTable.get(table)
    if (!key) return null
    keys.add(key)
  }
  // Výměny mění viditelnost i stav směn, proto se směny dočítají s nimi.
  if (keys.has('swapRequests')) keys.add('shifts')
  return [...keys]
}

export function shouldRefreshOnline({ reason = 'poll', hidden = false, realtimeConnected = false, lastFullSyncAt = 0, now = Date.now() } = {}) {
  if (hidden) return false
  if (reason === 'online') return true
  const age = now - (Number(lastFullSyncAt) || 0)
  if (!realtimeConnected) return reason === 'poll' || age > SYNC_FALLBACK_POLL_MS
  return age > (reason === 'poll' ? SYNC_SAFETY_POLL_MS : SYNC_FOCUS_REFRESH_MS)
}

export function applySwapRequestStatus(shifts = [], swapRequests = []) {
  const activeSwapStatusByShift = new Map(
    (swapRequests || [])
      .filter((request) => ['pending', 'accepted'].includes(request.status))
      .map((request) => [request.shiftId, request.status]),
  )
  return (shifts || []).map((shift) => ({
    ...shift,
    swapRequestStatus: activeSwapStatusByShift.get(shift.id) || (['pending', 'accepted'].includes(shift.swapRequestStatus) ? '' : shift.swapRequestStatus),
  }))
}
