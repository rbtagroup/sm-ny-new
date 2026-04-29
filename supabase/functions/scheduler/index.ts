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
    .select('id, shift_date, start_time, end_time, status')
    .gte('shift_date', today)
    .lte('shift_date', dateTo)
    .not('status', 'in', '("cancelled","declined")')

  if (shiftsError) throw shiftsError

  const activeShifts = (shifts || []) as ShiftRow[]
  const days = Array.from({ length: 7 }, (_, index) => addDaysISO(today, index))

  const gaps = days.flatMap((day) =>
    coverageSlots.map((slot) => {
      const planned = activeShifts.filter((shift) =>
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
  const title = gaps.length ? `Chybí obsazení: ${gaps.length} kontrol` : 'Pokrytí směn je v pořádku'
  const body = gaps.length
    ? gaps.slice(0, 12).map((gap) => `${formatDate(gap.day)} · ${gap.slotName} ${gap.start}–${gap.end}: chybí ${gap.missing}`).join('\n')
    : `Kontrola ${today}–${dateTo}: bez chybějícího obsazení.`

  const { data: existingNotice, error: existingError } = await supabase
    .from('notifications')
    .select('id')
    .eq('target_role', 'admin')
    .eq('type', runKey)
    .maybeSingle()

  if (existingError) throw existingError

  let notificationCreated = false
  if (!existingNotice) {
    const { error: noticeError } = await supabase.from('notifications').insert({
      id: uid('ntf_scheduler'),
      target_role: 'admin',
      type: runKey,
      title,
      body,
      read_by: [],
      created_at: startedAt,
    })
    if (noticeError) throw noticeError
    notificationCreated = true
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
    shiftsChecked: activeShifts.length,
    gapsCount: gaps.length,
    notificationCreated,
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

    if (expectedSecret && receivedSecret !== expectedSecret) {
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
