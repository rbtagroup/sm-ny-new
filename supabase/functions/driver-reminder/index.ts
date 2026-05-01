import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type DriverRow = {
  id: string
  name?: string | null
  active?: boolean | null
}

type ShiftRow = {
  id: string
  shift_date: string
  start_time: string
  end_time: string
  status: string
  driver_id: string | null
}

const TZ = 'Europe/Prague'

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`
}

function driverReminderNoticeId(dateISO: string, driverId: string) {
  const safeDriverId = String(driverId || '').replace(/[^a-zA-Z0-9_-]/g, '_')
  return `ntf_driver_signup_${dateISO.replaceAll('-', '')}_${safeDriverId}`.slice(0, 160)
}

function localDateISO(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function localTimeParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date).map((part) => [part.type, part.value]),
  )
  return {
    weekday: String(parts.weekday || ''),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  }
}

function cronWindowSkipReason(body: any) {
  if (body?.source !== 'pg_cron') return ''
  const expectedHour = Number(body?.expectedLocalHour)
  const expectedWeekday = String(body?.expectedLocalWeekday || '')
  if (!Number.isFinite(expectedHour) || !expectedWeekday) return ''
  const local = localTimeParts()
  if (local.weekday === expectedWeekday && local.hour === expectedHour) return ''
  return `outside-prague-window:${local.weekday}-${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`
}

function addDaysISO(dateISO: string, days: number) {
  const [y, m, d] = dateISO.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0))
  return date.toISOString().slice(0, 10)
}

function pushDeliveryEndpoint() {
  const raw = Deno.env.get('PUSH_DELIVERY_URL') || Deno.env.get('APP_URL') || Deno.env.get('PUBLIC_APP_URL') || Deno.env.get('SITE_URL') || ''
  if (!raw) return ''
  const base = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`
  return base.endsWith('/api/send-push') ? base : `${base.replace(/\/$/, '')}/api/send-push`
}

async function sendPushForNotifications(notifications: Record<string, unknown>[]) {
  if (!notifications.length) return { skipped: true, reason: 'no-notifications' }
  const endpoint = pushDeliveryEndpoint()
  const secret = Deno.env.get('PUSH_DELIVERY_SECRET') || Deno.env.get('DRIVER_REMINDER_SECRET') || Deno.env.get('SCHEDULER_SECRET')
  if (!endpoint) return { skipped: true, reason: 'missing-push-delivery-url' }
  if (!secret) return { skipped: true, reason: 'missing-push-delivery-secret' }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rbshift-push-secret': secret,
      },
      body: JSON.stringify({ notifications }),
    })
    const text = await response.text()
    let payload: Record<string, unknown> = {}
    try { payload = text ? JSON.parse(text) : {} } catch { payload = { raw: text } }
    return { ok: response.ok, status: response.status, ...payload }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function insertDriverNotifications(
  supabase: ReturnType<typeof createClient>,
  rows: Record<string, unknown>[],
) {
  if (!rows.length) return { inserted: 0, payloadColumnUsed: true, duplicateSkipped: false }

  const { error } = await supabase.from('notifications').insert(rows)

  if (!error) return { inserted: rows.length, payloadColumnUsed: true, duplicateSkipped: false }
  if (error.code === '23505') return { inserted: 0, payloadColumnUsed: true, duplicateSkipped: true }

  const message = String(error.message || '')
  const missingPayloadColumn =
    message.includes('payload') ||
    message.includes('Could not find the') ||
    message.includes('schema cache')

  if (!missingPayloadColumn) throw error

  const fallbackRows = rows.map(({ payload: _payload, ...row }) => row)
  const { error: fallbackError } = await supabase.from('notifications').insert(fallbackRows)

  if (fallbackError?.code === '23505') return { inserted: 0, payloadColumnUsed: false, duplicateSkipped: true }
  if (fallbackError) throw fallbackError

  return { inserted: fallbackRows.length, payloadColumnUsed: false, duplicateSkipped: false }
}

async function runDriverSignupReminder(supabase: ReturnType<typeof createClient>, triggeredAt: string) {
  const today = localDateISO()
  const dateTo = addDaysISO(today, 13)
  const reminderType = `driver-signup-reminder:${today}`

  const { data: freeShifts, error: shiftsError } = await supabase
    .from('shifts')
    .select('id, shift_date, start_time, end_time, status, driver_id')
    .eq('status', 'open')
    .is('driver_id', null)
    .gte('shift_date', today)
    .lte('shift_date', dateTo)

  if (shiftsError) throw shiftsError

  const freeShiftsCount = ((freeShifts || []) as ShiftRow[]).length

  if (!freeShiftsCount) {
    const { error: auditError } = await supabase.from('audit_logs').insert({
      id: uid('log_driver_reminder'),
      action: 'driver-signup-reminder-sent',
      payload: {
        job: 'driver-signup-reminder',
        skipped: true,
        reason: 'no-free-shifts',
        driversNotified: 0,
        freeShiftsCount: 0,
        weekStart: today,
        dateTo,
        triggeredAt,
      },
      created_at: triggeredAt,
    })

    if (auditError) throw auditError

    return {
      ok: true,
      job: 'driver-signup-reminder',
      skipped: true,
      reason: 'no-free-shifts',
      driversNotified: 0,
      freeShiftsCount: 0,
      reminderType,
      weekStart: today,
      dateTo,
    }
  }

  const { data: drivers, error: driversError } = await supabase
    .from('drivers')
    .select('id, name, active')
    .eq('active', true)

  if (driversError) throw driversError

  const activeDrivers = ((drivers || []) as DriverRow[]).filter((driver) => Boolean(driver.id))
  const driverIds = activeDrivers.map((driver) => driver.id)

  if (!driverIds.length) {
    const { error: auditError } = await supabase.from('audit_logs').insert({
      id: uid('log_driver_reminder'),
      action: 'driver-signup-reminder-sent',
      payload: {
        job: 'driver-signup-reminder',
        skipped: true,
        reason: 'no-active-drivers',
        driversNotified: 0,
        freeShiftsCount,
        weekStart: today,
        dateTo,
        triggeredAt,
      },
      created_at: triggeredAt,
    })

    if (auditError) throw auditError

    return {
      ok: true,
      job: 'driver-signup-reminder',
      skipped: true,
      reason: 'no-active-drivers',
      driversNotified: 0,
      freeShiftsCount,
      reminderType,
      weekStart: today,
      dateTo,
    }
  }

  const { data: existingNotifications, error: existingError } = await supabase
    .from('notifications')
    .select('id, target_driver_id')
    .eq('type', reminderType)
    .in('target_driver_id', driverIds)

  if (existingError) throw existingError

  const alreadyNotified = new Set(
    ((existingNotifications || []) as Array<{ target_driver_id: string | null }>)
      .map((row) => row.target_driver_id)
      .filter(Boolean) as string[],
  )

  const driversToNotify = activeDrivers.filter((driver) => !alreadyNotified.has(driver.id))

  const body = `Je k dispozici ${freeShiftsCount} volných směn v příštích 14 dnech. Otevři app a přihlaš se.`
  const notificationPayload = {
    freeShiftsCount,
    weekStart: today,
  }

  const rows = driversToNotify.map((driver) => ({
    id: driverReminderNoticeId(today, driver.id),
    target_driver_id: driver.id,
    target_role: 'driver',
    type: reminderType,
    shift_id: null,
    title: 'Volné směny k obsazení',
    body,
    payload: notificationPayload,
    read_by: [],
    created_at: triggeredAt,
  }))

  const insertResult = await insertDriverNotifications(supabase, rows)
  const pushResult = insertResult.inserted > 0
    ? await sendPushForNotifications(rows)
    : { skipped: true, reason: insertResult.duplicateSkipped ? 'already-notified-race' : 'no-new-notifications' }

  const { error: auditError } = await supabase.from('audit_logs').insert({
    id: uid('log_driver_reminder'),
    action: 'driver-signup-reminder-sent',
    payload: {
      job: 'driver-signup-reminder',
      skipped: false,
      driversNotified: insertResult.inserted,
      driversAlreadyNotified: alreadyNotified.size,
      activeDrivers: activeDrivers.length,
      freeShiftsCount,
      reminderType,
      weekStart: today,
      dateTo,
      triggeredAt,
      payloadColumnUsed: insertResult.payloadColumnUsed,
      duplicateSkipped: insertResult.duplicateSkipped,
      pushResult,
    },
    created_at: triggeredAt,
  })

  if (auditError) throw auditError

  return {
    ok: true,
    job: 'driver-signup-reminder',
    skipped: false,
    driversNotified: insertResult.inserted,
    driversAlreadyNotified: alreadyNotified.size,
    activeDrivers: activeDrivers.length,
    freeShiftsCount,
    reminderType,
    weekStart: today,
    dateTo,
    payloadColumnUsed: insertResult.payloadColumnUsed,
    duplicateSkipped: insertResult.duplicateSkipped,
    pushResult,
  }
}

Deno.serve(async (req) => {
  const triggeredAt = new Date().toISOString()

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'Method not allowed. Use POST.' }, 405)
    }

    const expectedSecret = Deno.env.get('DRIVER_REMINDER_SECRET') || Deno.env.get('SCHEDULER_SECRET')
    const receivedSecret = req.headers.get('x-driver-reminder-secret') || req.headers.get('x-scheduler-secret')

    if (!expectedSecret) {
      return jsonResponse({ ok: false, error: 'Missing DRIVER_REMINDER_SECRET or SCHEDULER_SECRET.' }, 500)
    }

    if (receivedSecret !== expectedSecret) {
      return jsonResponse({ ok: false, error: 'Unauthorized driver reminder call.' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ ok: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.' }, 500)
    }

    const body = await req.json().catch(() => ({}))
    const job = body?.job || 'driver-signup-reminder'

    if (job !== 'driver-signup-reminder') {
      return jsonResponse({ ok: false, error: `Unknown driver reminder job: ${job}` }, 400)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const skipReason = cronWindowSkipReason(body)
    if (skipReason) {
      const { error: auditError } = await supabase.from('audit_logs').insert({
        id: uid('log_driver_reminder'),
        action: 'driver-signup-reminder-sent',
        payload: {
          job: 'driver-signup-reminder',
          skipped: true,
          reason: skipReason,
          source: body?.source || '',
          localTime: localTimeParts(),
          triggeredAt,
        },
        created_at: triggeredAt,
      })
      if (auditError) throw auditError
      return jsonResponse({
        ok: true,
        job: 'driver-signup-reminder',
        skipped: true,
        reason: skipReason,
      })
    }

    const result = await runDriverSignupReminder(supabase, triggeredAt)
    return jsonResponse(result)
  } catch (error) {
    console.error('Driver reminder failed', error)
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      at: triggeredAt,
    }, 500)
  }
})
