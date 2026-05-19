import { appFriendlyError } from './errors.js'

export async function sendPushForNotifications(notices, accessToken = '', { env = import.meta.env || {}, fetchImpl = fetch } = {}) {
  const clean = (Array.isArray(notices) ? notices : [notices]).filter((notice) => notice?.title && notice.push !== false && !notice.skipPush)
  if (!clean.length) return { skipped: true, reason: 'no-notifications' }
  if (!(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY)) return { skipped: true, reason: 'supabase-not-configured' }
  if (!env.VITE_VAPID_PUBLIC_KEY) return { skipped: true, reason: 'missing-vapid-public-key' }
  if (!accessToken) return { skipped: true, reason: 'missing-auth-token' }
  try {
    const res = await fetchImpl('/api/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ notifications: clean }),
    })
    const payload = await res.json().catch(async () => ({ ok: false, error: await res.text().catch(() => res.statusText) }))
    if (!res.ok) {
      console.warn('RBSHIFT push send failed:', payload?.error || res.statusText)
    }
    return { status: res.status, ...payload }
  } catch (err) {
    console.warn('RBSHIFT push send unavailable:', err)
    return { ok: false, error: err?.message || String(err) }
  }
}

export function pushDeliveryWarning(result) {
  if (!result || result.reason === 'no-notifications') return ''
  if (result.skipped) return result.reason || 'push přeskočen'
  if (result.ok === false) return appFriendlyError(result.error || result.reason || 'neznámá chyba')
  if (Number(result.failed || 0) > 0) return `${result.failed} zařízení nedostalo push`
  return ''
}
