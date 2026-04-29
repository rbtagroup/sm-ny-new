import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

const json = (res, status, payload) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

const readBody = async (req) => {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}')
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

const normalizeNotice = (n = {}) => ({
  id: n.id || '',
  title: n.title || 'RBSHIFT',
  body: n.body || 'Nové upozornění v aplikaci RBSHIFT.',
  type: n.type || 'info',
  shiftId: n.shiftId || n.shift_id || '',
  targetDriverId: n.targetDriverId || n.target_driver_id || '',
  targetRole: String(n.targetRole || n.target_role || 'admin').toLowerCase(),
})

const matchesNotice = (subscription, notice) => {
  const role = String(subscription.role || '').toLowerCase()
  if (notice.targetDriverId) return subscription.driver_id === notice.targetDriverId
  if (notice.targetRole === 'all') return true
  if (notice.targetRole === 'driver_all') return role === 'driver'
  if (notice.targetRole === 'admin') return role === 'admin' || role === 'dispatcher'
  if (notice.targetRole === 'dispatcher') return role === 'dispatcher' || role === 'admin'
  if (notice.targetRole === 'driver') return role === 'driver'
  return role === 'admin' || role === 'dispatcher'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed' })

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
  const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:prace@rbgroup.cz'

  if (!supabaseUrl || !serviceRoleKey) return json(res, 500, { ok: false, error: 'Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' })
  if (!vapidPublicKey || !vapidPrivateKey) return json(res, 500, { ok: false, error: 'Missing VAPID_PUBLIC_KEY/VITE_VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY' })

  let input
  try { input = await readBody(req) } catch { return json(res, 400, { ok: false, error: 'Invalid JSON body' }) }
  const notifications = (Array.isArray(input.notifications) ? input.notifications : [input.notification || input]).map(normalizeNotice).filter((n) => n.title)
  if (!notifications.length) return json(res, 400, { ok: false, error: 'No notifications supplied' })

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select('id, profile_id, driver_id, role, endpoint, subscription, active')
    .eq('active', true)

  if (error) return json(res, 500, { ok: false, error: error.message })

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

  const results = []
  const deliveries = []
  for (const notice of notifications) {
    const recipients = (subscriptions || []).filter((sub) => matchesNotice(sub, notice))
    deliveries.push({
      noticeId: notice.id,
      type: notice.type,
      targetRole: notice.targetRole,
      targetDriverId: notice.targetDriverId,
      recipients: recipients.length,
    })
    for (const sub of recipients) {
      try {
        await webpush.sendNotification(sub.subscription, JSON.stringify({
          title: notice.title,
          body: notice.body,
          tag: notice.shiftId ? `rbshift-${notice.shiftId}-${notice.type}` : `rbshift-${notice.id || Date.now()}`,
          url: '/',
          shiftId: notice.shiftId,
          type: notice.type,
          requireInteraction: ['new-shift', 'shift-change', 'swap-offer', 'swap-accepted', 'open-shift-interest'].includes(notice.type),
        }))
        results.push({ id: sub.id, ok: true })
      } catch (err) {
        const statusCode = err?.statusCode || err?.status
        results.push({ id: sub.id, ok: false, statusCode, error: err?.message || String(err) })
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from('push_subscriptions').update({ active: false, last_seen_at: new Date().toISOString() }).eq('id', sub.id)
        }
      }
    }
  }

  const sent = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  return json(res, 200, { ok: true, notifications: notifications.length, sent, failed, deliveries, results })
}
