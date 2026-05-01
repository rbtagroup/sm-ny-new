import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type CoverageSlot = {
  id?: string
  name?: string
  start: string
  end: string
  minDrivers?: number
}

type ShiftRow = {
  id: string
  shift_date: string
  start_time: string
  end_time: string
  status: string
  driver_id: string | null
}

const DEFAULT_COVERAGE_SLOTS: CoverageSlot[] = [
  { id: 'cov_day', name: 'Denní', start: '07:00', end: '19:00', minDrivers: 1 },
  { id: 'cov_night', name: 'Noční', start: '19:00', end: '07:00', minDrivers: 1 },
]

const TZ = 'Europe/Prague'

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function localDateISO(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function addDaysISO(dateISO: string, days: number) {
  const [y, m, d] = dateISO.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0))
  return date.toISOString().slice(0, 10)
}

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`
}

function dailyCoverageNoticeId(dateISO: string) {
  return `ntf_daily_coverage_${dateISO.replaceAll('-', '')}`
}

function isCoverageShift(shift: ShiftRow) {
  const status = String(shift.status || '').toLowerCase()
  return Boolean(shift.driver_id) && ['assigned', 'confirmed', 'in_progress', 'pending'].includes(status)
}

function timeMinutes(value = '00:00') {
  const [h, m] = String(value).slice(0, 5).split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

function overlapsTimeWindow(shiftStart: string, shiftEnd: string, slotStart: string, slotEnd: string) {
  const s1 = timeMinutes(shiftStart)
  let s2 = timeMinutes(shiftEnd)
  const w1 = timeMinutes(slotStart)
  let w2 = timeMinutes(slotEnd)

  if (s2 <= s1) s2 += 24 * 60
  if (w2 <= w1) w2 += 24 * 60

  const intervals = [[s1, s2]]
  if (s2 > 24 * 60) intervals.push([s1 - 24 * 60, s2 - 24 * 60])

  const windows = [[w1, w2]]
  if (w2 > 24 * 60) windows.push([w1 - 24 * 60, w2 - 24 * 60])

  return intervals.some(([a1, a2]) => windows.some(([b1, b2]) => a1 < b2 && b1 < a2))
}

function formatDate(dateISO: string) {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Intl.DateTimeFormat('cs-CZ', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(Date.UTC(y, m - 1, d, 12)))
}

function normalizeSlots(payload: any): CoverageSlot[] {
  const fromSettings = Array.isArray(payload?.coverageSlots) ? payload.coverageSlots : []
  const slots = fromSettings.length ? fromSettings : DEFAULT_COVERAGE_SLOTS
  return slots
    .map((slot: any, index: number) => ({
      id: String(slot.id || `slot_${index + 1}`),
      name: String(slot.name || `Pásmo ${index + 1}`),
      start: String(slot.start || '07:00').slice(0, 5),
      end: String(slot.end || '19:00').slice(0, 5),
      minDrivers: Math.max(0, Number(slot.minDrivers || 0)),
    }))
    .filter((slot) => slot.minDrivers && slot.start && slot.end)
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
  const secret = Deno.env.get('PUSH_DELIVERY_SECRET') || Deno.env.get('SCHEDULER_SECRET')
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

async function runDailyCoverage(supabase: ReturnType<typeof createClient>, startedAt: string) {
  const today = localDateISO()
  const dateTo = addDaysISO(today, 6)

  const { data: settingsRow, error: settingsError } = await supabase
    .from('app_settings')
    .select('payload')
    .eq('id', 'default')
    .maybeSingle()

  if (settingsError) throw settingsError

  const coverageSlots = normalizeSlots(settingsRow?.payload || {})

  const { data: shifts, error: shiftsError } = await supabase
    .from('shifts')
    .select('id, shift_date, start_time, end_time, status, driver_id')
    .gte('shift_date', today)
    .lte('shift_date', dateTo)

  if (shiftsError) throw shiftsError

  const rawShifts = (shifts || []) as ShiftRow[]
  const coverageShifts = rawShifts.filter(isCoverageShift)
  const days = Array.from({ length: 7 }, (_, index) => addDaysISO(today, index))

  const gaps = days.flatMap((day) =>
    coverageSlots.map((slot) => {
      const planned = coverageShifts.filter((shift) =>
        shift.shift_date === day &&
        overlapsTimeWindow(String(shift.start_time).slice(0, 5), String(shift.end_time).slice(0, 5), slot.start, slot.end)
      ).length

      return {
        day,
        slotId: slot.id,
        slotName: slot.name,
        start: slot.start,
        end: slot.end,
        planned,
        minDrivers: slot.minDrivers || 0,
        missing: Math.max(0, (slot.minDrivers || 0) - planned),
      }
    })
  ).filter((row) => row.missing > 0)

  const runKey = `daily-coverage:${today}`
  let notificationCreated = false
  let pushResult: Record<string, unknown> = { skipped: true, reason: 'no-missing-coverage' }
  let skippedReason = ''

  if (gaps.length) {
    const title = `Chybí obsazení: ${gaps.length} kontrol`
    const body = gaps.slice(0, 12).map((gap) => `${formatDate(gap.day)} · ${gap.slotName} ${gap.start}–${gap.end}: chybí ${gap.missing}`).join('\n')
    const notice = {
      id: dailyCoverageNoticeId(today),
      target_role: 'admin',
      type: runKey,
      title,
      body,
      read_by: [],
      created_at: startedAt,
    }

    const { data: existingNotice, error: existingError } = await supabase
      .from('notifications')
      .select('id')
      .eq('target_role', 'admin')
      .eq('type', runKey)
      .limit(1)
      .maybeSingle()

    if (existingError) throw existingError

    if (existingNotice) {
      skippedReason = 'already-notified'
    } else {
      const { error: noticeError } = await supabase.from('notifications').insert(notice)
      if (noticeError && noticeError.code !== '23505') throw noticeError
      notificationCreated = !noticeError
      skippedReason = noticeError ? 'already-notified-race' : ''
      if (notificationCreated) pushResult = await sendPushForNotifications([notice])
    }
  } else {
    skippedReason = 'no-missing-coverage'
  }

  const { error: auditError } = await supabase.from('audit_logs').insert({
    id: uid('log_scheduler'),
    action: `Scheduler daily-coverage: ${gaps.length} chybějících kontrol (${today}–${dateTo}).`,
    payload: {
      job: 'daily-coverage',
      runKey,
      today,
      dateTo,
      gapsCount: gaps.length,
      notificationCreated,
      skipped: !notificationCreated,
      skippedReason,
      pushResult,
      rawShiftsChecked: rawShifts.length,
      coverageShiftsChecked: coverageShifts.length,
      gaps: gaps.slice(0, 50),
    },
    created_at: startedAt,
  })

  if (auditError) throw auditError

  return {
    ok: true,
    job: 'daily-coverage',
    runKey,
    today,
    dateTo,
    coverageSlots: coverageSlots.length,
    rawShiftsChecked: rawShifts.length,
    shiftsChecked: coverageShifts.length,
    gapsCount: gaps.length,
    notificationCreated,
    skipped: !notificationCreated,
    skippedReason,
    pushResult,
    gaps: gaps.slice(0, 20),
  }
}

Deno.serve(async (req) => {
  const startedAt = new Date().toISOString()

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'Method not allowed. Use POST.' }, 405)
    }

    const expectedSecret = Deno.env.get('SCHEDULER_SECRET')
    const receivedSecret = req.headers.get('x-scheduler-secret')

    if (!expectedSecret) {
      return jsonResponse({ ok: false, error: 'Missing SCHEDULER_SECRET.' }, 500)
    }

    if (receivedSecret !== expectedSecret) {
      return jsonResponse({ ok: false, error: 'Unauthorized scheduler call.' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ ok: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.' }, 500)
    }

    const body = await req.json().catch(() => ({}))
    const job = body?.job || 'daily-coverage'

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    if (job !== 'daily-coverage') {
      return jsonResponse({ ok: false, error: `Unknown scheduler job: ${job}` }, 400)
    }

    const result = await runDailyCoverage(supabase, startedAt)
    return jsonResponse(result)
  } catch (error) {
    console.error('Scheduler failed', error)
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      at: startedAt,
    }, 500)
  }
})
