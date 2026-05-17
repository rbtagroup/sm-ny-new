import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

const json = (res, status, payload) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

const PUSH_MAX_BODY_BYTES = Number(process.env.PUSH_MAX_BODY_BYTES || 128 * 1024)
const pushServerError = (res, err, context = 'push') => {
  console.error(`[send-push] ${context}:`, err)
  return json(res, 500, { ok: false, error: 'Push notifikace se teď nepodařilo odeslat. Zkus to prosím znovu.' })
}
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode })

const readBody = async (req) => {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > PUSH_MAX_BODY_BYTES) throw httpError(413, 'Request body too large')
    return JSON.parse(req.body || '{}')
  }
  const chunks = []
  let received = 0
  for await (const chunk of req) {
    received += chunk.length
    if (received > PUSH_MAX_BODY_BYTES) throw httpError(413, 'Request body too large')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

const normalizeNotice = (n = {}) => {
  const targetDriverId = n.targetDriverId || n.target_driver_id || ''
  return {
    id: n.id || '',
    title: n.title || 'RBSHIFT',
    body: n.body || 'Nové upozornění v aplikaci RBSHIFT.',
    type: n.type || 'info',
    shiftId: n.shiftId || n.shift_id || '',
    targetDriverId,
    targetRole: String(targetDriverId ? 'driver' : (n.targetRole || n.target_role || 'admin')).toLowerCase(),
  }
}

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

const bearerTokenFrom = (req) => {
  const value = req.headers.authorization || req.headers.Authorization || ''
  const match = String(value).match(/^Bearer\s+(.+)$/i)
  return match?.[1] || ''
}

const internalSecretFrom = (req) => String(req.headers['x-rbshift-push-secret'] || req.headers['X-Rbshift-Push-Secret'] || '')

const profileForToken = async (supabase, token) => {
  if (!token) return null
  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData?.user?.id) return null
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (profileError) throw profileError
  if (!profile) return null
  if (String(profile.role || '').toLowerCase() !== 'driver') return { ...profile, driverId: '' }

  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('id')
    .eq('profile_id', profile.id)
    .maybeSingle()
  if (driverError) throw driverError

  return { ...profile, driverId: driver?.id || '' }
}

const SWAP_DRIVER_NOTICE_TYPES = new Set(['swap-offer', 'swap-accepted', 'swap-rejected'])
const PUSH_CONCURRENCY = Number(process.env.PUSH_DELIVERY_CONCURRENCY || 8)
const PUSH_RATE_LIMIT_WINDOW_MS = Number(process.env.PUSH_RATE_LIMIT_WINDOW_MS || 60_000)
const PUSH_REQUEST_RATE_LIMIT_MAX = Number(process.env.PUSH_RATE_LIMIT_PER_WINDOW || process.env.PUSH_RATE_LIMIT_PER_MINUTE || 30)
const PUSH_DELIVERY_RATE_LIMIT_MAX = Number(process.env.PUSH_DELIVERY_RATE_LIMIT_PER_WINDOW || process.env.PUSH_RECIPIENT_RATE_LIMIT_PER_WINDOW || 1000)
const PUSH_MAX_NOTIFICATIONS_PER_REQUEST = Number(process.env.PUSH_MAX_NOTIFICATIONS_PER_REQUEST || 20)
const PUSH_MAX_RECIPIENTS_PER_NOTICE = Number(process.env.PUSH_MAX_RECIPIENTS_PER_NOTICE || 500)
const pushRateBuckets = (globalThis.__RBSHIFT_PUSH_RATE_BUCKETS__ ||= new Map())
const pushRateLimitWindowSeconds = (windowMs = PUSH_RATE_LIMIT_WINDOW_MS) => Math.max(1, Math.ceil((Number(windowMs) || PUSH_RATE_LIMIT_WINDOW_MS) / 1000))
const cleanRateLimitKeyPart = (value) => String(value || 'unknown').toLowerCase().replace(/[^a-z0-9:_-]+/g, '_').slice(0, 96)

const rateLimitKeyForProfile = (scope, profile, fallback = 'unknown') => {
  const role = cleanRateLimitKeyPart(profile?.role || 'unknown')
  const id = cleanRateLimitKeyPart(profile?.id || fallback || 'unknown')
  return `push:${cleanRateLimitKeyPart(scope)}:${role}:${id}`
}

const runWithConcurrency = async (items, limit, worker) => {
  const output = []
  let index = 0
  const workerCount = Math.max(1, Math.min(Number(limit) || 1, items.length || 1))
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const currentIndex = index
      index += 1
      output[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  }))
  return output
}

const checkRateLimit = (key, weight = 1, maxCount = PUSH_REQUEST_RATE_LIMIT_MAX, windowMs = PUSH_RATE_LIMIT_WINDOW_MS) => {
  if (!maxCount || maxCount < 1) return { ok: true }
  const now = Date.now()
  const safeWindowMs = Math.max(1000, Number(windowMs) || PUSH_RATE_LIMIT_WINDOW_MS)
  const bucket = pushRateBuckets.get(key) || { count: 0, resetAt: now + safeWindowMs }
  if (bucket.resetAt <= now) {
    bucket.count = 0
    bucket.resetAt = now + safeWindowMs
  }
  bucket.count += Math.max(1, Number(weight) || 1)
  pushRateBuckets.set(key, bucket)

  for (const [bucketKey, value] of pushRateBuckets) {
    if (value.resetAt <= now) pushRateBuckets.delete(bucketKey)
  }

  return {
    ok: bucket.count <= maxCount,
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  }
}

const checkDurableRateLimit = async (supabase, key, weight = 1, maxCount = PUSH_REQUEST_RATE_LIMIT_MAX, windowMs = PUSH_RATE_LIMIT_WINDOW_MS) => {
  if (!maxCount || maxCount < 1) return { ok: true }
  const { data, error } = await supabase.rpc('rb_check_push_rate_limit', {
    bucket_key: key,
    weight: Math.max(1, Number(weight) || 1),
    max_count: maxCount,
    window_seconds: pushRateLimitWindowSeconds(windowMs),
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return {
    ok: row?.ok !== false,
    retryAfter: Number(row?.retry_after || 1),
  }
}

const checkPushRateLimit = async (supabase, key, weight = 1, maxCount = PUSH_REQUEST_RATE_LIMIT_MAX, windowMs = PUSH_RATE_LIMIT_WINDOW_MS) => {
  try {
    return await checkDurableRateLimit(supabase, key, weight, maxCount, windowMs)
  } catch (err) {
    console.warn('[send-push] durable rate limit unavailable, using in-memory fallback:', err?.message || err)
    return checkRateLimit(key, weight, maxCount, windowMs)
  }
}

const pushSubscriptionFilterPlan = (notice) => {
  if (notice.targetDriverId) return { driverId: notice.targetDriverId, roles: null }
  if (notice.targetRole === 'driver_all' || notice.targetRole === 'driver') return { driverId: '', roles: ['driver'] }
  if (notice.targetRole === 'admin' || !notice.targetRole) return { driverId: '', roles: ['admin', 'dispatcher'] }
  if (notice.targetRole === 'dispatcher') return { driverId: '', roles: ['dispatcher', 'admin'] }
  return { driverId: '', roles: null }
}

const subscriptionsForNotice = async (supabase, notice) => {
  let query = supabase
    .from('push_subscriptions')
    .select('id, profile_id, driver_id, role, endpoint, subscription, active, delivery_failures')
    .eq('active', true)
  const filterPlan = pushSubscriptionFilterPlan(notice)

  if (filterPlan.driverId) query = query.eq('driver_id', filterPlan.driverId)
  if (filterPlan.roles?.length === 1) query = query.eq('role', filterPlan.roles[0])
  if (filterPlan.roles?.length > 1) query = query.in('role', filterPlan.roles)

  const { data, error } = await query
  if (error) throw error
  return (data || []).filter((sub) => matchesNotice(sub, notice))
}

const canSendSwapNotice = async (supabase, notice, callerDriverId) => {
  if (!callerDriverId || !notice.targetDriverId || !notice.shiftId || !SWAP_DRIVER_NOTICE_TYPES.has(notice.type)) return false
  if (notice.targetDriverId === callerDriverId) return true

  const { data: targetDriver, error: targetError } = await supabase
    .from('drivers')
    .select('id, active')
    .eq('id', notice.targetDriverId)
    .maybeSingle()
  if (targetError) throw targetError
  if (!targetDriver || targetDriver.active === false) return false

  const { data: requests, error: requestError } = await supabase
    .from('swap_requests')
    .select('driver_id, target_mode, target_driver_id, accepted_by_driver_id, status')
    .eq('shift_id', notice.shiftId)
    .in('status', ['pending', 'accepted', 'rejected'])
    .order('created_at', { ascending: false })
    .limit(20)
  if (requestError) throw requestError

  if (notice.type === 'swap-offer') {
    const { data: shift, error: shiftError } = await supabase
      .from('shifts')
      .select('driver_id')
      .eq('id', notice.shiftId)
      .maybeSingle()
    if (shiftError) throw shiftError

    return Boolean(
      shift?.driver_id === callerDriverId &&
      (requests || []).some((request) =>
        request.driver_id === callerDriverId &&
        request.status === 'pending' &&
        (request.target_mode === 'all' || request.target_driver_id === notice.targetDriverId),
      ),
    )
  }

  if (notice.type === 'swap-accepted') {
    return (requests || []).some((request) =>
      request.status === 'accepted' &&
      request.accepted_by_driver_id === callerDriverId &&
      request.driver_id === notice.targetDriverId,
    )
  }

  if (notice.type === 'swap-rejected') {
    return (requests || []).some((request) =>
      request.status === 'rejected' &&
      request.target_mode === 'driver' &&
      request.target_driver_id === callerDriverId &&
      request.driver_id === notice.targetDriverId,
    )
  }

  return false
}

const canSendNotice = async (supabase, notice, profile, internalAuthorized) => {
  if (internalAuthorized) return true
  const role = String(profile?.role || '').toLowerCase()
  if (role === 'admin' || role === 'dispatcher') return true
  if (role !== 'driver') return false

  // Řidič může posílat běžné notifikace jen dispečinku/adminům.
  if (!notice.targetDriverId && (notice.targetRole === 'admin' || notice.targetRole === 'dispatcher')) return true
  if (notice.targetDriverId === profile?.driverId) return true
  if (notice.targetDriverId) return canSendSwapNotice(supabase, notice, profile?.driverId || '')
  return false
}

export {
  checkDurableRateLimit,
  checkPushRateLimit,
  checkRateLimit,
  matchesNotice,
  normalizeNotice,
  pushSubscriptionFilterPlan,
  rateLimitKeyForProfile,
  subscriptionsForNotice,
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
  try { input = await readBody(req) } catch (err) {
    const statusCode = err?.statusCode === 413 ? 413 : 400
    return json(res, statusCode, { ok: false, error: statusCode === 413 ? 'Request body too large' : 'Invalid JSON body' })
  }
  const notifications = (Array.isArray(input.notifications) ? input.notifications : [input.notification || input]).map(normalizeNotice).filter((n) => n.title)
  if (!notifications.length) return json(res, 400, { ok: false, error: 'No notifications supplied' })
  if (notifications.length > PUSH_MAX_NOTIFICATIONS_PER_REQUEST) return json(res, 413, { ok: false, error: `Too many notifications supplied. Limit is ${PUSH_MAX_NOTIFICATIONS_PER_REQUEST}.` })

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const expectedInternalSecret = process.env.PUSH_DELIVERY_SECRET || process.env.SCHEDULER_SECRET || process.env.DRIVER_REMINDER_SECRET
  const receivedInternalSecret = internalSecretFrom(req)
  const internalAuthorized = Boolean(expectedInternalSecret && receivedInternalSecret && receivedInternalSecret === expectedInternalSecret)
  const bearerToken = bearerTokenFrom(req)
  let callerProfile = null
  if (!internalAuthorized) {
    try { callerProfile = await profileForToken(supabase, bearerToken) } catch (err) {
      return pushServerError(res, err, 'profile lookup')
    }
    if (!callerProfile) return json(res, 401, { ok: false, error: 'Authentication required' })
  }

  if (!internalAuthorized) {
    const rate = await checkPushRateLimit(
      supabase,
      rateLimitKeyForProfile('request', callerProfile, bearerToken.slice(0, 16)),
      notifications.length,
      PUSH_REQUEST_RATE_LIMIT_MAX,
    )
    if (!rate.ok) {
      res.setHeader('Retry-After', String(rate.retryAfter))
      return json(res, 429, { ok: false, error: 'Push request rate limit exceeded', retryAfter: rate.retryAfter })
    }
  }

  try {
    for (const notice of notifications) {
      if (!(await canSendNotice(supabase, notice, callerProfile, internalAuthorized))) {
        return json(res, 403, { ok: false, error: 'Forbidden notification target' })
      }
    }
  } catch (err) {
    return pushServerError(res, err, 'authorization')
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

  const deliveries = []
  const preparedDeliveries = []
  let totalRecipients = 0
  for (const notice of notifications) {
    let recipients
    try {
      recipients = await subscriptionsForNotice(supabase, notice)
    } catch (err) {
      return pushServerError(res, err, 'subscription lookup')
    }
    if (recipients.length > PUSH_MAX_RECIPIENTS_PER_NOTICE) {
      return json(res, 413, { ok: false, error: `Too many push recipients for one notice. Limit is ${PUSH_MAX_RECIPIENTS_PER_NOTICE}.`, recipients: recipients.length })
    }
    totalRecipients += recipients.length
    preparedDeliveries.push({ notice, recipients })
    deliveries.push({
      noticeId: notice.id,
      type: notice.type,
      targetRole: notice.targetRole,
      targetDriverId: notice.targetDriverId,
      recipients: recipients.length,
    })
  }

  if (!internalAuthorized && totalRecipients > 0) {
    const deliveryRate = await checkPushRateLimit(
      supabase,
      rateLimitKeyForProfile('delivery', callerProfile, bearerToken.slice(0, 16)),
      totalRecipients,
      PUSH_DELIVERY_RATE_LIMIT_MAX,
    )
    if (!deliveryRate.ok) {
      res.setHeader('Retry-After', String(deliveryRate.retryAfter))
      return json(res, 429, { ok: false, error: 'Push delivery rate limit exceeded', retryAfter: deliveryRate.retryAfter, recipients: totalRecipients })
    }
  }

  const results = []
  for (const { notice, recipients } of preparedDeliveries) {
    const noticeResults = await runWithConcurrency(recipients, PUSH_CONCURRENCY, async (sub) => {
      try {
        await webpush.sendNotification(sub.subscription, JSON.stringify({
          title: notice.title,
          body: notice.body,
          tag: notice.shiftId ? `rbshift-${notice.shiftId}-${notice.type}` : `rbshift-${notice.id || Date.now()}`,
          url: '/',
          shiftId: notice.shiftId,
          type: notice.type,
          requireInteraction: ['new-shift', 'shift-change', 'swap-offer', 'swap-accepted', 'swap-rejected', 'open-shift-interest'].includes(notice.type),
        }))
        await supabase
          .from('push_subscriptions')
          .update({ last_delivery_at: new Date().toISOString(), last_error: null, delivery_failures: 0, last_seen_at: new Date().toISOString() })
          .eq('id', sub.id)
        return { id: sub.id, noticeId: notice.id, ok: true }
      } catch (err) {
        const statusCode = err?.statusCode || err?.status
        const message = err?.message || String(err)
        const patch = {
          last_error: message.slice(0, 500),
          delivery_failures: Number(sub.delivery_failures || 0) + 1,
          last_seen_at: new Date().toISOString(),
        }
        if (statusCode === 404 || statusCode === 410) {
          patch.active = false
        }
        await supabase.from('push_subscriptions').update(patch).eq('id', sub.id)
        return { id: sub.id, noticeId: notice.id, ok: false, statusCode, error: message }
      }
    })
    results.push(...noticeResults)
  }

  const sent = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  const callerRole = String(callerProfile?.role || '').toLowerCase()
  const payload = { ok: true, notifications: notifications.length, sent, failed, deliveries }
  if (internalAuthorized || callerRole === 'admin' || callerRole === 'dispatcher') payload.results = results
  return json(res, 200, payload)
}
