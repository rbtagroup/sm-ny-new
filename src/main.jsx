import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient } from '@supabase/supabase-js'

const VERSION = '1.3.9-v5.4.4-auto-confirm-swap'
const STORAGE_KEY = 'rbshift-manager-data-v4'
const LEGACY_STORAGE_KEYS = ['rbshift-manager-data-v3', 'rbshift-manager-data-v2', 'rbshift-manager-data']
const AUTOBACKUP_KEY = `${STORAGE_KEY}-autobackup`
const todayISO = () => new Date().toISOString().slice(0, 10)
const uid = (prefix = 'id') => `${prefix}_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 11)}`

const makeNotice = ({ title, body = '', targetDriverId = '', targetRole = 'admin', type = 'info', shiftId = '' }) => ({
  id: uid('ntf'),
  at: new Date().toISOString(),
  title,
  body,
  targetDriverId,
  targetRole,
  type,
  shiftId,
  readBy: [],
})
function addNotificationsToData(data, notices) {
  const clean = (Array.isArray(notices) ? notices : [notices]).filter(Boolean)
  if (!clean.length) return data
  return { ...data, notifications: [...clean, ...(data.notifications || [])].slice(0, 500) }
}
function isNoticeVisible(notice, currentDriver, isDriver) {
  if (!notice) return false
  if (!isDriver) return true
  if (notice.targetRole === 'all' || notice.targetRole === 'driver_all') return true
  return Boolean(currentDriver?.id && notice.targetDriverId === currentDriver.id)
}
function isNoticeRead(notice, currentDriver, isDriver) {
  const key = isDriver ? `driver:${currentDriver?.id || ''}` : 'admin'
  return (notice.readBy || []).includes(key)
}
function markNoticeRead(notice, currentDriver, isDriver) {
  const key = isDriver ? `driver:${currentDriver?.id || ''}` : 'admin'
  return { ...notice, readBy: [...new Set([...(notice.readBy || []), key])] }
}
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}
async function showBrowserNotification(title, body = '') {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') return false
  const reg = await navigator.serviceWorker.ready
  await reg.showNotification(title, { body, icon: './icons/icon-192.png', badge: './icons/icon-192.png', tag: `rbshift-${Date.now()}`, data: { url: './' } })
  return true
}
async function subscribeDeviceForPush(vapidPublicKey) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Push notifikace nejsou v tomto prohlížeči dostupné.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifikace nejsou povolené.')
  const reg = await navigator.serviceWorker.ready
  if (!vapidPublicKey) return { mode: 'local-test-only', permission, endpoint: '' }
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) })
  return sub.toJSON()
}

const money = (n) => `${Math.round(Number(n || 0)).toLocaleString('cs-CZ')} Kč`
const time = (v) => v || '—'
const statusMap = { open: 'Volná směna', draft: 'Návrh', assigned: 'Čeká na potvrzení', confirmed: 'Potvrzeno', declined: 'Odmítnuto', completed: 'Dokončeno', cancelled: 'Zrušeno' }
const statusToneMap = { open: 'warn', draft: 'warn', assigned: 'warn', confirmed: 'good', declined: 'bad', completed: 'good', cancelled: 'bad' }
const roleMap = { admin: 'Admin', dispatcher: 'Dispečer', driver: 'Řidič' }
const shiftTypeMap = { day: 'Denní', night: 'Noční', backup: 'Záloha', transfer: 'Převoz', custom: 'Vlastní' }
const repeatMap = { none: 'Neopakovat', daily7: '7 dnů za sebou', workweek: 'Po–Pá', weekend: 'So–Ne' }
const shiftTemplateMap = {
  custom: 'Vlastní čas',
  morning: 'Ranní 06:00–14:00',
  afternoon: 'Odpolední 14:00–22:00',
  night: 'Noční 22:00–06:00',
  allDay: 'Celodenní 08:00–20:00',
  event: 'Ples / akce 18:00–03:00',
}
const shiftTemplates = {
  morning: { start: '06:00', end: '14:00', type: 'day' },
  afternoon: { start: '14:00', end: '22:00', type: 'day' },
  night: { start: '22:00', end: '06:00', type: 'night' },
  allDay: { start: '08:00', end: '20:00', type: 'day' },
  event: { start: '18:00', end: '03:00', type: 'custom' },
}
const swapStatusMap = { pending: 'Nabídnuto', accepted: 'Přijato kolegou', approved: 'Schváleno', rejected: 'Zamítnuto', cancelled: 'Zrušeno řidičem' }
const weekdayMap = { 1: 'Po', 2: 'Út', 3: 'St', 4: 'Čt', 5: 'Pá', 6: 'So', 0: 'Ne' }

const rolePolicies = [
  { role: 'Admin', can: 'vše: plánování, řidiči, auta, nastavení, audit, schvalování výměn, exporty a zálohy' },
  { role: 'Dispečer', can: 'směny, auta, řidiči, dostupnost, výměny, notifikace a provozní dashboard bez resetu dat' },
  { role: 'Řidič', can: 'jen svoje směny, potvrzení/odmítnutí, docházka, vlastní dostupnost, výměny a svoje notifikace' },
]
const notificationRules = [
  ['Nová směna', 'řidič dostane upozornění hned po vytvoření směny'],
  ['Volná směna', 'pokud směna nemá řidiče, přijde push všem aktivním řidičům a mohou projevit zájem'],
  ['Změna směny', 'řidič dostane upozornění při změně času, auta, instrukcí nebo stavu'],
  ['Zrušení / odmítnutí', 'řidič a admin vidí důvod a změnu v centru notifikací'],
  ['Nabídka výměny', 'nabídka jde všem kolegům nebo vybranému kolegovi'],
  ['Převzetí výměny', 'admin dostane upozornění a musí převzetí schválit'],
  ['Schválení / zamítnutí výměny', 'notifikace přijde původnímu i novému řidiči'],
  ['Nástup / konec směny', 'admin vidí změnu v historii a notifikaci'],
  ['Nepotvrzené směny', 'lokálně se zobrazí v auditu; v Supabase půjde doplnit plánovaná serverová připomínka'],
]
function shiftNoticeTarget(shift) {
  return shift?.driverId ? { targetDriverId: shift.driverId } : { targetRole: 'driver_all' }
}
function statusNoticeForShift(shift, status, helpers, reason = '') {
  const label = statusMap[status] || status
  const body = `${formatDate(shift.date)} ${shift.start}–${shift.end} · ${helpers.vehicleName(shift.vehicleId)}${reason ? ` · důvod: ${reason}` : ''}`
  return makeNotice({ title: `Stav směny: ${label}`, body, ...shiftNoticeTarget(shift), type: `shift-${status}`, shiftId: shift.id })
}
function cancellationNoticeForShift(shift, helpers, reason = '') {
  return makeNotice({
    title: 'Směna byla zrušena',
    body: `${formatDate(shift.date)} ${shift.start}–${shift.end} · ${helpers.vehicleName(shift.vehicleId)}${reason ? ` · ${reason}` : ''}`,
    ...shiftNoticeTarget(shift),
    type: 'shift-cancelled',
    shiftId: shift.id,
  })
}
function cancelShiftData(data, shift, helpers, reason = 'Zrušeno dispečerem') {
  const now = new Date().toISOString()
  const relatedSwaps = (data.swapRequests || []).filter((r) => r.shiftId === shift.id && ['pending','accepted'].includes(r.status))
  const notices = [cancellationNoticeForShift(shift, helpers, reason)]
  relatedSwaps.forEach((r) => {
    if (r.acceptedByDriverId && r.acceptedByDriverId !== shift.driverId) notices.push(makeNotice({ title: 'Výměna směny zrušena', body: `${formatDate(shift.date)} ${shift.start}–${shift.end}`, targetDriverId: r.acceptedByDriverId, type: 'swap-cancelled', shiftId: shift.id }))
    if (r.targetDriverId && r.targetDriverId !== shift.driverId) notices.push(makeNotice({ title: 'Nabídka výměny zrušena', body: `${formatDate(shift.date)} ${shift.start}–${shift.end}`, targetDriverId: r.targetDriverId, type: 'swap-cancelled', shiftId: shift.id }))
  })
  return addNotificationsToData({
    ...data,
    shifts: (data.shifts || []).map((s) => s.id === shift.id ? { ...s, status: 'cancelled', declineReason: reason, actualEndAt: s.actualEndAt || '' } : s),
    swapRequests: (data.swapRequests || []).map((r) => r.shiftId === shift.id && ['pending','accepted'].includes(r.status) ? appendSwapHistory({ ...r, status: 'cancelled', cancelledAt: now, resolvedAt: now }, 'Směna byla zrušena dispečerem.') : r),
  }, notices)
}
function adminNotice(title, body, type = 'info', shiftId = '') {
  return makeNotice({ title, body, targetRole: 'admin', type, shiftId })
}

function isAuditRelatedToShift(row, shift) {
  const text = String(row?.text || row?.action || '')
  if (!text || !shift) return false
  const fragments = [shift.id, shift.date, formatDate(shift.date), `${shift.start}–${shift.end}`, `${shift.start}-${shift.end}`].filter(Boolean)
  return fragments.some((part) => text.includes(part)) && (text.includes(shift.start || '') || text.includes(shift.date || '') || text.includes(formatDate(shift.date)))
}
function hardDeleteShiftData(data, shift) {
  if (!shift?.id) return data
  return {
    ...data,
    shifts: (data.shifts || []).filter((s) => s.id !== shift.id),
    swapRequests: (data.swapRequests || []).filter((r) => r.shiftId !== shift.id),
    notifications: (data.notifications || []).filter((n) => n.shiftId !== shift.id),
    audit: (data.audit || []).filter((row) => !isAuditRelatedToShift(row, shift)),
  }
}
function confirmHardDeleteShift(shift, helpers) {
  const label = `${formatDate(shift.date)} ${shift.start}–${shift.end} · ${helpers.driverName(shift.driverId)} · ${helpers.vehicleName(shift.vehicleId)}`
  return prompt(`TRVALÉ SMAZÁNÍ SMĚNY\n\n${label}\n\nTato akce odstraní směnu z databáze, z řidičské aplikace, související žádosti o výměnu a notifikace. Řidiči se neposílá žádná další notifikace a nevytvoří se nový záznam v historii.\n\nPro potvrzení napiš: SMAZAT`, '') === 'SMAZAT'
}
function appendSwapHistory(req, text) {
  return { ...req, history: [...(req.history || []), { at: new Date().toISOString(), text }] }
}


const isConfiguredSupabase = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
const supabase = isConfiguredSupabase ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY) : null


const ONLINE_TABLES = [
  'drivers', 'vehicles', 'shifts', 'absences', 'availability', 'serviceBlocks', 'swapRequests', 'notifications', 'pushSubscriptions', 'audit'
]
const tableName = (key) => ({ serviceBlocks: 'service_blocks', swapRequests: 'swap_requests', pushSubscriptions: 'push_subscriptions', audit: 'audit_logs' }[key] || key)
const normalizeId = (id, prefix = 'id') => id || uid(prefix)
const stripUndefined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
const toDb = {
  drivers: (d) => stripUndefined({ id: normalizeId(d.id, 'drv'), profile_id: d.profileId || d.profile_id || null, name: d.name || '', phone: d.phone || null, email: d.email || null, active: d.active !== false, note: d.note || null }),
  vehicles: (v) => stripUndefined({ id: normalizeId(v.id, 'car'), name: v.name || '', plate: v.plate || '', active: v.active !== false, note: v.note || null }),
  shifts: (s) => stripUndefined({ id: normalizeId(s.id, 'sh'), shift_date: s.date, start_time: s.start || '00:00', end_time: s.end || '00:00', driver_id: s.driverId || null, vehicle_id: s.vehicleId || null, type: s.type || 'day', status: s.status || 'assigned', note: s.note || null, instruction: s.instruction || null, decline_reason: s.declineReason || null, actual_start_at: s.actualStartAt || null, actual_end_at: s.actualEndAt || null, swap_request_status: s.swapRequestStatus || null }),
  absences: (a) => stripUndefined({ id: normalizeId(a.id, 'abs'), driver_id: a.driverId, from_date: a.from, to_date: a.to, reason: a.reason || null }),
  availability: (a) => stripUndefined({ id: normalizeId(a.id, 'av'), driver_id: a.driverId, weekday: Number(a.weekday || 0), start_time: a.start || '00:00', end_time: a.end || '23:59', note: a.note || null }),
  serviceBlocks: (b) => stripUndefined({ id: normalizeId(b.id, 'srv'), vehicle_id: b.vehicleId, from_date: b.from, to_date: b.to, reason: b.reason || null }),
  swapRequests: (r) => stripUndefined({ id: normalizeId(r.id, 'swap'), shift_id: r.shiftId, driver_id: r.driverId, target_mode: r.targetMode || 'all', target_driver_id: r.targetDriverId || null, accepted_by_driver_id: r.acceptedByDriverId || null, approved_driver_id: r.approvedDriverId || null, status: r.status || 'pending', reason: r.reason || null, rejected_reason: r.rejectedReason || null, history: r.history || [], created_at: r.createdAt || new Date().toISOString(), accepted_at: r.acceptedAt || null, resolved_at: r.resolvedAt || null, cancelled_at: r.cancelledAt || null }),
  notifications: (n) => stripUndefined({ id: normalizeId(n.id, 'ntf'), target_driver_id: n.targetDriverId || null, target_role: n.targetRole || 'admin', type: n.type || 'info', shift_id: n.shiftId || null, title: n.title || '', body: n.body || null, read_by: n.readBy || [], created_at: n.at || n.createdAt || new Date().toISOString() }),
  pushSubscriptions: (p) => stripUndefined({ id: normalizeId(p.id, 'push'), profile_id: p.profileId || null, driver_id: p.driverId || null, role: p.role || 'driver', endpoint: p.endpoint || '', subscription: p.subscription || p, platform: p.platform || null, active: p.active !== false, last_seen_at: new Date().toISOString() }),
  audit: (a) => stripUndefined({ id: normalizeId(a.id, 'log'), action: a.text || a.action || '', payload: a.payload || {}, created_at: a.at || a.createdAt || new Date().toISOString() }),
}
const fromDb = {
  drivers: (d) => ({ id: d.id, profileId: d.profile_id || '', name: d.name || '', phone: d.phone || '', email: d.email || '', active: d.active !== false, note: d.note || '' }),
  vehicles: (v) => ({ id: v.id, name: v.name || '', plate: v.plate || '', active: v.active !== false, note: v.note || '' }),
  shifts: (s) => ({ id: s.id, date: s.shift_date, start: String(s.start_time || '').slice(0,5), end: String(s.end_time || '').slice(0,5), driverId: s.driver_id || '', vehicleId: s.vehicle_id || '', type: s.type || 'day', status: s.status || 'assigned', note: s.note || '', instruction: s.instruction || '', declineReason: s.decline_reason || '', actualStartAt: s.actual_start_at || '', actualEndAt: s.actual_end_at || '', swapRequestStatus: s.swap_request_status || '' }),
  absences: (a) => ({ id: a.id, driverId: a.driver_id, from: a.from_date, to: a.to_date, reason: a.reason || '' }),
  availability: (a) => ({ id: a.id, driverId: a.driver_id, weekday: Number(a.weekday), start: String(a.start_time || '').slice(0,5), end: String(a.end_time || '').slice(0,5), note: a.note || '' }),
  serviceBlocks: (b) => ({ id: b.id, vehicleId: b.vehicle_id, from: b.from_date, to: b.to_date, reason: b.reason || '' }),
  swapRequests: (r) => ({ id: r.id, shiftId: r.shift_id, driverId: r.driver_id, targetMode: r.target_mode || 'all', targetDriverId: r.target_driver_id || '', acceptedByDriverId: r.accepted_by_driver_id || '', approvedDriverId: r.approved_driver_id || '', status: r.status || 'pending', reason: r.reason || '', rejectedReason: r.rejected_reason || '', history: r.history || [], createdAt: r.created_at, acceptedAt: r.accepted_at || '', resolvedAt: r.resolved_at || '', cancelledAt: r.cancelled_at || '' }),
  notifications: (n) => ({ id: n.id, at: n.created_at, title: n.title || '', body: n.body || '', targetDriverId: n.target_driver_id || '', targetRole: n.target_role || 'admin', type: n.type || 'info', shiftId: n.shift_id || '', readBy: n.read_by || [] }),
  pushSubscriptions: (p) => ({ id: p.id, profileId: p.profile_id || '', driverId: p.driver_id || '', role: p.role || 'driver', endpoint: p.endpoint || '', subscription: p.subscription || {}, platform: p.platform || '', active: p.active !== false }),
  audit: (a) => ({ id: a.id, at: a.created_at, text: a.action || '' }),
}

async function loadDataFromSupabase() {
  if (!supabase) return readStore()
  const base = seed()
  const output = { ...base }
  const errors = []
  for (const key of ONLINE_TABLES) {
    const tn = tableName(key)
    const { data: rows, error } = await supabase.from(tn).select('*').order(key === 'audit' ? 'created_at' : 'id', { ascending: key !== 'audit' })
    if (error) {
      if (key === 'audit') { output[key] = []; continue }
      errors.push(`${tn}: ${error.message}`); continue
    }
    output[key] = (rows || []).map(fromDb[key])
  }
  const { data: settingsRow } = await supabase.from('app_settings').select('payload').eq('id','default').maybeSingle()
  output.settings = { ...base.settings, ...(settingsRow?.payload || {}) }
  if (errors.length) throw new Error(errors.join('\n'))
  return output
}

function changedRows(prevList = [], nextList = []) {
  const prev = new Map((prevList || []).map((x) => [x.id, JSON.stringify(x)]))
  return (nextList || []).filter((x) => !prev.has(x.id) || prev.get(x.id) !== JSON.stringify(x))
}
function addedRows(prevList = [], nextList = []) {
  const prevIds = new Set((prevList || []).map((x) => x.id))
  return (nextList || []).filter((x) => x?.id && !prevIds.has(x.id))
}
async function sendPushForNotifications(notices) {
  const clean = (Array.isArray(notices) ? notices : [notices]).filter((n) => n?.title)
  if (!clean.length || !isConfiguredSupabase || !import.meta.env.VITE_VAPID_PUBLIC_KEY) return
  try {
    const res = await fetch('/api/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notifications: clean }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.warn('RBSHIFT push send failed:', text || res.statusText)
    }
  } catch (err) {
    console.warn('RBSHIFT push send unavailable:', err)
  }
}
async function syncChangedRows(prev, next, profile) {
  if (!supabase || !profile) return
  const isStaff = ['admin','dispatcher'].includes(profile.role)
  const currentDriver = !isStaff ? (next.drivers || []).find((d) => d.profileId === profile.id || (d.email && profile.email && d.email.toLowerCase() === profile.email.toLowerCase())) : null
  const currentDriverId = currentDriver?.id || ''
  const allowedForDriver = new Set(['shifts','absences','availability','swapRequests','notifications','pushSubscriptions','audit'])
  for (const key of ONLINE_TABLES) {
    if (!isStaff && !allowedForDriver.has(key)) continue
    let changed = changedRows(prev[key], next[key])
    // Řidič při převzetí nabídnuté / volné směny mění lokálně i swapRequestStatus.
    // Pokud směnu nevlastní, neposíláme update do tabulky shifts; ukládá se jen swap_requests.
    if (!isStaff && key === 'shifts') {
      changed = changed.filter((row) => row.driverId === currentDriverId)
    }
    const rows = changed.map(toDb[key]).filter((r) => r.id)
    if (rows.length) {
      const { error } = await supabase.from(tableName(key)).upsert(rows, { onConflict: 'id' })
      if (error) throw new Error(`${tableName(key)}: ${error.message}`)
    }
    if (isStaff) {
      const nextIds = new Set((next[key] || []).map((x) => x.id))
      const removed = (prev[key] || []).filter((x) => x.id && !nextIds.has(x.id)).map((x) => x.id)
      if (removed.length) {
        const { error } = await supabase.from(tableName(key)).delete().in('id', removed)
        if (error) throw new Error(`${tableName(key)} delete: ${error.message}`)
      }
    }
  }
  if (isStaff && JSON.stringify(prev.settings || {}) !== JSON.stringify(next.settings || {})) {
    await supabase.from('app_settings').upsert({ id: 'default', payload: next.settings || {}, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  }
}
async function seedSupabaseFromLocal(localData) {
  if (!supabase) return
  for (const key of ONLINE_TABLES) {
    const rows = (localData[key] || []).map(toDb[key]).filter((r) => r.id)
    if (rows.length) {
      const { error } = await supabase.from(tableName(key)).upsert(rows, { onConflict: 'id' })
      if (error) throw new Error(`${tableName(key)}: ${error.message}`)
    }
  }
  await supabase.from('app_settings').upsert({ id: 'default', payload: localData.settings || {}, updated_at: new Date().toISOString() }, { onConflict: 'id' })
}

function seed() {
  const t = todayISO()
  const w = startOfWeek(t)
  return {
    drivers: [
      { id: 'drv_roman', name: 'Roman', phone: '+420 777 111 222', email: 'roman@example.cz', active: true, note: 'Stálý řidič' },
      { id: 'drv_lukas', name: 'Lukáš', phone: '+420 777 702 702', email: 'prace@rbgroup.cz', active: true, note: 'Admin / záskok' },
      { id: 'drv_petra', name: 'Petra', phone: '+420 777 333 444', email: 'petra@example.cz', active: true, note: 'Víkendy' },
      { id: 'drv_milan', name: 'Milan', phone: '+420 777 444 555', email: 'milan@example.cz', active: true, note: 'Noční směny' },
    ],
    vehicles: [
      { id: 'car_tesla_1', name: 'Tesla Model 3', plate: 'RB 001', active: true, note: 'Hlavní vůz' },
      { id: 'car_tesla_2', name: 'Tesla Model 3', plate: 'RB 002', active: true, note: 'Noční provoz' },
      { id: 'car_van_1', name: 'VAN 7 míst', plate: 'RB 007', active: true, note: 'Skupiny / letiště' },
    ],
    shifts: [
      { id: 'sh_1', date: w, start: '06:00', end: '14:00', driverId: 'drv_roman', vehicleId: 'car_tesla_1', type: 'day', status: 'confirmed', note: 'Denní Hodonín', declineReason: '' },
      { id: 'sh_2', date: w, start: '14:00', end: '22:00', driverId: 'drv_petra', vehicleId: 'car_tesla_2', type: 'day', status: 'assigned', note: 'Odpolední špička', declineReason: '' },
      { id: 'sh_3', date: w, start: '22:00', end: '06:00', driverId: 'drv_milan', vehicleId: 'car_tesla_1', type: 'night', status: 'assigned', note: 'Noční provoz', declineReason: '' },
      { id: 'sh_4', date: addDays(w, 1), start: '06:00', end: '14:00', driverId: 'drv_lukas', vehicleId: 'car_van_1', type: 'day', status: 'draft', note: 'Záskok / převozy', declineReason: '' },
    ],
    absences: [],
    availability: [
      { id: 'av_roman_1', driverId: 'drv_roman', weekday: 1, start: '06:00', end: '18:00', note: 'Preferuje denní provoz' },
      { id: 'av_roman_2', driverId: 'drv_roman', weekday: 2, start: '06:00', end: '18:00', note: '' },
      { id: 'av_petra_6', driverId: 'drv_petra', weekday: 6, start: '10:00', end: '23:00', note: 'Víkendy' },
      { id: 'av_milan_5', driverId: 'drv_milan', weekday: 5, start: '18:00', end: '06:00', note: 'Noční' },
      { id: 'av_milan_6', driverId: 'drv_milan', weekday: 6, start: '18:00', end: '06:00', note: 'Noční' },
    ],
    serviceBlocks: [],
    swapRequests: [],
    notifications: [],
    pushSubscriptions: [],
    audit: [{ id: uid('log'), at: new Date().toISOString(), text: 'Vytvořena demo data aplikace.' }],
    settings: { companyName: 'RBSHIFT', mode: 'demo', lastBackupAt: '', mobileCompact: true, coverageSlots: [
      { id: 'cov_morning', name: 'Ráno', start: '06:00', end: '14:00', minDrivers: 1 },
      { id: 'cov_afternoon', name: 'Odpoledne', start: '14:00', end: '22:00', minDrivers: 1 },
      { id: 'cov_night', name: 'Noc', start: '22:00', end: '06:00', minDrivers: 1 },
      { id: 'cov_peak_fri', name: 'Pá/Sobota špička', start: '20:00', end: '03:00', minDrivers: 2 },
      { id: 'cov_event', name: 'Akce / plesy', start: '18:00', end: '02:00', minDrivers: 2 },
    ], deploymentChecklist: [] },
  }
}

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean)
    if (!raw) return seed()
    const parsed = JSON.parse(raw)
    const base = seed()
    return {
      ...base,
      ...parsed,
      drivers: parsed.drivers || base.drivers,
      vehicles: parsed.vehicles || base.vehicles,
      shifts: (parsed.shifts || base.shifts).map((s) => ({ declineReason: '', instruction: '', actualStartAt: '', actualEndAt: '', swapRequestStatus: '', ...s })),
      absences: parsed.absences || [],
      availability: parsed.availability || base.availability || [],
      serviceBlocks: parsed.serviceBlocks || [],
      swapRequests: (parsed.swapRequests || []).map((r) => ({ targetMode: 'all', targetDriverId: '', acceptedByDriverId: '', acceptedAt: '', resolvedAt: '', approvedDriverId: '', rejectedReason: '', cancelledAt: '', history: [], ...r })),
      notifications: parsed.notifications || [],
      pushSubscriptions: parsed.pushSubscriptions || [],
      audit: parsed.audit || [],
      settings: { ...base.settings, ...(parsed.settings || {}) },
    }
  } catch {
    return seed()
  }
}
function writeStore(data) {
  const enriched = { ...data, settings: { ...(data.settings || {}), lastSavedAt: new Date().toISOString() } }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(enriched))
  localStorage.setItem(AUTOBACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), data: enriched }))
}

function minutes(value) {
  const [h, m] = String(value || '00:00').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
function addDays(date, days) {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function startOfWeek(date) {
  const d = new Date(`${date}T12:00:00`)
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  return d.toISOString().slice(0, 10)
}
function formatDate(date, weekday = true) {
  return new Intl.DateTimeFormat('cs-CZ', weekday ? { weekday: 'short', day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
}
function intervalForShift(s) {
  const start = new Date(`${s.date}T${s.start || '00:00'}:00`).getTime()
  let end = new Date(`${s.date}T${s.end || '00:00'}:00`).getTime()
  if (minutes(s.end) <= minutes(s.start)) end += 24 * 60 * 60 * 1000
  return [start, end]
}
function overlapsShift(a, b) {
  const [a1, a2] = intervalForShift(a)
  const [b1, b2] = intervalForShift(b)
  return a1 < b2 && b1 < a2
}
function dateInRange(date, from, to) { return date >= from && date <= to }
function weekdayOf(date) { return new Date(date + 'T12:00:00').getDay() }
function overlapsTimeWindow(startA, endA, startB, endB) {
  const a = { date: todayISO(), start: startA, end: endA }
  const b = { date: todayISO(), start: startB, end: endB }
  return overlapsShift(a, b)
}
function isPastLocked(shift) {
  if (!shift?.date) return false
  return shift.date < todayISO()
}
function confirmPastChange(shift) {
  return !isPastLocked(shift) || confirm('Tahle směna je v minulosti. Opravdu ji chceš upravit?')
}
function actualDurationMinutes(shift) {
  if (!shift.actualStartAt || !shift.actualEndAt) return null
  const start = new Date(shift.actualStartAt).getTime()
  const end = new Date(shift.actualEndAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return Math.round((end - start) / 60000)
}
function durationLabel(minutesTotal) {
  if (minutesTotal == null) return '—'
  const h = Math.floor(minutesTotal / 60)
  const m = minutesTotal % 60
  return h + ' h ' + m + ' min'
}

function plannedDurationMinutes(shift) {
  const [start, end] = intervalForShift(shift)
  return Math.max(0, Math.round((end - start) / 60000))
}
function hoursLabel(minutesTotal) {
  if (minutesTotal == null) return '—'
  return (minutesTotal / 60).toLocaleString('cs-CZ', { maximumFractionDigits: 1 }) + ' h'
}
function weekShifts(data, weekStart) {
  return sortByDateTime((data.shifts || []).filter((s) => s.date >= weekStart && s.date <= addDays(weekStart, 6)))
}
function readinessChecks(data, helpers, weekStart = startOfWeek(todayISO())) {
  const week = weekShifts(data, weekStart)
  const activeWeek = week.filter((s) => !['cancelled', 'declined'].includes(s.status))
  const conflicts = activeWeek.flatMap((s) => helpers.conflictMessages(s).map((message) => ({ shift: s, message })))
  const gaps = coverageGaps(data, weekStart)
  const pendingSwaps = (data.swapRequests || []).filter((r) => ['pending','accepted'].includes(r.status))
  const waiting = week.filter((s) => ['draft', 'assigned'].includes(s.status))
  const declined = week.filter((s) => s.status === 'declined')
  const runningOld = (data.shifts || []).filter((s) => s.actualStartAt && !s.actualEndAt && s.date < todayISO())
  const checks = [
    { key: 'drivers', label: 'Řidiči vyplnění', ok: data.drivers.some((d) => d.active), detail: `${data.drivers.filter((d) => d.active).length} aktivních řidičů` },
    { key: 'vehicles', label: 'Auta vyplněná', ok: data.vehicles.some((v) => v.active), detail: `${data.vehicles.filter((v) => v.active).length} aktivních aut` },
    { key: 'availability', label: 'Dostupnost zadaná', ok: (data.availability || []).length > 0, detail: `${(data.availability || []).length} pravidel dostupnosti` },
    { key: 'planned', label: 'Směny na týden naplánované', ok: week.length > 0, detail: `${week.length} směn v týdnu` },
    { key: 'conflicts', label: 'Žádné kolize', ok: conflicts.length === 0, detail: conflicts.length ? `${conflicts.length} kolizí` : 'Bez kolizí' },
    { key: 'coverage', label: 'Neobsazené směny vyřešené', ok: gaps.length === 0, detail: gaps.length ? `${gaps.length} děr v pokrytí` : 'Pokrytí OK' },
    { key: 'confirmed', label: 'Všichni řidiči potvrzeni', ok: waiting.length === 0, detail: waiting.length ? `${waiting.length} čeká na reakci` : 'Vše potvrzeno / hotovo' },
    { key: 'declined', label: 'Odmítnuté směny vyřešené', ok: declined.length === 0, detail: declined.length ? `${declined.length} odmítnuto` : 'Bez odmítnutí' },
    { key: 'swaps', label: 'Žádné čekající výměny', ok: pendingSwaps.length === 0, detail: pendingSwaps.length ? `${pendingSwaps.length} žádostí` : 'Bez žádostí' },
    { key: 'attendance', label: 'Nedořešená docházka', ok: runningOld.length === 0, detail: runningOld.length ? `${runningOld.length} starších běžících směn` : 'Docházka OK' },
  ]
  return { checks, conflicts, gaps, pendingSwaps, waiting, declined, runningOld, week, activeWeek }
}
function attendanceRows(data, helpers, from, to) {
  const rows = data.drivers.map((driver) => {
    const shifts = (data.shifts || []).filter((s) => s.driverId === driver.id && s.date >= from && s.date <= to)
    const plannedMinutes = shifts.reduce((sum, s) => sum + plannedDurationMinutes(s), 0)
    const actualMinutes = shifts.reduce((sum, s) => sum + (actualDurationMinutes(s) || 0), 0)
    const completed = shifts.filter((s) => s.status === 'completed').length
    const open = shifts.filter((s) => s.actualStartAt && !s.actualEndAt).length
    return { driver, shifts, plannedMinutes, actualMinutes, diffMinutes: actualMinutes - plannedMinutes, completed, open }
  })
  return rows.filter((row) => row.shifts.length || row.driver.active)
}
function exportAttendanceCSV(data, helpers, from, to) {
  const rows = [['Řidič','Směn','Dokončeno','Plán minut','Reál minut','Rozdíl minut','Otevřené směny']]
  attendanceRows(data, helpers, from, to).forEach((row) => rows.push([row.driver.name, row.shifts.length, row.completed, row.plannedMinutes, row.actualMinutes, row.diffMinutes, row.open]))
  const csv = rows.map((r) => r.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';')).join('\n')
  download(`rbshift-dochazka-${from}-${to}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8')
}
function readinessText(data, helpers, weekStart) {
  const r = readinessChecks(data, helpers, weekStart)
  const ok = r.checks.filter((c) => c.ok).length
  const lines = [`RBSHIFT – audit týdne ${formatDate(weekStart)} až ${formatDate(addDays(weekStart, 6))}`, '', `Připravenost: ${ok}/${r.checks.length}`, '']
  r.checks.forEach((c) => lines.push(`${c.ok ? 'OK' : 'ŘEŠIT'} · ${c.label}: ${c.detail}`))
  if (r.gaps.length) {
    lines.push('', 'Chybí obsazení:')
    r.gaps.slice(0, 20).forEach((g) => lines.push(`${formatDate(g.day)} ${g.name} ${g.start}–${g.end}: chybí ${g.missing}`))
  }
  if (r.conflicts.length) {
    lines.push('', 'Kolize:')
    r.conflicts.slice(0, 20).forEach((c) => lines.push(`${c.shift.date} ${c.shift.start}–${c.shift.end}: ${c.message}`))
  }
  return lines.join('\n')
}
function localStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}
function coverageGaps(data, weekStart = startOfWeek(todayISO())) {
  const slots = data.settings?.coverageSlots || []
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const active = data.shifts.filter((s) => !['cancelled', 'declined'].includes(s.status))
  return days.flatMap((day) => slots.map((slot) => {
    const planned = active.filter((s) => s.date === day && overlapsTimeWindow(s.start, s.end, slot.start, slot.end)).length
    return { day, ...slot, planned, missing: Math.max(0, Number(slot.minDrivers || 0) - planned) }
  })).filter((x) => x.missing > 0)
}
function safeDelete(label) {
  return prompt(`Pro potvrzení smazání napiš: SMAZAT\n${label || ''}`) === 'SMAZAT'
}
function todayRangeTitle() { return new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(`${todayISO()}T12:00:00`)) }
function statusCounts(shifts) {
  return shifts.reduce((acc, s) => ({ ...acc, [s.status]: (acc[s.status] || 0) + 1 }), {})
}
function sortByDateTime(list) { return [...list].sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`)) }
function download(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    alert('Text je zkopírovaný. Můžeš ho vložit třeba do WhatsAppu.')
  } catch {
    prompt('Zkopíruj text ručně:', text)
  }
}

const css = `
:root{--bg:#07101d;--panel:#0d1828;--panel2:#111f33;--muted:#91a4bd;--text:#eef5ff;--line:rgba(255,255,255,.11);--gold:#f5c76a;--gold2:#b88936;--good:#48d597;--warn:#ffcf5a;--bad:#ff6b6b;--blue:#80c7ff;--shadow:0 24px 80px rgba(0,0,0,.42)}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top left,rgba(245,199,106,.16),transparent 32%),radial-gradient(circle at bottom right,rgba(128,199,255,.08),transparent 28%),linear-gradient(135deg,#06101d,#0b1320 48%,#101a2c);color:var(--text);font-family:Inter,Roboto,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}button,input,select,textarea{font:inherit}button{cursor:pointer}a{color:inherit}.app{min-height:100vh;display:grid;grid-template-columns:286px 1fr}.sidebar{position:sticky;top:0;height:100vh;padding:22px;border-right:1px solid var(--line);background:rgba(8,17,31,.80);backdrop-filter:blur(18px);overflow:auto}.brand{display:flex;align-items:center;gap:12px;margin-bottom:20px}.logo{width:46px;height:46px;border-radius:16px;background:linear-gradient(135deg,var(--gold),var(--gold2));color:#07101d;display:grid;place-items:center;font-weight:950;box-shadow:0 12px 34px rgba(245,199,106,.22)}.brand h1{font-size:18px;line-height:1.05;margin:0}.brand small,.muted{color:var(--muted)}.sidebox{margin-top:14px;padding:14px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.04)}.sidebox label,.field label{display:block;color:var(--muted);font-size:12px;margin-bottom:6px;font-weight:800}.sidebox select{width:100%}.nav{display:grid;gap:8px;margin-top:16px}.nav button,.ghost,.primary,.danger{border:1px solid var(--line);border-radius:16px;padding:12px 14px;color:var(--text);background:rgba(255,255,255,.045);transition:.18s ease;text-decoration:none}.nav button{text-align:left}.nav button:hover,.ghost:hover{border-color:rgba(245,199,106,.55);transform:translateY(-1px)}.nav button.active{background:linear-gradient(135deg,rgba(245,199,106,.22),rgba(184,137,54,.10));border-color:rgba(245,199,106,.55)}.primary{background:linear-gradient(135deg,var(--gold),var(--gold2));color:#07101d;border-color:rgba(245,199,106,.75);font-weight:900}.danger{background:rgba(255,107,107,.12);border-color:rgba(255,107,107,.45);color:#ffd7d7}.main{padding:24px;min-width:0}.topbar{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:18px}.topbar h2{margin:0;font-size:clamp(27px,4vw,43px);letter-spacing:-.045em}.topbar p{margin:6px 0 0;color:var(--muted)}.actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}.grid{display:grid;gap:16px}.kpis{grid-template-columns:repeat(4,minmax(0,1fr))}.two{grid-template-columns:1.15fr .85fr}.three{grid-template-columns:repeat(3,minmax(0,1fr))}.four{grid-template-columns:repeat(4,minmax(0,1fr))}.card{border:1px solid var(--line);border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.035));box-shadow:var(--shadow);padding:18px;min-width:0}.kpi .label{color:var(--muted);font-size:13px}.kpi .value{font-size:30px;font-weight:950;letter-spacing:-.04em;margin-top:6px}.kpi .hint{font-size:12px;color:var(--muted);margin-top:5px}.section-title{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:0 0 12px}.section-title h3{margin:0;font-size:18px}.pill{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:rgba(255,255,255,.06);border-radius:999px;padding:6px 10px;font-size:12px;color:var(--muted);white-space:nowrap}.pill.good{color:#d8fff0;border-color:rgba(72,213,151,.45);background:rgba(72,213,151,.12)}.pill.warn{color:#fff3c7;border-color:rgba(255,207,90,.45);background:rgba(255,207,90,.12)}.pill.bad{color:#ffdede;border-color:rgba(255,107,107,.45);background:rgba(255,107,107,.12)}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:18px}.table{width:100%;border-collapse:collapse;min-width:840px}.table th,.table td{padding:12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.table th{font-size:12px;color:var(--muted);font-weight:800;background:rgba(255,255,255,.035);position:sticky;top:0}.table tr:last-child td{border-bottom:none}.table small{color:var(--muted)}.row-actions{display:flex;gap:8px;flex-wrap:wrap}.row-actions button{padding:8px 10px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.05);color:var(--text)}.row-actions button.danger-mini{border-color:rgba(255,107,107,.42);color:#ffd7d7}.form{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.form.two-col{grid-template-columns:repeat(2,minmax(0,1fr))}.field{display:grid;gap:6px}.field.span2{grid-column:span 2}.field.span3{grid-column:span 3}.field.span4{grid-column:1/-1}.field input,.field select,.field textarea,.searchbox{width:100%;border:1px solid var(--line);border-radius:14px;background:rgba(4,10,20,.65);color:var(--text);padding:12px;outline:none}.field textarea{min-height:88px;resize:vertical}.field input:focus,.field select:focus,.field textarea:focus,.searchbox:focus{border-color:rgba(245,199,106,.65);box-shadow:0 0 0 4px rgba(245,199,106,.10)}.split{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.stack{display:grid;gap:12px}.log,.alert{border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.04);padding:12px}.alert.bad{border-color:rgba(255,107,107,.42);background:rgba(255,107,107,.10)}.alert.warn{border-color:rgba(255,207,90,.42);background:rgba(255,207,90,.10)}.alert.good{border-color:rgba(72,213,151,.42);background:rgba(72,213,151,.10)}.empty{border:1px dashed rgba(255,255,255,.18);border-radius:18px;padding:22px;text-align:center;color:var(--muted)}.week-grid{display:grid;grid-template-columns:repeat(7,minmax(190px,1fr));gap:12px;overflow:auto;padding-bottom:6px}.day{min-height:240px;border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.045);padding:12px}.day.today{border-color:rgba(245,199,106,.65);box-shadow:0 0 0 3px rgba(245,199,106,.08)}.day h4{margin:0 0 10px;display:flex;justify-content:space-between;gap:8px;align-items:center}.shift-card{display:grid;gap:6px;border-left:3px solid var(--gold);background:rgba(0,0,0,.18);border-radius:14px;padding:10px;margin-bottom:9px;font-size:13px}.shift-card.badline{border-left-color:var(--bad)}.shift-card.goodline{border-left-color:var(--good)}.shift-card .mini-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:3px}.shift-card .mini-actions button{font-size:12px;padding:6px 8px;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.05);color:var(--text)}.drawer-grid{display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:16px;align-items:start}.sticky-card{position:sticky;top:18px}.tabs{display:flex;gap:8px;flex-wrap:wrap}.tabs button{border:1px solid var(--line);border-radius:999px;padding:9px 12px;background:rgba(255,255,255,.04);color:var(--muted)}.tabs button.active{background:rgba(245,199,106,.16);border-color:rgba(245,199,106,.50);color:var(--text)}.driver-view{max-width:980px}.whatsapp-text{white-space:pre-wrap;background:rgba(0,0,0,.19);border:1px solid var(--line);border-radius:16px;padding:12px;max-height:280px;overflow:auto;color:#dbeafe}.hintline{font-size:12px;color:var(--muted);margin-top:6px}.swap-history{display:grid;gap:4px;margin-top:8px;padding:8px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.035)}

.status-strip{display:flex;gap:8px;flex-wrap:wrap}.status-dot{width:9px;height:9px;border-radius:999px;background:var(--muted);display:inline-block}.status-dot.good{background:var(--good)}.status-dot.warn{background:var(--warn)}.status-dot.bad{background:var(--bad)}.toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}.toolbar .searchbox{max-width:260px}.quick-list{display:grid;gap:10px}.quick-item{padding:12px;border-radius:16px;border:1px solid var(--line);background:rgba(0,0,0,.16);display:flex;justify-content:space-between;gap:10px;align-items:center}.quick-item strong{display:block}.quick-item small{color:var(--muted)}.detail-panel{border:1px solid rgba(245,199,106,.34);background:linear-gradient(180deg,rgba(245,199,106,.12),rgba(255,255,255,.04));}.mobile-day-head{display:none}.copybox{white-space:pre-wrap;border:1px solid var(--line);border-radius:16px;background:rgba(0,0,0,.20);padding:12px;color:#dbeafe;max-height:260px;overflow:auto}.danger-mini-text{color:#ffd7d7}.planner-filter{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:14px}.shift-card.status-draft,.shift-card.status-assigned{background:linear-gradient(135deg,rgba(255,207,90,.13),rgba(0,0,0,.14))}.shift-card.status-confirmed,.shift-card.status-completed{background:linear-gradient(135deg,rgba(72,213,151,.12),rgba(0,0,0,.15))}.shift-card.status-declined,.shift-card.status-cancelled{background:linear-gradient(135deg,rgba(255,107,107,.13),rgba(0,0,0,.15))}.highlight-note{display:block;padding:8px 10px;border:1px solid rgba(72,213,151,.35);border-radius:12px;background:rgba(72,213,151,.10);color:#d8ffee}.compact-shift{gap:8px}.shift-summary{width:100%;border:0;background:transparent;color:var(--text);padding:0;display:flex;justify-content:space-between;align-items:center;gap:10px;text-align:left}.shift-summary-main{display:grid;gap:2px}.shift-summary-main b{font-size:14px}.shift-summary-main span{font-weight:800}.shift-summary-side{display:flex;flex-direction:column;align-items:flex-end;gap:5px}.shift-summary-side small{font-size:11px;color:var(--muted)}.compact-flags{display:flex;gap:6px;flex-wrap:wrap}.compact-shift.is-open{background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(0,0,0,.16))}.card-soft{border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.04);padding:14px;margin-top:12px}


.driver-mobile-view{max-width:980px}.driver-status-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}.driver-hero{margin-bottom:16px;border-color:rgba(245,199,106,.55);background:linear-gradient(180deg,rgba(245,199,106,.18),rgba(255,255,255,.045));}.driver-shift-card{display:grid;gap:12px}.driver-shift-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.driver-shift-head h3{font-size:clamp(28px,6vw,46px);line-height:1;margin:4px 0 6px;letter-spacing:-.045em}.driver-date{display:inline-flex;color:#fff3c7;font-weight:900;font-size:13px;letter-spacing:.02em}.driver-instruction{border:1px solid rgba(72,213,151,.42);background:rgba(72,213,151,.11);border-radius:18px;padding:14px;color:#eafff6}.driver-note{margin:0}.driver-mini-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.driver-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px}.driver-actions button{min-height:52px}.driver-actions .soft-primary{background:linear-gradient(135deg,#d8fff0,#48d597);border-color:rgba(72,213,151,.72)}.driver-actions-compact{grid-template-columns:repeat(2,minmax(0,1fr))}.driver-push-warning{margin-bottom:16px}.driver-card-list{display:grid;gap:14px}.driver-list-title{margin-top:18px}.driver-offers{margin-bottom:16px}.device-list{display:grid;gap:8px;margin-top:12px}.device-row{display:flex;justify-content:space-between;gap:10px;align-items:center;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.035);padding:10px}.ios-guide{margin-top:12px;border:1px solid rgba(128,199,255,.32);background:rgba(128,199,255,.08);border-radius:16px;padding:12px}.ios-guide ol{margin:8px 0 0 20px;padding:0}.ios-guide li{margin:4px 0;color:#dbeafe}

.auth-shell{min-height:100vh;display:grid;place-items:center;padding:22px}.auth-card{width:min(520px,100%)}code{background:rgba(0,0,0,.25);padding:2px 5px;border-radius:6px}

@media (max-width:1150px){.drawer-grid{grid-template-columns:1fr}.sticky-card{position:relative;top:auto}.kpis,.two,.three,.four{grid-template-columns:1fr}.week-grid{grid-template-columns:repeat(7,minmax(210px,1fr))}}
@media (max-width:1000px){.app{grid-template-columns:1fr}.sidebar{position:relative;height:auto}.main{padding:16px}.nav{grid-template-columns:repeat(3,minmax(0,1fr))}.nav button{text-align:center}.topbar{display:grid}.actions{justify-content:flex-start}.form,.form.two-col{grid-template-columns:1fr}.field.span2,.field.span3,.field.span4{grid-column:auto}.table{min-width:760px}}
@media (max-width:640px){.sidebar{padding:14px}.nav{grid-template-columns:repeat(2,minmax(0,1fr))}.nav button{padding:10px}.brand h1{font-size:16px}.card{border-radius:20px;padding:14px}.topbar h2{font-size:28px}.kpi .value{font-size:26px}.row-actions button,.ghost,.primary,.danger{width:100%;justify-content:center;text-align:center}.actions{width:100%}.week-grid{grid-template-columns:1fr}.day{min-height:auto}.hide-mobile{display:none}.mobile-day-head{display:block;color:var(--muted);font-size:12px}.planner-filter{grid-template-columns:1fr}.toolbar .searchbox{max-width:none}.quick-item{display:grid}}
`
function installStyles() {
  if (document.getElementById('rbshift-style')) return
  const style = document.createElement('style')
  style.id = 'rbshift-style'
  style.textContent = css
  document.head.appendChild(style)
}

function useAppData(session, profile) {
  const online = Boolean(isConfiguredSupabase && session?.user && profile)
  const [data, setData] = useState(readStore)
  const [syncState, setSyncState] = useState({ loading: online, saving: false, error: '', lastSyncAt: '' })

  const reloadOnline = async (silent = false) => {
    if (!online) return
    if (!silent) setSyncState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const loaded = await loadDataFromSupabase()
      setData(loaded)
      writeStore(loaded)
      setSyncState((s) => ({ ...s, loading: false, saving: false, error: '', lastSyncAt: new Date().toISOString() }))
    } catch (err) {
      setSyncState((s) => ({ ...s, loading: false, error: err.message || String(err) }))
    }
  }

  useEffect(() => { if (!online) writeStore(data) }, [data, online])
  useEffect(() => { reloadOnline() }, [online, session?.user?.id])
  useEffect(() => {
    if (!online || !supabase) return
    let timer = null
    const reloadSoon = () => {
      clearTimeout(timer)
      timer = setTimeout(() => reloadOnline(true), 450)
    }
    const realtimeTables = ['drivers', 'vehicles', 'shifts', 'absences', 'availability', 'service_blocks', 'swap_requests', 'notifications', 'push_subscriptions', 'audit_logs', 'app_settings']
    const ch = supabase.channel(`rbshift-live-${session?.user?.id || 'user'}`)
    realtimeTables.forEach((table) => {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, reloadSoon)
    })
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') reloadSoon()
    })
    const poll = setInterval(() => reloadOnline(true), 8000)
    return () => { clearTimeout(timer); clearInterval(poll); supabase.removeChannel(ch) }
  }, [online, session?.user?.id])

  const commit = (updater, text) => {
    setData((prev) => {
      const rawNext = typeof updater === 'function' ? updater(prev) : updater
      const audit = text ? [{ id: uid('log'), at: new Date().toISOString(), text }, ...(rawNext.audit || [])].slice(0, 250) : rawNext.audit
      const next = { ...rawNext, audit }
      writeStore(next)
      if (online) {
        setSyncState((s) => ({ ...s, saving: true, error: '' }))
        const pushNotices = addedRows(prev.notifications, next.notifications)
        syncChangedRows(prev, next, profile)
          .then(() => {
            setSyncState({ loading: false, saving: false, error: '', lastSyncAt: new Date().toISOString() })
            sendPushForNotifications(pushNotices)
          })
          .catch((err) => setSyncState((s) => ({ ...s, saving: false, error: err.message || String(err) })))
      }
      return next
    })
  }
  return [data, commit, syncState, reloadOnline]
}

function buildHelpers(data) {
  const driver = (id) => data.drivers.find((d) => d.id === id)
  const vehicle = (id) => data.vehicles.find((v) => v.id === id)
  const driverName = (id) => driver(id)?.name || 'Neobsazeno'
  const vehicleName = (id) => {
    const car = vehicle(id)
    return car ? `${car.name} · ${car.plate}` : 'Bez vozu'
  }
  const conflictMessages = (shift) => {
    if (!shift || ['cancelled', 'declined'].includes(shift.status)) return []
    const conflicts = []
    const d = driver(shift.driverId)
    const v = vehicle(shift.vehicleId)
    if (!shift.date || !shift.start || !shift.end) conflicts.push('Chybí datum nebo čas směny.')
    if (!d && shift.status !== 'open') conflicts.push('Není vybraný řidič.')
    if (!v && shift.status !== 'open') conflicts.push('Není vybrané vozidlo.')
    if (d && !d.active) conflicts.push(`Řidič ${d.name} je neaktivní.`)
    if (v && !v.active) conflicts.push(`Vozidlo ${v.name} je neaktivní.`)
    data.shifts.forEach((other) => {
      if (other.id === shift.id || ['cancelled', 'declined'].includes(other.status)) return
      if (!shift.date || !other.date || !shift.start || !shift.end || !other.start || !other.end) return
      if (shift.driverId && other.driverId === shift.driverId && overlapsShift(shift, other)) conflicts.push(`Řidič ${driverName(shift.driverId)} má ve stejném čase jinou směnu.`)
      if (shift.vehicleId && other.vehicleId === shift.vehicleId && overlapsShift(shift, other)) conflicts.push(`Vozidlo ${vehicleName(shift.vehicleId)} je ve stejném čase v jiné směně.`)
    })
    if (shift.driverId) data.absences.forEach((a) => {
      if (a.driverId === shift.driverId && dateInRange(shift.date, a.from, a.to)) conflicts.push(`Řidič ${driverName(shift.driverId)} má nepřítomnost: ${a.reason || 'bez důvodu'}.`)
    })
    if (shift.vehicleId) data.serviceBlocks.forEach((s) => {
      if (s.vehicleId === shift.vehicleId && dateInRange(shift.date, s.from, s.to)) conflicts.push(`Vozidlo ${vehicleName(shift.vehicleId)} je blokované: ${s.reason || 'servis'}.`)
    })
    const availability = shift.driverId ? (data.availability || []).filter((a) => a.driverId === shift.driverId && Number(a.weekday) === weekdayOf(shift.date)) : []
    if (availability.length && !availability.some((a) => overlapsTimeWindow(shift.start, shift.end, a.start, a.end))) {
      conflicts.push(`Řidič ${driverName(shift.driverId)} nemá v tomto čase zadanou dostupnost.`)
    }
    return [...new Set(conflicts)]
  }
  const statusClass = (status) => status === 'confirmed' || status === 'completed' ? 'good' : status === 'declined' || status === 'cancelled' ? 'bad' : 'warn'
  return { driver, vehicle, driverName, vehicleName, conflictMessages, statusClass }
}

function App({ session = null, profile = null, signOut = null }) {
  installStyles()
  const onlineMode = Boolean(isConfiguredSupabase && session?.user && profile)
  const [data, commit, syncState, reloadOnline] = useAppData(session, profile)
  const helpers = useMemo(() => buildHelpers(data), [data])
  const [page, setPage] = useState('planner')
  const [role, setRole] = useState(() => profile?.role || 'admin')
  const ownDriver = onlineMode ? data.drivers.find((d) => d.profileId === session.user.id || (d.email && d.email.toLowerCase() === session.user.email?.toLowerCase())) : null
  const [currentDriverId, setCurrentDriverId] = useState(ownDriver?.id || data.drivers[0]?.id || '')
  useEffect(() => { if (profile?.role) setRole(profile.role) }, [profile?.role])
  useEffect(() => { if (onlineMode && profile?.role === 'driver' && ownDriver?.id) setCurrentDriverId(ownDriver.id) }, [onlineMode, profile?.role, ownDriver?.id])
  const isDriver = role === 'driver'
  const currentDriver = onlineMode && isDriver ? ownDriver : (data.drivers.find((d) => d.id === currentDriverId) || data.drivers[0])

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => null)
  }, [])
  useEffect(() => {
    if (isDriver && !['driver', 'notifications', 'availability'].includes(page)) setPage('driver')
    if (!isDriver && page === 'driver') setPage('planner')
    if (role === 'dispatcher' && page === 'settings') setPage('planner')
  }, [isDriver, page])

  const nav = isDriver
    ? [['driver', 'Moje směny'], ['notifications', 'Notifikace'], ['availability', 'Dostupnost']]
    : role === 'dispatcher'
      ? [['planner', 'Týdenní plán'], ['dashboard', 'Dashboard'], ['audit', 'Audit provozu'], ['notifications', 'Notifikace'], ['shifts', 'Seznam směn'], ['drivers', 'Řidiči'], ['vehicles', 'Vozidla'], ['availability', 'Dostupnost'], ['history', 'Historie']]
      : [['planner', 'Týdenní plán'], ['dashboard', 'Dashboard'], ['audit', 'Audit provozu'], ['notifications', 'Notifikace'], ['shifts', 'Seznam směn'], ['drivers', 'Řidiči'], ['vehicles', 'Vozidla'], ['availability', 'Dostupnost'], ['history', 'Historie'], ['settings', 'Nastavení']]

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><div className="logo">RB</div><div><h1>{data.settings?.companyName || 'RBSHIFT'}</h1><small>Taxi směny · v{VERSION}</small></div></div>
      <div className="sidebox"><label>Role aplikace</label>{onlineMode ? <div className="pill good">{roleMap[role] || role}</div> : <select value={role} onChange={(e) => setRole(e.target.value)}>{Object.entries(roleMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</div>
      {isDriver && <div className="sidebox"><label>Aktuální řidič</label>{onlineMode ? <div className="pill">{currentDriver?.name || 'Profil řidiče není propojený'}</div> : <select value={currentDriver?.id || ''} onChange={(e) => setCurrentDriverId(e.target.value)}>{data.drivers.filter((d) => d.active).map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select>}{onlineMode && !currentDriver?.id && <p className="hintline">V administraci propoj řidiče přes e-mail nebo profile_id.</p>}</div>}
      <div className="sidebox"><div className="split"><span className="muted">Nepřečtené notifikace</span><span className={(data.notifications || []).filter((n) => isNoticeVisible(n, currentDriver, isDriver) && !isNoticeRead(n, currentDriver, isDriver)).length ? 'pill warn' : 'pill good'}>{(data.notifications || []).filter((n) => isNoticeVisible(n, currentDriver, isDriver) && !isNoticeRead(n, currentDriver, isDriver)).length}</span></div></div>
      <nav className="nav">{nav.map(([key, label]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => setPage(key)}>{label}</button>)}</nav>
      <div className="sidebox">
        <div className="split"><span className="muted">Uložiště</span><span className={onlineMode ? 'pill good' : 'pill warn'}>{onlineMode ? 'Supabase online' : 'Demo / localStorage'}</span></div>
        {onlineMode ? <p className="muted" style={{ marginBottom: 0 }}>{syncState?.saving ? 'Ukládám změny…' : syncState?.lastSyncAt ? `Synchronizováno ${new Date(syncState.lastSyncAt).toLocaleTimeString('cs-CZ')}` : 'Online režim aktivní.'}</p> : <p className="muted" style={{ marginBottom: 0 }}>Lokální demo. Po vyplnění .env a přihlášení poběží ostrý online režim.</p>}
        {syncState?.error && <p className="hintline danger-mini-text">{syncState.error}</p>}
        {onlineMode && <div className="row-actions" style={{ marginTop: 10 }}><button onClick={reloadOnline}>Načíst z DB</button><button onClick={signOut}>Odhlásit</button></div>}
      </div>
    </aside>
    <main className="main">
      {page === 'planner' && <Planner data={data} helpers={helpers} commit={commit} />}
      {page === 'dashboard' && <Dashboard data={data} helpers={helpers} commit={commit} />}
      {page === 'audit' && <OperationalAudit data={data} helpers={helpers} commit={commit} />}
      {page === 'notifications' && <NotificationsView data={data} helpers={helpers} commit={commit} currentDriver={currentDriver} isDriver={isDriver} profile={profile} />}
      {page === 'shifts' && <ShiftsList data={data} helpers={helpers} commit={commit} />}
      {page === 'drivers' && <Drivers data={data} commit={commit} />}
      {page === 'vehicles' && <Vehicles data={data} commit={commit} />}
      {page === 'availability' && <Availability data={data} commit={commit} currentDriver={isDriver ? currentDriver : null} />}
      {page === 'history' && <History data={data} />}
      {page === 'settings' && <Settings data={data} commit={commit} supabase={supabase} onlineMode={onlineMode} reloadOnline={reloadOnline} profile={profile} />}
      {page === 'driver' && <DriverHome data={data} helpers={helpers} commit={commit} currentDriver={currentDriver} />}
    </main>
  </div>
}

function PageTitle({ title, subtitle, children }) { return <div className="topbar"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{children && <div className="actions">{children}</div>}</div> }
function Kpi({ label, value, hint, kind = '' }) { return <div className="card kpi"><div className="label">{label}</div><div className="value">{value}</div>{hint && <div className={`hint ${kind}`}>{hint}</div>}</div> }
function StatusPill({ status, helpers }) { return <span className={`pill ${helpers.statusClass(status)}`}>{statusMap[status] || status}</span> }
function Field({ label, children, className = '' }) { return <div className={`field ${className}`}><label>{label}</label>{children}</div> }
function Select({ value, onChange, options }) { return <select value={value} onChange={(e) => onChange(e.target.value)}>{Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select> }
function ConflictBox({ messages }) { return <div className="stack">{messages?.length ? messages.map((m, i) => <div key={i} className="alert bad">{m}</div>) : <div className="alert good">Bez kolize.</div>}</div> }

const blankShift = (date = todayISO()) => ({ date, start: '08:00', end: '16:00', driverId: '', vehicleId: '', type: 'day', status: 'assigned', note: '', instruction: '', declineReason: '', actualStartAt: '', actualEndAt: '', swapRequestStatus: '' })
function ShiftForm({ data, helpers, commit, initialDate, editing, setEditing }) {
  const [form, setForm] = useState(blankShift(initialDate))
  const [repeat, setRepeat] = useState('none')
  const [template, setTemplate] = useState('custom')
  const [override, setOverride] = useState(false)
  useEffect(() => { if (!editing) setForm((f) => ({ ...f, date: initialDate })) }, [initialDate, editing])
  useEffect(() => { if (editing) { setForm({ ...blankShift(), ...editing }); setRepeat('none'); setTemplate('custom'); setOverride(false) } }, [editing])
  const applyTemplate = (key) => {
    setTemplate(key)
    if (key === 'custom') return
    setForm((prev) => ({ ...prev, ...shiftTemplates[key] }))
  }
  const conflictMessages = helpers.conflictMessages({ id: editing?.id || 'new', ...form })
  const buildRepeats = () => {
    if (editing || repeat === 'none') return [form]
    if (repeat === 'daily7') return Array.from({ length: 7 }, (_, i) => ({ ...form, date: addDays(form.date, i) }))
    if (repeat === 'workweek') return Array.from({ length: 5 }, (_, i) => ({ ...form, date: addDays(startOfWeek(form.date), i) }))
    if (repeat === 'weekend') return [5, 6].map((i) => ({ ...form, date: addDays(startOfWeek(form.date), i) }))
    return [form]
  }
  const submit = (e) => {
    e.preventDefault()
    if (!form.date || !form.start || !form.end) return alert('Vyplň datum a čas směny.')
    const normalizeShiftForm = (item) => ({ ...item, status: !item.driverId ? 'open' : (item.status === 'open' ? 'assigned' : item.status) })
    const normalizedForm = normalizeShiftForm(form)
    if (editing && !confirmPastChange(editing)) return
    if (conflictMessages.length && !override) return alert('Směna má kolizi. Buď ji oprav, nebo zaškrtni uložení i s kolizí.')
    if (editing) {
      const notice = normalizedForm.status === 'open'
        ? makeNotice({ title: 'Volná směna upravena', body: `${normalizedForm.date} ${normalizedForm.start}–${normalizedForm.end}`, targetRole: 'driver_all', type: 'open-shift-change', shiftId: editing.id })
        : makeNotice({ title: 'Změna směny', body: `${normalizedForm.date} ${normalizedForm.start}–${normalizedForm.end}`, targetDriverId: normalizedForm.driverId, type: 'shift-change', shiftId: editing.id })
      commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === editing.id ? { ...s, ...normalizedForm } : s) }, notice), `Upravena směna ${normalizedForm.date} ${normalizedForm.start}–${normalizedForm.end}.`)
    } else {
      const items = buildRepeats().map((item) => ({ id: uid('sh'), ...normalizeShiftForm(item) }))
      const notices = items.map((item) => item.status === 'open'
        ? makeNotice({ title: 'Nová volná směna', body: `${formatDate(item.date)} ${item.start}–${item.end} · můžeš se přihlásit`, targetRole: 'driver_all', type: 'open-shift', shiftId: item.id })
        : makeNotice({ title: 'Nová směna', body: `${item.date} ${item.start}–${item.end}`, targetDriverId: item.driverId, type: 'new-shift', shiftId: item.id }))
      commit((prev) => addNotificationsToData({ ...prev, shifts: [...items, ...prev.shifts] }, notices), `Vytvořeno směn: ${items.length}.`)
    }
    setForm(blankShift(form.date)); setRepeat('none'); setTemplate('custom'); setOverride(false); setEditing(null)
  }
  return <div className="card sticky-card">
    <div className="section-title"><h3>{editing ? 'Upravit směnu' : 'Nová směna'}</h3>{editing && <button className="ghost" onClick={() => { setEditing(null); setForm(blankShift(initialDate)) }}>Zrušit</button>}</div>
    {editing && isPastLocked(editing) && <div className="alert warn" style={{ marginBottom: 12 }}>Minulá směna: úprava bude vyžadovat potvrzení.</div>}
    <form className="form two-col" onSubmit={submit}>
      <Field label="Šablona směny" className="span2"><Select value={template} onChange={applyTemplate} options={shiftTemplateMap} /></Field>
      <Field label="Datum"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
      <Field label="Typ"><Select value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={shiftTypeMap} /></Field>
      <Field label="Začátek"><input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field>
      <Field label="Konec"><input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Field>
      <Field label="Řidič" className="span2"><select value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })}><option value="">Volná směna bez řidiče</option>{data.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{!d.active ? ' · neaktivní' : ''}</option>)}</select></Field>
      <Field label="Vozidlo" className="span2"><select value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}><option value="">Bez vozu / doplnit později</option>{data.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.plate}{!v.active ? ' · neaktivní' : ''}</option>)}</select></Field>
      <Field label="Stav"><Select value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={statusMap} /></Field>
      {!form.driverId && <div className="alert warn span2"><b>Volná směna:</b> bez řidiče se uloží jako nabídka pro všechny aktivní řidiče a odešle se jim notifikace.</div>}
      {!editing && <Field label="Opakování" className="span2"><Select value={repeat} onChange={setRepeat} options={repeatMap} /></Field>}
      <Field label="Poznámka pro plánovač" className="span2"><textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Např. letiště, záloha, firemní akce…" /></Field>
      <Field label="Instrukce pro řidiče" className="span2"><textarea value={form.instruction || ''} onChange={(e) => setForm({ ...form, instruction: e.target.value })} placeholder="Např. auto musí být čisté, bere terminál, SHKM, přesný čas odjezdu…" /></Field>
      {conflictMessages.length > 0 && <label className="field span2" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} style={{ width: 18 }} />Uložit i s kolizí / mimo dostupnost</label>}
      <div className="field span2"><button className="primary" type="submit">{editing ? 'Uložit změny' : 'Vytvořit směnu'}</button></div>
    </form>
    <div style={{ marginTop: 14 }}><ConflictBox messages={conflictMessages} /></div>
  </div>
}

function Planner({ data, helpers, commit }) {
  const [weekStart, setWeekStart] = useState(startOfWeek(todayISO()))
  const [editing, setEditing] = useState(null)
  const [selected, setSelected] = useState(null)
  const [driverFilter, setDriverFilter] = useState('all')
  const [vehicleFilter, setVehicleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const initialShiftDate = weekStart === startOfWeek(todayISO()) ? todayISO() : weekStart
  const weekAll = sortByDateTime(data.shifts.filter((s) => s.date >= weekStart && s.date <= addDays(weekStart, 6)))
  const weekShifts = weekAll.filter((s) => {
    const byDriver = driverFilter === 'all' || s.driverId === driverFilter
    const byVehicle = vehicleFilter === 'all' || s.vehicleId === vehicleFilter
    const byStatus = statusFilter === 'all' || (statusFilter === 'active' ? !['cancelled', 'declined'].includes(s.status) : s.status === statusFilter)
    return byDriver && byVehicle && byStatus
  })
  const conflicts = weekAll.flatMap((s) => helpers.conflictMessages(s).map((message) => ({ shift: s, message })))
  const counts = statusCounts(weekAll)
  const gaps = coverageGaps(data, weekStart)
  const pendingSwaps = (data.swapRequests || []).filter((r) => ['pending','accepted'].includes(r.status))
  const copyWeek = () => {
    const nextItems = weekShifts.map((s) => ({ ...s, id: uid('sh'), date: addDays(s.date, 7), status: 'draft', declineReason: '', actualStartAt: '', actualEndAt: '', swapRequestStatus: '' }))
    if (!nextItems.length) return alert('V tomto týdnu nejsou žádné směny ke kopírování.')
    commit((prev) => ({ ...prev, shifts: [...nextItems, ...prev.shifts] }), `Zkopírován týden na další týden: ${nextItems.length} směn.`)
    setWeekStart(addDays(weekStart, 7))
  }
  const copyToday = (date) => {
    const items = data.shifts.filter((s) => s.date === date).map((s) => ({ ...s, id: uid('sh'), date: addDays(date, 1), status: 'draft', declineReason: '', actualStartAt: '', actualEndAt: '', swapRequestStatus: '' }))
    if (!items.length) return alert('V daném dni nejsou žádné směny.')
    commit((prev) => ({ ...prev, shifts: [...items, ...prev.shifts] }), `Zkopírován den ${date} na další den.`)
  }
  return <>
    <PageTitle title="Týdenní plán směn" subtitle="Online provoz v5.4.1: volné směny, zájemci řidičů, push všem řidičům a mobilní režim.">
      <button className="ghost" onClick={() => setWeekStart(addDays(weekStart, -7))}>← Předchozí</button>
      <button className="ghost" onClick={() => setWeekStart(startOfWeek(todayISO()))}>Dnes</button>
      <button className="ghost" onClick={() => setWeekStart(addDays(weekStart, 7))}>Další →</button>
      <button className="primary" onClick={copyWeek}>Kopírovat týden</button>
      <button className="ghost" onClick={() => copyText(weekText({ ...data, shifts: weekShifts }, helpers, weekStart))}>WhatsApp</button>
    </PageTitle>
    <div className="grid kpis" style={{ marginBottom: 16 }}>
      <Kpi label="Týden" value={`${formatDate(weekStart)}–${formatDate(addDays(weekStart, 6))}`} hint="Zobrazené období" />
      <Kpi label="Směny" value={weekShifts.length} hint={`${counts.confirmed || 0} potvrzeno · ${counts.assigned || 0} čeká`} />
      <Kpi label="Kolize" value={conflicts.length} hint={conflicts.length ? 'Vyžaduje kontrolu' : 'Bez problému'} kind={conflicts.length ? 'bad' : 'good'} />
      <Kpi label="Chybí obsazení" value={gaps.length} hint={gaps.length ? 'Doplň směny' : 'Pokrytí OK'} kind={gaps.length ? 'bad' : 'good'} />
    </div>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section-title"><h3>Rychlé filtry</h3><div className="status-strip"><span className="pill warn">Čeká: {(counts.draft || 0) + (counts.assigned || 0)}</span><span className="pill good">Potvrzeno: {counts.confirmed || 0}</span><span className="pill bad">Odmítnuto: {counts.declined || 0}</span><span className="pill warn">Výměny: {pendingSwaps.length}</span></div></div>
      <div className="planner-filter">
        <select className="searchbox" value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)}><option value="all">Všichni řidiči</option>{data.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select className="searchbox" value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)}><option value="all">Všechna auta</option>{data.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.plate}</option>)}</select>
        <select className="searchbox" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="active">Aktivní bez odmítnutých/zrušených</option><option value="all">Všechny stavy</option>{Object.entries(statusMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
    </div>
    <div className="drawer-grid">
      <div className="grid stack">
        {selected && <ShiftDetail shift={selected} data={data} helpers={helpers} commit={commit} setSelected={setSelected} setEditing={setEditing} />}
        <div className="card">
          <div className="section-title"><h3>Kalendář týdne</h3><span className={conflicts.length ? 'pill bad' : 'pill good'}>{conflicts.length ? `${conflicts.length} kolizí` : 'Bez kolizí'}</span></div>
          <div className="week-grid">
            {days.map((day) => <DayColumn key={day} day={day} shifts={weekShifts} data={data} helpers={helpers} commit={commit} setEditing={setEditing} setSelected={setSelected} copyDay={copyToday} />)}
          </div>
        </div>
      </div>
      <ShiftForm data={data} helpers={helpers} commit={commit} initialDate={initialShiftDate} editing={editing} setEditing={setEditing} />
    </div>
    {gaps.length > 0 && <div className="card" style={{ marginTop: 16 }}><div className="section-title"><h3>Chybí obsazení</h3><span className="pill bad">{gaps.length}</span></div><div className="stack">{gaps.slice(0, 21).map((g) => <div className="alert warn" key={g.day + g.id}><b>{formatDate(g.day)} · {g.name} {g.start}–{g.end}</b><br />Chybí {g.missing} řidič / plánováno {g.planned} z {g.minDrivers}</div>)}</div></div>}
    {conflicts.length > 0 && <div className="card" style={{ marginTop: 16 }}><div className="section-title"><h3>Kolize k řešení</h3><span className="pill bad">{conflicts.length}</span></div><div className="stack">{conflicts.slice(0, 20).map((c, i) => <div className="alert bad" key={i}><b>{c.shift.date} {c.shift.start}–{c.shift.end}</b> · {helpers.driverName(c.shift.driverId)}<br />{c.message}</div>)}</div></div>}
  </>
}
function DayColumn({ day, shifts, data, helpers, commit, setEditing, setSelected, copyDay }) {
  const items = sortByDateTime(shifts.filter((s) => s.date === day))
  return <div className={`day ${day === todayISO() ? 'today' : ''}`}>
    <h4><span>{formatDate(day)}</span><button className="ghost" style={{ padding: '6px 8px', borderRadius: 10 }} onClick={() => copyDay(day)}>kopírovat</button></h4>
    <span className="mobile-day-head">{items.length ? `${items.length} směn` : 'volno'}</span>
    {items.map((s) => <ShiftMini key={s.id} shift={s} helpers={helpers} commit={commit} setEditing={setEditing} setSelected={setSelected} />)}
    {!items.length && <div className="empty" style={{ padding: 14 }}>Bez směn</div>}
  </div>
}
function ShiftMini({ shift, helpers, commit, setEditing, setSelected }) {
  const [open, setOpen] = useState(false)
  const conflicts = helpers.conflictMessages(shift)
  const status = shift.status === 'confirmed' || shift.status === 'completed' ? 'goodline' : conflicts.length ? 'badline' : ''
  const pendingSwap = ['pending','accepted'].includes(shift.swapRequestStatus)
  const setStatus = (id, status, reason = '') => {
    if (!confirmPastChange(shift)) return
    commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === id ? { ...s, status, declineReason: reason } : s) }, statusNoticeForShift({ ...shift, status, declineReason: reason }, status, helpers, reason)), `Změněn stav směny na ${statusMap[status]}.`)
  }
  const checkIn = () => commit((prev) => ({ ...prev, shifts: prev.shifts.map((s) => s.id === shift.id ? { ...s, actualStartAt: s.actualStartAt || localStamp(), status: s.status === 'assigned' ? 'confirmed' : s.status } : s) }), 'Řidič nastoupil na směnu.')
  const checkOut = () => commit((prev) => ({ ...prev, shifts: prev.shifts.map((s) => s.id === shift.id ? { ...s, actualEndAt: s.actualEndAt || localStamp(), status: 'completed' } : s) }), 'Řidič ukončil směnu.')
  const duplicate = () => commit((prev) => ({ ...prev, shifts: [{ ...shift, id: uid('sh'), date: addDays(shift.date, 1), status: 'draft', declineReason: '', actualStartAt: '', actualEndAt: '', swapRequestStatus: '' }, ...prev.shifts] }), 'Duplikována směna na další den.')
  const remove = () => {
    if (!confirmPastChange(shift)) return
    const reason = prompt('Důvod zrušení směny pro řidiče:', 'Zrušeno dispečerem')
    if (reason === null) return
    if (!confirm('Zrušit směnu a poslat řidiči notifikaci?')) return
    commit((prev) => cancelShiftData(prev, shift, helpers, reason || 'Zrušeno dispečerem'), `Zrušena směna ${formatDate(shift.date)} ${shift.start}–${shift.end}.`)
  }
  const hardDelete = () => {
    if (!confirmHardDeleteShift(shift, helpers)) return
    commit((prev) => hardDeleteShiftData(prev, shift), '')
    setOpen(false)
  }
  return <div className={`shift-card compact-shift ${status} status-${shift.status} ${open ? 'is-open' : ''}`}>
    <button type="button" className="shift-summary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
      <span className="shift-summary-main"><b>{shift.start}–{shift.end}</b><span>{helpers.driverName(shift.driverId)}</span></span>
      <span className="shift-summary-side"><StatusPill status={shift.status} helpers={helpers} /><small>{open ? 'Sbalit' : 'Rozbalit'}</small></span>
    </button>
    {(pendingSwap || conflicts.length > 0) && <div className="compact-flags">
      {pendingSwap && <span className="pill warn">žádost o výměnu</span>}
      {conflicts.length > 0 && <span className="pill bad">{conflicts.length} kolize</span>}
    </div>}
    {open && <>
      <small className="muted">Vozidlo: {helpers.vehicleName(shift.vehicleId)}</small>
      <small className="muted">Typ: {shiftTypeMap[shift.type]}</small>
      {shift.note && <small>Poznámka: {shift.note}</small>}
      {shift.instruction && <small className="highlight-note">Instrukce: {shift.instruction}</small>}
      {(shift.actualStartAt || shift.actualEndAt) && <small className="muted">Docházka: {shift.actualStartAt ? new Date(shift.actualStartAt).toLocaleString('cs-CZ') : '—'} → {shift.actualEndAt ? new Date(shift.actualEndAt).toLocaleString('cs-CZ') : 'běží'}</small>}
      {shift.declineReason && <small className="danger-mini-text">Důvod odmítnutí: {shift.declineReason}</small>}
      <div className="mini-actions">
        <button onClick={() => setSelected(shift)}>Detail</button>
        <button onClick={() => confirmPastChange(shift) && setEditing(shift)}>Upravit</button>
        <button onClick={() => setStatus(shift.id, 'confirmed')}>Potvrdit</button>
        <button onClick={checkIn}>Start</button>
        <button onClick={checkOut}>Konec</button>
        <button onClick={() => setStatus(shift.id, 'completed')}>Hotovo</button>
        <button onClick={() => { const reason = prompt('Důvod odmítnutí směny:', shift.declineReason || ''); setStatus(shift.id, 'declined', reason || '') }}>Odmítnout</button>
        <button onClick={duplicate}>+1 den</button>
        <button onClick={remove}>Zrušit</button>
        <button className="danger-mini" onClick={hardDelete}>Smazat</button>
      </div>
    </>}
  </div>
}
function ShiftDetail({ shift, data, helpers, commit, setSelected, setEditing }) {
  const fresh = data.shifts.find((s) => s.id === shift.id) || shift
  const conflicts = helpers.conflictMessages(fresh)
  const swaps = (data.swapRequests || []).filter((r) => r.shiftId === fresh.id)
  const duration = actualDurationMinutes(fresh)
  const setStatus = (status, reason = fresh.declineReason || '') => {
    if (!confirmPastChange(fresh)) return
    commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === fresh.id ? { ...s, status, declineReason: reason } : s) }, statusNoticeForShift({ ...fresh, status, declineReason: reason }, status, helpers, reason)), `Detail směny: stav změněn na ${statusMap[status]}.`)
  }
  const checkIn = () => commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === fresh.id ? { ...s, actualStartAt: s.actualStartAt || localStamp(), status: s.status === 'assigned' ? 'confirmed' : s.status } : s) }, adminNotice('Řidič nastoupil na směnu', `${helpers.driverName(fresh.driverId)} · ${formatDate(fresh.date)} ${fresh.start}–${fresh.end}`, 'attendance-start', fresh.id)), 'V detailu směny zaznamenán nástup.')
  const checkOut = () => commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === fresh.id ? { ...s, actualEndAt: s.actualEndAt || localStamp(), status: 'completed' } : s) }, adminNotice('Řidič ukončil směnu', `${helpers.driverName(fresh.driverId)} · ${formatDate(fresh.date)} ${fresh.start}–${fresh.end}`, 'attendance-end', fresh.id)), 'V detailu směny zaznamenáno ukončení.')
  const hardDelete = () => {
    if (!confirmHardDeleteShift(fresh, helpers)) return
    commit((prev) => hardDeleteShiftData(prev, fresh), '')
    setSelected(null)
  }
  const resolveSwap = (id, status) => {
    const req = swaps.find((r) => r.id === id)
    if (!req) return
    if (status === 'approved') {
      const newDriverId = req.acceptedByDriverId || req.targetDriverId
      if (!newDriverId) return alert('U nabídky všem musí nejdřív některý kolega kliknout „Chci převzít směnu“.')
      const notices = req.targetMode === 'open'
        ? [makeNotice({ title: 'Volná směna schválena a potvrzena', body: `${formatDate(fresh.date)} ${fresh.start}–${fresh.end} · ${helpers.vehicleName(fresh.vehicleId)}. Směna je rovnou potvrzená.`, targetDriverId: newDriverId, type: 'open-shift-approved', shiftId: fresh.id })]
        : [
          makeNotice({ title: 'Výměna směny schválena', body: `${formatDate(fresh.date)} ${fresh.start}–${fresh.end} byla převedena na řidiče ${helpers.driverName(newDriverId)}.`, targetDriverId: req.driverId, type: 'swap-approved', shiftId: fresh.id }),
          makeNotice({ title: 'Převzal jsi směnu – potvrzeno', body: `${formatDate(fresh.date)} ${fresh.start}–${fresh.end} · ${helpers.vehicleName(fresh.vehicleId)}. Směna je rovnou potvrzená.`, targetDriverId: newDriverId, type: 'swap-approved', shiftId: fresh.id }),
        ]
      return commit((prev) => addNotificationsToData({ ...prev, swapRequests: (prev.swapRequests || []).map((r) => r.id === id ? appendSwapHistory({ ...r, status, resolvedAt: new Date().toISOString(), approvedDriverId: newDriverId }, `Admin schválil převzetí pro ${helpers.driverName(newDriverId)}. Směna byla automaticky potvrzena.`) : r), shifts: prev.shifts.map((s) => s.id === fresh.id ? { ...s, driverId: newDriverId, status: 'confirmed', declineReason: '', swapRequestStatus: 'approved' } : s) }, notices), `${req.targetMode === 'open' ? 'Volná směna byla přidělena a potvrzena' : 'Výměna schválena, směna převedena a potvrzena pro'} ${helpers.driverName(newDriverId)}.`)
    }
    const notices = [makeNotice({ title: 'Výměna směny zamítnuta', body: `${formatDate(fresh.date)} ${fresh.start}–${fresh.end}`, targetDriverId: req.driverId, type: 'swap-rejected', shiftId: fresh.id })]
    if (req.acceptedByDriverId) notices.push(makeNotice({ title: 'Výměna nebyla schválena', body: `${formatDate(fresh.date)} ${fresh.start}–${fresh.end}`, targetDriverId: req.acceptedByDriverId, type: 'swap-rejected', shiftId: fresh.id }))
    commit((prev) => addNotificationsToData({ ...prev, swapRequests: (prev.swapRequests || []).map((r) => r.id === id ? appendSwapHistory({ ...r, status, resolvedAt: new Date().toISOString(), rejectedReason: status === 'rejected' ? 'Zamítnuto adminem' : '' }, status === 'rejected' ? 'Admin zamítl výměnu.' : `Stav výměny změněn na ${swapStatusMap[status]}.`) : r), shifts: prev.shifts.map((s) => s.id === fresh.id ? { ...s, swapRequestStatus: status } : s) }, notices), `Žádost o výměnu směny: ${swapStatusMap[status]}.`)
  }
  return <div className="card detail-panel">
    <div className="section-title"><h3>Detail směny</h3><button className="ghost" onClick={() => setSelected(null)}>Zavřít</button></div>
    <div className="grid three">
      <Kpi label="Datum" value={formatDate(fresh.date)} hint={`${fresh.start}–${fresh.end}`} />
      <Kpi label="Řidič" value={helpers.driverName(fresh.driverId)} hint="Přiřazená osoba" />
      <Kpi label="Auto" value={helpers.vehicle(fresh.vehicleId)?.plate || '—'} hint={helpers.vehicle(fresh.vehicleId)?.name || 'Bez vozu'} />
    </div>
    <p className="muted">Typ: {shiftTypeMap[fresh.type]} · Poznámka: {fresh.note || 'bez poznámky'}</p>
    {fresh.instruction && <div className="alert good"><b>Instrukce pro řidiče:</b><br />{fresh.instruction}</div>}
    <div className="grid three" style={{ marginTop: 12 }}>
      <Kpi label="Nástup" value={fresh.actualStartAt ? new Date(fresh.actualStartAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—'} hint={fresh.actualStartAt ? new Date(fresh.actualStartAt).toLocaleDateString('cs-CZ') : 'nezadáno'} />
      <Kpi label="Konec" value={fresh.actualEndAt ? new Date(fresh.actualEndAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—'} hint={fresh.actualEndAt ? new Date(fresh.actualEndAt).toLocaleDateString('cs-CZ') : 'nezadáno'} />
      <Kpi label="Reálný čas" value={durationLabel(duration)} hint="check-in / check-out" />
    </div>
    {fresh.declineReason && <div className="alert bad"><b>Důvod odmítnutí:</b><br />{fresh.declineReason}</div>}
    {swaps.length > 0 && <div className="card-soft"><h4>Žádosti / zájemci</h4><div className="stack">{swaps.map((r) => <div className="alert warn" key={r.id}><b>{r.targetMode === 'open' ? 'Zájem o volnou směnu' : swapStatusMap[r.status]}</b> · {new Date(r.createdAt).toLocaleString('cs-CZ')}<br />Od: {helpers.driverName(r.driverId)} · Komu: {r.targetMode === 'open' ? 'volná směna' : (r.targetMode === 'driver' ? helpers.driverName(r.targetDriverId) : 'všem kolegům')}{r.acceptedByDriverId && <><br />Přijal: <b>{helpers.driverName(r.acceptedByDriverId)}</b></>}{r.approvedDriverId && <><br />Schválený řidič: <b>{helpers.driverName(r.approvedDriverId)}</b></>}{r.rejectedReason && <><br />Důvod zamítnutí: {r.rejectedReason}</>}<br />{r.reason || 'Bez důvodu'}{r.history?.length ? <div className="swap-history">{r.history.map((h, i) => <small key={i}>{new Date(h.at).toLocaleString('cs-CZ')} · {h.text}</small>)}</div> : null}{['pending','accepted'].includes(r.status) && <div className="row-actions" style={{ marginTop: 8 }}><button onClick={() => resolveSwap(r.id, 'approved')}>Schválit a potvrdit</button><button onClick={() => resolveSwap(r.id, 'rejected')}>Zamítnout</button></div>}</div>)}</div></div>}
    <div style={{ marginTop: 12 }}><ConflictBox messages={conflicts} /></div>
    <div className="actions" style={{ marginTop: 14, justifyContent: 'flex-start' }}>
      <button className="primary" onClick={() => setStatus('confirmed')}>Potvrdit</button>
      <button className="ghost" onClick={checkIn}>Nástup</button>
      <button className="ghost" onClick={checkOut}>Ukončit</button>
      <button className="ghost" onClick={() => setStatus('completed')}>Dokončeno</button>
      <button className="danger" onClick={() => { const reason = prompt('Důvod odmítnutí:', fresh.declineReason || ''); setStatus('declined', reason || '') }}>Odmítnout</button>
      <button className="ghost" onClick={() => confirmPastChange(fresh) && setEditing(fresh)}>Upravit</button>
      <button className="ghost" onClick={() => copyText(driverText(data, helpers, fresh.driverId))}>WhatsApp řidič</button>
      <button className="danger" onClick={hardDelete}>Smazat natrvalo</button>
    </div>
  </div>
}

function Dashboard({ data, helpers, commit }) {
  const today = todayISO()
  const tomorrow = addDays(today, 1)
  const todayShifts = sortByDateTime(data.shifts.filter((s) => s.date === today))
  const tomorrowShifts = sortByDateTime(data.shifts.filter((s) => s.date === tomorrow))
  const activeShifts = data.shifts.filter((s) => !['cancelled', 'declined'].includes(s.status))
  const conflicts = activeShifts.flatMap((s) => helpers.conflictMessages(s).map((message) => ({ shift: s, message })))
  const waiting = sortByDateTime(data.shifts.filter((s) => ['assigned', 'draft', 'open'].includes(s.status) && s.date >= today))
  const declined = sortByDateTime(data.shifts.filter((s) => s.status === 'declined' && s.date >= today))
  const carsToday = new Set(todayShifts.filter((s) => !['cancelled', 'declined'].includes(s.status)).map((s) => s.vehicleId))
  const driversToday = new Set(todayShifts.filter((s) => !['cancelled', 'declined'].includes(s.status)).map((s) => s.driverId))
  const freeCars = data.vehicles.filter((v) => v.active && !carsToday.has(v.id))
  const freeDrivers = data.drivers.filter((d) => d.active && !driversToday.has(d.id))
  const gaps = coverageGaps(data, startOfWeek(today))
  const pendingSwaps = (data.swapRequests || []).filter((r) => ['pending','accepted'].includes(r.status))
  const running = todayShifts.filter((s) => s.actualStartAt && !s.actualEndAt)
  return <>
    <PageTitle title="Provozní dashboard" subtitle={`Dnes je ${todayRangeTitle()}. Rychlá kontrola směn, reakcí, aut a problémů.`}>
      <button className="ghost" onClick={() => copyText(dayText(data, helpers, today))}>WhatsApp dnes</button>
      <button className="ghost" onClick={() => exportCSV(data, helpers)}>Export CSV</button>
      <button className="primary" onClick={() => backup(data)}>Záloha JSON</button>
    </PageTitle>
    <div className="grid kpis">
      <Kpi label="Dnešní směny" value={todayShifts.length} hint={`${todayShifts.filter((s) => s.status === 'confirmed').length} potvrzeno · ${todayShifts.filter((s) => s.status === 'completed').length} hotovo`} />
      <Kpi label="Čeká na reakci" value={waiting.length} hint="Budoucí návrh / čeká na potvrzení" />
      <Kpi label="Běží směny" value={running.length} hint="Nástup bez ukončení" kind={running.length ? 'warn' : ''} />
      <Kpi label="Kolize" value={conflicts.length} hint={conflicts.length ? 'Nutná kontrola' : 'Bez zásahu'} kind={conflicts.length ? 'bad' : 'good'} />
      <Kpi label="Výměny / obsazení" value={pendingSwaps.length + gaps.length} hint={`${pendingSwaps.length} výměn · ${gaps.length} děr`} kind={pendingSwaps.length + gaps.length ? 'bad' : 'good'} />
    </div>
    <div className="grid two" style={{ marginTop: 16 }}>
      <div className="card"><div className="section-title"><h3>Dnešní provoz</h3><span className="pill">{formatDate(today)}</span></div><ShiftTable shifts={todayShifts} data={data} helpers={helpers} commit={commit} compact /></div>
      <div className="card"><div className="section-title"><h3>Priorita k řešení</h3><span className={conflicts.length || declined.length ? 'pill bad' : 'pill good'}>{conflicts.length + declined.length}</span></div><div className="stack">
        {conflicts.slice(0, 8).map((item, idx) => <div className="alert bad" key={`c-${idx}`}><b>{item.shift.date} {item.shift.start}–{item.shift.end}</b><br />{item.message}</div>)}
        {declined.slice(0, 5).map((s) => <div className="alert bad" key={s.id}><b>Odmítnuto: {formatDate(s.date)} {s.start}–{s.end}</b><br />{helpers.driverName(s.driverId)} · {s.declineReason || 'bez důvodu'}</div>)}
        {pendingSwaps.slice(0, 5).map((r) => { const sh = data.shifts.find((s) => s.id === r.shiftId); return <div className="alert warn" key={r.id}><b>Žádost o výměnu: {sh ? `${formatDate(sh.date)} ${sh.start}–${sh.end}` : 'směna'}</b><br />{helpers.driverName(r.driverId)} · {r.reason || 'bez důvodu'}</div> })}
        {gaps.slice(0, 5).map((g) => <div className="alert warn" key={g.day + g.id}><b>Chybí obsazení: {formatDate(g.day)} {g.name}</b><br />{g.start}–{g.end} · chybí {g.missing}</div>)}
        {!conflicts.length && !declined.length && !pendingSwaps.length && !gaps.length && <div className="empty">Bez konfliktů, odmítnutých směn a děr v obsazení.</div>}
      </div></div>
    </div>
    <div className="grid three" style={{ marginTop: 16 }}>
      <div className="card"><div className="section-title"><h3>Čeká na potvrzení</h3><span className="pill warn">{waiting.length}</span></div><div className="quick-list">{waiting.slice(0, 8).map((s) => <QuickShift key={s.id} shift={s} helpers={helpers} />)}{!waiting.length && <div className="empty">Nic nečeká.</div>}</div></div>
      <div className="card"><div className="section-title"><h3>Volná auta dnes</h3><span className="pill good">{freeCars.length}</span></div><div className="quick-list">{freeCars.map((v) => <div className="quick-item" key={v.id}><div><strong>{v.name}</strong><small>{v.plate}</small></div><span className="pill good">volné</span></div>)}{!freeCars.length && <div className="empty">Všechna aktivní auta jsou dnes v plánu.</div>}</div></div>
      <div className="card"><div className="section-title"><h3>Volní řidiči dnes</h3><span className="pill good">{freeDrivers.length}</span></div><div className="quick-list">{freeDrivers.map((d) => <div className="quick-item" key={d.id}><div><strong>{d.name}</strong><small>{d.phone || d.email || 'bez kontaktu'}</small></div><span className="pill good">volný</span></div>)}{!freeDrivers.length && <div className="empty">Všichni aktivní řidiči jsou dnes v plánu.</div>}</div></div>
    </div>
    <div className="grid two" style={{ marginTop: 16 }}>
      <div className="card"><div className="section-title"><h3>Zítra</h3><span className="pill">{tomorrowShifts.length} směn</span></div><pre className="copybox">{dayText(data, helpers, tomorrow)}</pre></div>
      <div className="card"><div className="section-title"><h3>Servis / nepřítomnosti</h3><span className="pill warn">{data.serviceBlocks.length + data.absences.length}</span></div><div className="stack">
        {data.serviceBlocks.slice(0, 4).map((s) => <div className="alert warn" key={s.id}>{helpers.vehicleName(s.vehicleId)} · {s.from} až {s.to}<br /><small>{s.reason}</small></div>)}
        {data.absences.slice(0, 4).map((a) => <div className="alert warn" key={a.id}>{helpers.driverName(a.driverId)} · {a.from} až {a.to}<br /><small>{a.reason}</small></div>)}
        {!data.serviceBlocks.length && !data.absences.length && <div className="empty">Bez blokací.</div>}
      </div></div>
    </div>
  </>
}
function QuickShift({ shift, helpers }) {
  return <div className="quick-item"><div><strong>{formatDate(shift.date)} {shift.start}–{shift.end}</strong><small>{helpers.driverName(shift.driverId)} · {helpers.vehicleName(shift.vehicleId)}</small></div><StatusPill status={shift.status} helpers={helpers} /></div>
}

function OperationalAudit({ data, helpers, commit }) {
  const [weekStart, setWeekStart] = useState(startOfWeek(todayISO()))
  const to = addDays(weekStart, 6)
  const audit = readinessChecks(data, helpers, weekStart)
  const passed = audit.checks.filter((c) => c.ok).length
  const readinessPct = Math.round((passed / audit.checks.length) * 100)
  const coverageRows = (data.settings?.coverageSlots || []).flatMap((slot) => Array.from({ length: 7 }, (_, i) => {
    const day = addDays(weekStart, i)
    const planned = audit.activeWeek.filter((s) => s.date === day && overlapsTimeWindow(s.start, s.end, slot.start, slot.end)).length
    return { day, slot, planned, missing: Math.max(0, Number(slot.minDrivers || 0) - planned) }
  }))
  const attendance = attendanceRows(data, helpers, weekStart, to)
  const plannedTotal = attendance.reduce((sum, row) => sum + row.plannedMinutes, 0)
  const actualTotal = attendance.reduce((sum, row) => sum + row.actualMinutes, 0)
  const updateMinDrivers = (slotId, value) => {
    const n = Math.max(0, Number(value || 0))
    commit((prev) => ({ ...prev, settings: { ...prev.settings, coverageSlots: (prev.settings?.coverageSlots || []).map((slot) => slot.id === slotId ? { ...slot, minDrivers: n } : slot) } }), 'Upravena norma pokrytí provozu.')
  }
  return <>
    <PageTitle title="Audit provozu" subtitle="Kontrolní panel před ostrým nasazením: připravenost týdne, normy obsazení, docházka a datový model pro Supabase.">
      <button className="ghost" onClick={() => setWeekStart(addDays(weekStart, -7))}>← Předchozí</button>
      <button className="ghost" onClick={() => setWeekStart(startOfWeek(todayISO()))}>Tento týden</button>
      <button className="ghost" onClick={() => setWeekStart(addDays(weekStart, 7))}>Další →</button>
      <button className="primary" onClick={() => copyText(readinessText(data, helpers, weekStart))}>Kopírovat audit</button>
      <button className="ghost" onClick={() => exportAttendanceCSV(data, helpers, weekStart, to)}>Export docházky CSV</button>
    </PageTitle>
    <div className="grid kpis">
      <Kpi label="Připravenost" value={`${readinessPct} %`} hint={`${passed}/${audit.checks.length} kontrol OK`} kind={readinessPct === 100 ? 'good' : readinessPct >= 75 ? 'warn' : 'bad'} />
      <Kpi label="Týden" value={`${formatDate(weekStart)}–${formatDate(to)}`} hint="auditované období" />
      <Kpi label="Problémy" value={audit.conflicts.length + audit.gaps.length + audit.pendingSwaps.length + audit.declined.length} hint="kolize + pokrytí + výměny + odmítnutí" kind={(audit.conflicts.length + audit.gaps.length + audit.pendingSwaps.length + audit.declined.length) ? 'bad' : 'good'} />
      <Kpi label="Docházka" value={hoursLabel(actualTotal)} hint={`plán ${hoursLabel(plannedTotal)} · rozdíl ${hoursLabel(actualTotal - plannedTotal)}`} />
    </div>
    <div className="grid two" style={{ marginTop: 16 }}>
      <div className="card">
        <div className="section-title"><h3>Připraveno k provozu</h3><span className={readinessPct === 100 ? 'pill good' : 'pill warn'}>{readinessPct === 100 ? 'OK' : 'doplnit'}</span></div>
        <div className="stack">{audit.checks.map((check) => <div className={`alert ${check.ok ? 'good' : 'warn'}`} key={check.key}><b>{check.ok ? '✓' : '!'} {check.label}</b><br /><span>{check.detail}</span></div>)}</div>
      </div>
      <div className="card">
        <div className="section-title"><h3>Normy pokrytí provozu</h3><span className="pill">{data.settings?.coverageSlots?.length || 0} pásem</span></div>
        <div className="table-wrap"><table className="table"><thead><tr><th>Pásmo</th><th>Čas</th><th>Min. řidičů</th></tr></thead><tbody>{(data.settings?.coverageSlots || []).map((slot) => <tr key={slot.id}><td><b>{slot.name}</b></td><td>{slot.start}–{slot.end}</td><td><input type="number" min="0" value={slot.minDrivers} onChange={(e) => updateMinDrivers(slot.id, e.target.value)} style={{ width: 90 }} /></td></tr>)}</tbody></table></div>
        <p className="hintline">Změna normy se hned propíše do kontroly „chybí obsazení“.</p>
      </div>
    </div>
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title"><h3>Pokrytí týdne</h3><span className={coverageRows.some((r) => r.missing) ? 'pill bad' : 'pill good'}>{coverageRows.filter((r) => r.missing).length ? 'chybí obsazení' : 'pokrytí OK'}</span></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Den</th><th>Pásmo</th><th>Čas</th><th>Plánováno</th><th>Minimum</th><th>Stav</th></tr></thead><tbody>{coverageRows.map((row) => <tr key={`${row.day}-${row.slot.id}`}><td><b>{formatDate(row.day)}</b></td><td>{row.slot.name}</td><td>{row.slot.start}–{row.slot.end}</td><td>{row.planned}</td><td>{row.slot.minDrivers}</td><td>{row.missing ? <span className="pill bad">chybí {row.missing}</span> : <span className="pill good">OK</span>}</td></tr>)}</tbody></table></div>
    </div>
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title"><h3>Docházkový report pro výplaty</h3><span className="pill">{attendance.length} řidičů</span></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Řidič</th><th>Počet směn</th><th>Dokončeno</th><th>Plán</th><th>Reál</th><th>Rozdíl</th><th>Kontrola</th></tr></thead><tbody>{attendance.map((row) => <tr key={row.driver.id}><td><b>{row.driver.name}</b><br /><small>{row.driver.phone || row.driver.email || 'bez kontaktu'}</small></td><td>{row.shifts.length}</td><td>{row.completed}</td><td>{hoursLabel(row.plannedMinutes)}</td><td>{hoursLabel(row.actualMinutes)}</td><td>{hoursLabel(row.diffMinutes)}</td><td>{row.open ? <span className="pill warn">{row.open} běží</span> : <span className="pill good">OK</span>}</td></tr>)}</tbody></table></div>
    </div>
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title"><h3>Příprava datového modelu pro Supabase</h3><span className="pill good">v4.6 ready</span></div>
      <div className="grid three">
        {[
          ['drivers', 'řidiči, kontakty, aktivní stav'], ['vehicles', 'auta, SPZ, servisní stav'], ['shifts', 'plánované směny a stavy'], ['availability', 'dostupnost řidičů'], ['absence', 'nepřítomnosti'], ['service_blocks', 'servisní blokace aut'], ['swap_requests', 'žádosti a historie výměn'], ['notifications', 'centrum upozornění'], ['push_subscriptions', 'zařízení pro push'], ['attendance', 'nástup, konec, reálný čas'], ['audit_log', 'historie změn']
        ].map(([name, desc]) => <div className="log" key={name}><b>{name}</b><br /><span className="muted">{desc}</span></div>)}
      </div>
    </div>
  </>
}

function ShiftsList({ data, helpers, commit }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const filtered = sortByDateTime(data.shifts.filter((s) => {
    const q = query.trim().toLowerCase()
    const text = [s.date, s.start, s.end, helpers.driverName(s.driverId), helpers.vehicleName(s.vehicleId), s.note, statusMap[s.status], shiftTypeMap[s.type]].join(' ').toLowerCase()
    return (!q || text.includes(q)) && (filter === 'all' || s.status === filter)
  }))
  return <>
    <PageTitle title="Seznam směn" subtitle="Tabulkový přehled všech směn s rychlou změnou stavu.">
      <input className="searchbox" placeholder="Hledat směnu…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ minWidth: 240 }} />
      <select className="searchbox" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 190 }}>{[['all', 'Vše'], ...Object.entries(statusMap)].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
    </PageTitle>
    <ShiftTable shifts={filtered} data={data} helpers={helpers} commit={commit} />
  </>
}
function ShiftTable({ shifts, data, helpers, commit, compact = false }) {
  if (!shifts.length) return <div className="empty">Žádné směny k zobrazení.</div>
  const updateStatus = (shift, status, reason = '') => confirmPastChange(shift) && commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === shift.id ? { ...s, status, declineReason: reason } : s) }, statusNoticeForShift({ ...shift, status, declineReason: reason }, status, helpers, reason)), `Změněn stav směny na ${statusMap[status]}.`)
  const duplicate = (shift) => commit((prev) => ({ ...prev, shifts: [{ ...shift, id: uid('sh'), date: addDays(shift.date, 1), status: 'draft', declineReason: '', actualStartAt: '', actualEndAt: '', swapRequestStatus: '' }, ...prev.shifts] }), 'Duplikována směna na další den.')
  const remove = (shift) => {
    if (!confirmPastChange(shift)) return
    const reason = prompt('Důvod zrušení směny pro řidiče:', 'Zrušeno dispečerem')
    if (reason === null) return
    if (!confirm('Zrušit směnu a poslat řidiči notifikaci?')) return
    commit((prev) => cancelShiftData(prev, shift, helpers, reason || 'Zrušeno dispečerem'), `Zrušena směna ${formatDate(shift.date)} ${shift.start}–${shift.end}.`)
  }
  const hardDelete = (shift) => {
    if (!confirmHardDeleteShift(shift, helpers)) return
    commit((prev) => hardDeleteShiftData(prev, shift), '')
  }
  return <div className="table-wrap"><table className="table"><thead><tr><th>Datum</th><th>Čas</th><th>Řidič</th><th>Vozidlo</th><th>Stav</th><th>Docházka</th><th>Kontrola</th>{!compact && <th>Akce</th>}</tr></thead><tbody>{shifts.map((s) => {
    const conflicts = helpers.conflictMessages(s)
    return <tr key={s.id}><td><b>{formatDate(s.date)}</b><br /><small>{s.date}</small></td><td>{time(s.start)}–{time(s.end)}<br /><small>{shiftTypeMap[s.type] || s.type}</small></td><td>{helpers.driverName(s.driverId)}<br /><small>{s.note || 'Bez poznámky'}</small>{s.instruction && <><br /><small>Instrukce: {s.instruction}</small></>}{s.declineReason && <><br /><small>Důvod: {s.declineReason}</small></>}</td><td>{helpers.vehicleName(s.vehicleId)}</td><td><StatusPill status={s.status} helpers={helpers} />{['pending','accepted'].includes(s.swapRequestStatus) && <><br /><span className="pill warn">výměna</span></>}</td><td>{s.actualStartAt ? new Date(s.actualStartAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—'} → {s.actualEndAt ? new Date(s.actualEndAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—'}<br /><small>{durationLabel(actualDurationMinutes(s))}</small></td><td>{conflicts.length ? <span className="pill bad">{conflicts.length} kolize</span> : <span className="pill good">OK</span>}</td>{!compact && <td><div className="row-actions"><button onClick={() => updateStatus(s, 'confirmed')}>Potvrdit</button><button onClick={() => { const reason = prompt('Důvod odmítnutí:', s.declineReason || ''); updateStatus(s, 'declined', reason || '') }}>Odmítnout</button><button onClick={() => updateStatus(s, 'completed')}>Hotovo</button><button onClick={() => duplicate(s)}>Duplikovat</button><button className="danger-mini" onClick={() => remove(s)}>Zrušit</button><button className="danger-mini" onClick={() => hardDelete(s)}>Smazat</button></div></td>}</tr>
  })}</tbody></table></div>
}

function Drivers({ data, commit }) {
  const empty = { name: '', phone: '', email: '', profileId: '', active: true, note: '' }
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState(null)
  const submit = (e) => { e.preventDefault(); if (!form.name) return alert('Vyplň jméno řidiče.'); if (editing) commit((prev) => ({ ...prev, drivers: prev.drivers.map((d) => d.id === editing ? { ...d, ...form } : d) }), `Upraven řidič ${form.name}.`); else commit((prev) => ({ ...prev, drivers: [{ id: uid('drv'), ...form }, ...prev.drivers] }), `Přidán řidič ${form.name}.`); setForm(empty); setEditing(null) }
  const remove = (id) => safeDelete('řidič') && commit((prev) => ({ ...prev, drivers: prev.drivers.filter((d) => d.id !== id) }), 'Smazán řidič.')
  return <><PageTitle title="Řidiči" subtitle="Správa řidičů pro plánování směn." /><div className="grid two"><div className="card"><h3>{editing ? 'Upravit řidiče' : 'Nový řidič'}</h3><form className="form two-col" onSubmit={submit}><Field label="Jméno"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Telefon"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field><Field label="E-mail"><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field><Field label="Profile ID / Auth ID"><input value={form.profileId || ''} onChange={(e) => setForm({ ...form, profileId: e.target.value })} placeholder="volitelné – UUID uživatele" /></Field><Field label="Aktivní"><select value={String(form.active)} onChange={(e) => setForm({ ...form, active: e.target.value === 'true' })}><option value="true">Ano</option><option value="false">Ne</option></select></Field><Field label="Poznámka" className="span2"><textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field><div className="field span2"><button className="primary" type="submit">Uložit řidiče</button></div></form></div><div className="card"><div className="section-title"><h3>Seznam řidičů</h3><span className="pill">{data.drivers.length}</span></div><div className="stack">{data.drivers.map((d) => <div className="log" key={d.id}><div className="split"><div><b>{d.name}</b><br /><small className="muted">{d.phone || 'Bez telefonu'} · {d.email || 'Bez e-mailu'}{d.profileId ? ` · profil: ${d.profileId.slice(0, 8)}…` : ''}</small></div><span className={d.active ? 'pill good' : 'pill bad'}>{d.active ? 'Aktivní' : 'Neaktivní'}</span></div><p className="muted">{d.note}</p><div className="row-actions"><button onClick={() => { setEditing(d.id); setForm({ ...d }) }}>Upravit</button><button className="danger-mini" onClick={() => remove(d.id)}>Smazat</button></div></div>)}</div></div></div></>
}

function Vehicles({ data, commit }) {
  const empty = { name: '', plate: '', active: true, note: '' }
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState(null)
  const [block, setBlock] = useState({ vehicleId: '', from: todayISO(), to: todayISO(), reason: '' })
  const submit = (e) => { e.preventDefault(); if (!form.name || !form.plate) return alert('Vyplň vůz a SPZ.'); if (editing) commit((prev) => ({ ...prev, vehicles: prev.vehicles.map((v) => v.id === editing ? { ...v, ...form } : v) }), `Upraveno vozidlo ${form.name}.`); else commit((prev) => ({ ...prev, vehicles: [{ id: uid('car'), ...form }, ...prev.vehicles] }), `Přidáno vozidlo ${form.name}.`); setForm(empty); setEditing(null) }
  const addBlock = (e) => { e.preventDefault(); if (!block.vehicleId) return alert('Vyber vozidlo.'); commit((prev) => ({ ...prev, serviceBlocks: [{ id: uid('srv'), ...block }, ...prev.serviceBlocks] }), 'Přidána servisní blokace vozidla.'); setBlock({ vehicleId: '', from: todayISO(), to: todayISO(), reason: '' }) }
  const removeBlock = (id) => safeDelete('servisní blokace') && commit((prev) => ({ ...prev, serviceBlocks: prev.serviceBlocks.filter((b) => b.id !== id) }), 'Smazána servisní blokace.')
  return <><PageTitle title="Vozidla" subtitle="Správa aut a servisních blokací." /><div className="grid two"><div className="card"><h3>{editing ? 'Upravit vozidlo' : 'Nové vozidlo'}</h3><form className="form two-col" onSubmit={submit}><Field label="Název"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="SPZ"><input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} /></Field><Field label="Aktivní"><select value={String(form.active)} onChange={(e) => setForm({ ...form, active: e.target.value === 'true' })}><option value="true">Ano</option><option value="false">Ne</option></select></Field><Field label="Poznámka"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field><div className="field span2"><button className="primary" type="submit">Uložit vozidlo</button></div></form><hr style={{ borderColor: 'var(--line)', margin: '18px 0' }} /><h3>Servisní blokace</h3><form className="form two-col" onSubmit={addBlock}><Field label="Vozidlo"><select value={block.vehicleId} onChange={(e) => setBlock({ ...block, vehicleId: e.target.value })}><option value="">Vyber vůz</option>{data.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.plate}</option>)}</select></Field><Field label="Důvod"><input value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })} /></Field><Field label="Od"><input type="date" value={block.from} onChange={(e) => setBlock({ ...block, from: e.target.value })} /></Field><Field label="Do"><input type="date" value={block.to} onChange={(e) => setBlock({ ...block, to: e.target.value })} /></Field><div className="field span2"><button className="primary" type="submit">Přidat blokaci</button></div></form></div><div className="card"><div className="section-title"><h3>Seznam vozidel</h3><span className="pill">{data.vehicles.length}</span></div><div className="stack">{data.vehicles.map((v) => <div className="log" key={v.id}><div className="split"><div><b>{v.name}</b><br /><small className="muted">{v.plate} · {v.note}</small></div><span className={v.active ? 'pill good' : 'pill bad'}>{v.active ? 'Aktivní' : 'Neaktivní'}</span></div><div className="row-actions"><button onClick={() => { setEditing(v.id); setForm({ ...v }) }}>Upravit</button></div></div>)}</div><hr style={{ borderColor: 'var(--line)', margin: '18px 0' }} /><h3>Aktivní blokace</h3><div className="stack">{data.serviceBlocks.map((s) => <div className="alert warn" key={s.id}>{data.vehicles.find((v) => v.id === s.vehicleId)?.name || 'Vůz'} · {s.from} až {s.to}<br /><small>{s.reason}</small><div className="row-actions" style={{ marginTop: 8 }}><button onClick={() => removeBlock(s.id)}>Smazat</button></div></div>)}{!data.serviceBlocks.length && <div className="empty">Žádné servisní blokace.</div>}</div></div></div></>
}

function Availability({ data, commit, currentDriver }) {
  const [absence, setAbsence] = useState({ driverId: currentDriver?.id || data.drivers[0]?.id || '', from: todayISO(), to: todayISO(), reason: '' })
  const [slot, setSlot] = useState({ driverId: currentDriver?.id || data.drivers[0]?.id || '', weekday: 1, start: '08:00', end: '16:00', note: '' })
  useEffect(() => { if (currentDriver?.id) { setAbsence((f) => ({ ...f, driverId: currentDriver.id })); setSlot((f) => ({ ...f, driverId: currentDriver.id })) } }, [currentDriver?.id])
  const absences = data.absences.filter((a) => !currentDriver || a.driverId === currentDriver.id)
  const availability = (data.availability || []).filter((a) => !currentDriver || a.driverId === currentDriver.id)
  const submitAbsence = (e) => { e.preventDefault(); if (!absence.driverId || !absence.from || !absence.to) return alert('Vyplň řidiče a datum.'); commit((prev) => ({ ...prev, absences: [{ id: uid('abs'), ...absence }, ...prev.absences] }), 'Přidána nepřítomnost řidiče.'); setAbsence({ ...absence, from: todayISO(), to: todayISO(), reason: '' }) }
  const submitSlot = (e) => { e.preventDefault(); if (!slot.driverId || slot.weekday === '') return alert('Vyplň řidiče a den.'); commit((prev) => ({ ...prev, availability: [{ id: uid('av'), ...slot, weekday: Number(slot.weekday) }, ...(prev.availability || [])] }), 'Přidána dostupnost řidiče.'); setSlot({ ...slot, start: '08:00', end: '16:00', note: '' }) }
  const removeAbsence = (id) => safeDelete('nepřítomnost řidiče') && commit((prev) => ({ ...prev, absences: prev.absences.filter((a) => a.id !== id) }), 'Smazána nepřítomnost řidiče.')
  const removeSlot = (id) => safeDelete('dostupnost řidiče') && commit((prev) => ({ ...prev, availability: (prev.availability || []).filter((a) => a.id !== id) }), 'Smazána dostupnost řidiče.')
  const DriverSelect = ({ value, onChange }) => currentDriver ? null : <Field label="Řidič"><select value={value} onChange={(e) => onChange(e.target.value)}>{data.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
  return <><PageTitle title="Dostupnost řidičů" subtitle="Dostupnost, dovolené, nemoc a blokace řidiče proti plánování. Pokud má řidič zadanou dostupnost pro daný den, plánovač hlídá směny mimo dostupnost." />
    <div className="grid two">
      <div className="card"><h3>Nová dostupnost</h3><form className="form two-col" onSubmit={submitSlot}><DriverSelect value={slot.driverId} onChange={(v) => setSlot({ ...slot, driverId: v })} /><Field label="Den v týdnu"><select value={slot.weekday} onChange={(e) => setSlot({ ...slot, weekday: Number(e.target.value) })}>{Object.entries(weekdayMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field><Field label="Od"><input type="time" value={slot.start} onChange={(e) => setSlot({ ...slot, start: e.target.value })} /></Field><Field label="Do"><input type="time" value={slot.end} onChange={(e) => setSlot({ ...slot, end: e.target.value })} /></Field><Field label="Poznámka" className="span2"><input value={slot.note} onChange={(e) => setSlot({ ...slot, note: e.target.value })} placeholder="Např. jen denní, jen víkend, po domluvě…" /></Field><div className="field span2"><button className="primary" type="submit">Uložit dostupnost</button></div></form></div>
      <div className="card"><h3>Nová nepřítomnost</h3><form className="form two-col" onSubmit={submitAbsence}><DriverSelect value={absence.driverId} onChange={(v) => setAbsence({ ...absence, driverId: v })} /><Field label="Od"><input type="date" value={absence.from} onChange={(e) => setAbsence({ ...absence, from: e.target.value })} /></Field><Field label="Do"><input type="date" value={absence.to} onChange={(e) => setAbsence({ ...absence, to: e.target.value })} /></Field><Field label="Důvod" className="span2"><input value={absence.reason} onChange={(e) => setAbsence({ ...absence, reason: e.target.value })} placeholder="Volno, nemoc, dovolená…" /></Field><div className="field span2"><button className="primary" type="submit">Uložit nepřítomnost</button></div></form></div>
    </div>
    <div className="grid two" style={{ marginTop: 16 }}>
      <div className="card"><div className="section-title"><h3>Dostupnost</h3><span className="pill">{availability.length}</span></div><div className="stack">{availability.map((a) => <div className="alert good" key={a.id}><b>{data.drivers.find((d) => d.id === a.driverId)?.name}</b> · {weekdayMap[a.weekday]} {a.start}–{a.end}<br /><small>{a.note || 'Bez poznámky'}</small><div className="row-actions" style={{ marginTop: 8 }}><button onClick={() => removeSlot(a.id)}>Smazat</button></div></div>)}{!availability.length && <div className="empty">Není zadaná žádná dostupnost. Bez dostupnosti plánovač řidiče neomezuje.</div>}</div></div>
      <div className="card"><div className="section-title"><h3>Nepřítomnosti</h3><span className="pill warn">{absences.length}</span></div><div className="stack">{absences.map((a) => <div className="alert warn" key={a.id}><b>{data.drivers.find((d) => d.id === a.driverId)?.name}</b> · {a.from} až {a.to}<br /><small>{a.reason || 'Bez důvodu'}</small><div className="row-actions" style={{ marginTop: 8 }}><button onClick={() => removeAbsence(a.id)}>Smazat</button></div></div>)}{!absences.length && <div className="empty">Žádné nepřítomnosti.</div>}</div></div>
    </div>
  </>
}

function DriverHome({ data, helpers, commit, currentDriver }) {
  const shifts = sortByDateTime(data.shifts.filter((s) => s.driverId === currentDriver?.id && s.date >= todayISO() && s.status !== 'cancelled')).slice(0, 30)
  const openShifts = sortByDateTime((data.shifts || []).filter((s) => s.status === 'open' && !s.driverId && s.date >= todayISO())).slice(0, 30)
  const myOpenInterests = (data.swapRequests || []).filter((r) => r.targetMode === 'open' && r.driverId === currentDriver?.id && ['pending','accepted'].includes(r.status))
  const visibleNotices = (data.notifications || []).filter((n) => isNoticeVisible(n, currentDriver, true))
  const unreadNotices = visibleNotices.filter((n) => !isNoticeRead(n, currentDriver, true))
  const myDevices = (data.pushSubscriptions || []).filter((p) => p.active !== false && p.driverId === currentDriver?.id)
  const awaiting = shifts.filter((s) => s.status === 'assigned' || s.status === 'draft')
  const running = shifts.find((s) => s.actualStartAt && !s.actualEndAt)
  const todayShift = shifts.find((x) => x.date === todayISO())
  const nextShift = shifts.find((x) => x.date > todayISO()) || shifts[0]
  const focus = running || todayShift || nextShift
  const setStatus = (id, status, reason = '') => {
    const shift = data.shifts.find((s) => s.id === id)
    const notices = shift ? [adminNotice(`Řidič změnil stav: ${statusMap[status]}`, `${currentDriver?.name || 'Řidič'} · ${formatDate(shift.date)} ${shift.start}–${shift.end}${reason ? ` · důvod: ${reason}` : ''}`, `driver-${status}`, id)] : []
    commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === id ? { ...s, status, declineReason: reason } : s) }, notices), `${currentDriver?.name || 'Řidič'} změnil stav směny na ${statusMap[status]}.`)
  }
  const checkIn = (id) => {
    const shift = data.shifts.find((s) => s.id === id)
    commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === id ? { ...s, actualStartAt: s.actualStartAt || localStamp(), status: s.status === 'assigned' ? 'confirmed' : s.status } : s) }, shift ? adminNotice('Řidič nastoupil na směnu', `${currentDriver?.name || 'Řidič'} · ${formatDate(shift.date)} ${shift.start}–${shift.end}`, 'attendance-start', id) : null), `${currentDriver?.name || 'Řidič'} nastoupil na směnu.`)
  }
  const checkOut = (id) => {
    const shift = data.shifts.find((s) => s.id === id)
    commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === id ? { ...s, actualEndAt: s.actualEndAt || localStamp(), status: 'completed' } : s) }, shift ? adminNotice('Řidič ukončil směnu', `${currentDriver?.name || 'Řidič'} · ${formatDate(shift.date)} ${shift.start}–${shift.end}`, 'attendance-end', id) : null), `${currentDriver?.name || 'Řidič'} ukončil směnu.`)
  }
  const requestSwap = (shift) => {
    if (['cancelled', 'completed'].includes(shift.status)) return alert('Tuto směnu už nelze nabídnout k výměně.')
    const colleagues = data.drivers.filter((d) => d.active && d.id !== currentDriver?.id)
    const targetRaw = prompt(`Komu nabídnout výměnu?\nNapiš VŠEM nebo jméno kolegy.\nKolegové: ${colleagues.map((d) => d.name).join(', ')}`, 'VŠEM')
    if (targetRaw === null) return
    const normalized = targetRaw.trim().toLowerCase()
    const targetDriver = normalized && !['vsem', 'všem', 'all', '*'].includes(normalized) ? colleagues.find((d) => d.name.toLowerCase().includes(normalized)) : null
    if (normalized && !['vsem', 'všem', 'all', '*'].includes(normalized) && !targetDriver) return alert('Kolegu jsem nenašel. Zadej přesné jméno nebo napiš VŠEM.')
    const reason = prompt('Důvod žádosti / zpráva pro kolegy:', '')
    if (reason === null) return
    const request = { id: uid('swap'), shiftId: shift.id, driverId: currentDriver?.id, reason, status: 'pending', targetMode: targetDriver ? 'driver' : 'all', targetDriverId: targetDriver?.id || '', acceptedByDriverId: '', acceptedAt: '', createdAt: new Date().toISOString(), history: [{ at: new Date().toISOString(), text: targetDriver ? `Nabídnuto kolegovi ${targetDriver.name}.` : 'Nabídnuto všem kolegům.' }] }
    const targetIds = targetDriver ? [targetDriver.id] : colleagues.map((d) => d.id)
    const notices = [
      makeNotice({ title: 'Nová žádost o výměnu', body: `${currentDriver?.name || 'Řidič'} nabízí směnu ${formatDate(shift.date)} ${shift.start}–${shift.end}${targetDriver ? ` pro: ${targetDriver.name}` : ' všem kolegům'}.`, targetRole: 'admin', type: 'swap-request', shiftId: shift.id }),
      ...targetIds.map((id) => makeNotice({ title: 'Nabídka výměny směny', body: `${formatDate(shift.date)} ${shift.start}–${shift.end} · ${helpers.vehicleName(shift.vehicleId)}. ${reason || ''}`, targetDriverId: id, type: 'swap-offer', shiftId: shift.id })),
    ]
    commit((prev) => addNotificationsToData({ ...prev, swapRequests: [request, ...(prev.swapRequests || [])], shifts: prev.shifts.map((s) => s.id === shift.id ? { ...s, swapRequestStatus: 'pending' } : s) }, notices), `${currentDriver?.name || 'Řidič'} nabídl výměnu směny ${targetDriver ? `kolegovi ${targetDriver.name}` : 'všem kolegům'}.`)
  }
  const cancelSwap = (shift) => {
    const activeReq = (data.swapRequests || []).find((r) => r.shiftId === shift.id && r.driverId === currentDriver?.id && ['pending','accepted'].includes(r.status))
    if (!activeReq) return alert('U této směny nemáš aktivní žádost o výměnu.')
    if (!confirm('Zrušit žádost o výměnu této směny?')) return
    const notices = [adminNotice('Řidič zrušil žádost o výměnu', `${currentDriver?.name || 'Řidič'} · ${formatDate(shift.date)} ${shift.start}–${shift.end}`, 'swap-cancelled', shift.id)]
    if (activeReq.acceptedByDriverId) notices.push(makeNotice({ title: 'Výměna byla zrušena', body: `${formatDate(shift.date)} ${shift.start}–${shift.end}`, targetDriverId: activeReq.acceptedByDriverId, type: 'swap-cancelled', shiftId: shift.id }))
    commit((prev) => addNotificationsToData({ ...prev, swapRequests: (prev.swapRequests || []).map((r) => r.id === activeReq.id ? appendSwapHistory({ ...r, status: 'cancelled', cancelledAt: new Date().toISOString(), resolvedAt: new Date().toISOString() }, 'Řidič žádost zrušil.') : r), shifts: prev.shifts.map((s) => s.id === shift.id ? { ...s, swapRequestStatus: 'cancelled' } : s) }, notices), `${currentDriver?.name || 'Řidič'} zrušil žádost o výměnu.`)
  }
  const incomingSwaps = (data.swapRequests || []).filter((r) => r.status === 'pending' && r.driverId !== currentDriver?.id && (r.targetMode === 'all' || r.targetDriverId === currentDriver?.id))
    .map((r) => ({ request: r, shift: data.shifts.find((s) => s.id === r.shiftId) }))
    .filter((x) => x.shift && x.shift.date >= todayISO())
  const acceptSwap = (request) => {
    const shift = data.shifts.find((s) => s.id === request.shiftId)
    if (!shift) return alert('Směna už neexistuje.')
    if (!confirm(`Přijmout nabídku výměny ${formatDate(shift.date)} ${shift.start}–${shift.end}? Admin ji pak musí schválit.`)) return
    const notices = [
      makeNotice({ title: 'Kolega přijal výměnu', body: `${currentDriver?.name || 'Kolega'} přijal nabídku směny ${formatDate(shift.date)} ${shift.start}–${shift.end}.`, targetRole: 'admin', type: 'swap-accepted', shiftId: shift.id }),
      makeNotice({ title: 'Kolega přijal tvoji nabídku', body: `${currentDriver?.name || 'Kolega'} chce převzít tvoji směnu ${formatDate(shift.date)} ${shift.start}–${shift.end}.`, targetDriverId: request.driverId, type: 'swap-accepted', shiftId: shift.id }),
    ]
    commit((prev) => addNotificationsToData({ ...prev, swapRequests: (prev.swapRequests || []).map((r) => r.id === request.id ? appendSwapHistory({ ...r, status: 'accepted', acceptedByDriverId: currentDriver?.id, acceptedAt: new Date().toISOString() }, `${currentDriver?.name || 'Kolega'} chce směnu převzít.`) : r), shifts: prev.shifts.map((s) => s.id === shift.id ? { ...s, swapRequestStatus: 'accepted' } : s) }, notices), `${currentDriver?.name || 'Řidič'} přijal nabídku výměny směny.`)
  }
  const applyForOpenShift = (shift) => {
    if (!currentDriver?.id) return alert('Řidičský profil není propojený.')
    const already = (data.swapRequests || []).find((r) => r.shiftId === shift.id && r.driverId === currentDriver.id && r.targetMode === 'open' && ['pending','accepted'].includes(r.status))
    if (already) return alert('O tuto volnou směnu už máš projevený zájem.')
    const messages = helpers.conflictMessages({ ...shift, driverId: currentDriver.id, status: 'assigned' })
    const availabilityWarning = messages.length ? `\n\nPozor: ${messages.join(' ')}` : ''
    if (!confirm(`Přihlásit se na volnou směnu ${formatDate(shift.date)} ${shift.start}–${shift.end}? Admin/dispečer musí přihlášení schválit.${availabilityWarning}`)) return
    const request = { id: uid('swap'), shiftId: shift.id, driverId: currentDriver.id, reason: 'Zájem o volnou směnu', status: 'pending', targetMode: 'open', targetDriverId: '', acceptedByDriverId: currentDriver.id, acceptedAt: new Date().toISOString(), createdAt: new Date().toISOString(), history: [{ at: new Date().toISOString(), text: `${currentDriver.name} projevil zájem o volnou směnu.` }] }
    const notices = [
      makeNotice({ title: 'Zájem o volnou směnu', body: `${currentDriver.name} se hlásí na ${formatDate(shift.date)} ${shift.start}–${shift.end}.`, targetRole: 'admin', type: 'open-shift-interest', shiftId: shift.id }),
      makeNotice({ title: 'Zájem odeslán', body: `${formatDate(shift.date)} ${shift.start}–${shift.end} čeká na schválení dispečerem.`, targetDriverId: currentDriver.id, type: 'open-shift-interest-sent', shiftId: shift.id }),
    ]
    commit((prev) => addNotificationsToData({ ...prev, swapRequests: [request, ...(prev.swapRequests || [])], shifts: prev.shifts.map((s) => s.id === shift.id ? { ...s, swapRequestStatus: 'pending' } : s) }, notices), `${currentDriver.name} projevil zájem o volnou směnu.`)
  }
  const decline = (shift) => { const reason = prompt('Důvod odmítnutí:', shift.declineReason || ''); if (reason !== null) setStatus(shift.id, 'declined', reason || '') }
  const DriverActions = ({ shift, compact = false }) => {
    const canConfirm = !['confirmed','completed','cancelled'].includes(shift.status)
    const canDecline = !['declined','completed','cancelled'].includes(shift.status) && !shift.actualStartAt
    const canCheckIn = !shift.actualStartAt && !['declined','cancelled','completed'].includes(shift.status)
    const canCheckOut = Boolean(shift.actualStartAt && !shift.actualEndAt)
    const canSwap = !['cancelled','completed'].includes(shift.status) && !['pending','accepted'].includes(shift.swapRequestStatus)
    return <div className={compact ? 'driver-actions driver-actions-compact' : 'driver-actions'}>
      {canConfirm && <button className="primary" onClick={() => setStatus(shift.id, 'confirmed')}>Potvrdit</button>}
      {canCheckIn && <button className="primary soft-primary" onClick={() => checkIn(shift.id)}>Nastoupil jsem</button>}
      {canCheckOut && <button className="primary" onClick={() => checkOut(shift.id)}>Ukončit směnu</button>}
      {canSwap && <button className="ghost" onClick={() => requestSwap(shift)}>Výměna</button>}
      {['pending','accepted'].includes(shift.swapRequestStatus) && <button className="danger" onClick={() => cancelSwap(shift)}>Zrušit výměnu</button>}
      {canDecline && <button className="danger" onClick={() => decline(shift)}>Odmítnout</button>}
    </div>
  }
  const ShiftMobileCard = ({ s, focusCard = false }) => {
    const duration = actualDurationMinutes(s)
    const vehicle = helpers.vehicle(s.vehicleId)
    return <div className={focusCard ? 'card driver-hero' : 'card driver-shift-card'}>
      <div className="driver-shift-head"><div><span className="driver-date">{formatDate(s.date)}</span><h3>{s.start}–{s.end}</h3><p className="muted">{vehicle?.name || 'Bez vozu'} · {vehicle?.plate || 'SPZ nezadaná'}</p></div><StatusPill status={s.status} helpers={helpers} /></div>
      {s.instruction && <div className="driver-instruction"><b>Instrukce:</b><br />{s.instruction}</div>}
      {s.note && <p className="muted driver-note">{s.note}</p>}
      <div className="driver-mini-grid"><Kpi label="Nástup" value={s.actualStartAt ? new Date(s.actualStartAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—'} hint={s.actualStartAt ? 'zaznamenáno' : 'čeká'} /><Kpi label="Konec" value={s.actualEndAt ? new Date(s.actualEndAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—'} hint={s.actualEndAt ? 'hotovo' : 'čeká'} /><Kpi label="Reál" value={durationLabel(duration)} hint="docházka" /></div>
      <ConflictBox messages={helpers.conflictMessages(s)} />
      {['pending','accepted'].includes(s.swapRequestStatus) && <div className="alert warn">Žádost o výměnu je odeslaná a čeká na admina.</div>}
      {s.declineReason && <p className="muted">Důvod odmítnutí: {s.declineReason}</p>}
      <DriverActions shift={s} compact={!focusCard} />
    </div>
  }
  return <div className="driver-view driver-mobile-view">
    <PageTitle title={`Moje směny · ${currentDriver?.name || ''}`} subtitle="v5.4.1: moje směny, volné směny a rychlé přihlášení na nabídku."><button className="ghost" onClick={() => copyText(driverText(data, helpers, currentDriver?.id))}>Kopírovat moje směny</button></PageTitle>
    <div className="driver-status-grid"><Kpi label="Čeká na potvrzení" value={awaiting.length} hint="směny" kind={awaiting.length ? 'warn' : 'good'} /><Kpi label="Nové notifikace" value={unreadNotices.length} hint="nepřečtené" kind={unreadNotices.length ? 'warn' : 'good'} /><Kpi label="Push zařízení" value={myDevices.length} hint={myDevices.length ? 'aktivní' : 'zapnout'} kind={myDevices.length ? 'good' : 'warn'} /><Kpi label="Volné směny" value={openShifts.length} hint="nabídky" kind={openShifts.length ? 'warn' : 'good'} /><Kpi label="Výměny pro mě" value={incomingSwaps.length} hint="nabídky" kind={incomingSwaps.length ? 'warn' : 'good'} /></div>
    {!myDevices.length && <div className="alert warn driver-push-warning"><b>Zapni notifikace.</b><br />Aby ti přišly nové směny a změny, otevři záložku Notifikace a povol zařízení. Na iPhonu spusť aplikaci z plochy.</div>}
    {focus ? <ShiftMobileCard s={focus} focusCard /> : <div className="empty">Nemáš žádnou dnešní ani budoucí směnu.</div>}
    {openShifts.length > 0 && <div className="card driver-offers"><div className="section-title"><h3>Volné směny</h3><span className="pill warn">{openShifts.length}</span></div><div className="stack">{openShifts.map((shift) => { const interested = myOpenInterests.some((r) => r.shiftId === shift.id); return <div className="alert warn" key={shift.id}><b>{formatDate(shift.date)} {shift.start}–{shift.end}</b><br />{helpers.vehicleName(shift.vehicleId)} · {shift.note || 'Volná směna k obsazení'}<br />{shift.instruction && <small>Instrukce: {shift.instruction}</small>}<div className="row-actions" style={{ marginTop: 8 }}>{interested ? <span className="pill good">Zájem odeslán</span> : <button onClick={() => applyForOpenShift(shift)}>Mám zájem</button>}</div></div> })}</div></div>}
    {incomingSwaps.length > 0 && <div className="card driver-offers"><div className="section-title"><h3>Nabídnuté výměny pro mě</h3><span className="pill warn">{incomingSwaps.length}</span></div><div className="stack">{incomingSwaps.map(({ request, shift }) => <div className="alert warn" key={request.id}><b>{formatDate(shift.date)} {shift.start}–{shift.end}</b><br />Nabízí: {helpers.driverName(request.driverId)} · {helpers.vehicleName(shift.vehicleId)}<br /><small>{request.reason || 'Bez zprávy'}</small><div className="row-actions" style={{ marginTop: 8 }}><button onClick={() => acceptSwap(request)}>Chci převzít směnu</button></div></div>)}</div></div>}
    <div className="section-title driver-list-title"><h3>Moje další směny</h3><span className="pill">{shifts.length}</span></div>
    <div className="driver-card-list">{shifts.map((s) => <ShiftMobileCard s={s} key={s.id} />)}{!shifts.length && <div className="empty">Nemáš žádné plánované směny.</div>}</div>
  </div>
}


function PushSetupCard({ data, commit, currentDriver, isDriver, profile }) {
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'))
  const [status, setStatus] = useState('')
  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''
  const subscribe = async () => {
    try {
      const sub = await subscribeDeviceForPush(vapidPublicKey)
      const record = { id: uid('push'), profileId: profile?.id || '', driverId: isDriver ? currentDriver?.id || '' : '', role: isDriver ? 'driver' : (profile?.role || 'admin'), endpoint: sub.endpoint || '', subscription: sub, platform: navigator.userAgent, createdAt: new Date().toISOString(), active: true }
      commit((prev) => ({ ...prev, pushSubscriptions: [record, ...(prev.pushSubscriptions || []).filter((x) => x.endpoint !== record.endpoint)] }), 'Zařízení povolilo notifikace.')
      setPermission('granted')
      setStatus(sub.endpoint ? 'Zařízení je přihlášené k push notifikacím.' : 'Notifikace jsou povolené. Pro ostré push zprávy doplň VAPID klíč a backend.')
      await showBrowserNotification('RBSHIFT notifikace aktivní', 'Test notifikace proběhl v pořádku.')
    } catch (err) {
      setPermission('Notification' in window ? Notification.permission : 'unsupported')
      setStatus(err?.message || 'Notifikace se nepodařilo povolit.')
    }
  }
  const test = async () => {
    try {
      const ok = await showBrowserNotification('RBSHIFT test', 'Takhle bude vypadat upozornění na směnu nebo změnu.')
      setPermission('Notification' in window ? Notification.permission : 'unsupported')
      setStatus(ok ? 'Testovací lokální notifikace odeslána.' : 'Notifikace nejsou povolené.')
    } catch (err) { setStatus(err?.message || 'Test notifikace selhal.') }
  }
  const serverTest = () => {
    const notice = makeNotice({
      title: 'RBSHIFT server push test',
      body: 'Toto je ostrý test přes Vercel backend a uložené zařízení.',
      targetDriverId: isDriver ? currentDriver?.id || '' : '',
      targetRole: isDriver ? 'driver_all' : (profile?.role || 'admin'),
      type: 'push-test',
    })
    commit((prev) => addNotificationsToData(prev, notice), 'Odeslán test serverové push notifikace.')
    setStatus('Serverový test byl vložen do notifikací. Pokud je Vercel backend a VAPID nastavený správně, přijde push na přihlášené zařízení.')
  }
  const supported = 'serviceWorker' in navigator && 'Notification' in window
  const pushSupported = 'PushManager' in window
  const myDevices = (data.pushSubscriptions || []).filter((p) => isDriver ? p.driverId === currentDriver?.id : p.profileId === profile?.id || p.role === profile?.role)
  const activeDevices = myDevices.filter((p) => p.active !== false)
  const deactivateDevice = (id) => {
    if (!confirm('Odebrat toto zařízení z push notifikací?')) return
    commit((prev) => ({ ...prev, pushSubscriptions: (prev.pushSubscriptions || []).map((p) => p.id === id ? { ...p, active: false } : p) }), 'Zařízení bylo odebráno z push notifikací.')
  }
  return <div className="card">
    <div className="section-title"><h3>Push notifikace zařízení</h3><span className={permission === 'granted' ? 'pill good' : 'pill warn'}>{permission}</span></div>
    <p className="muted">Android podporuje PWA notifikace přímo v Chrome. Na iPhonu musí být aplikace přidaná na plochu a musí běžet jako PWA, jinak iOS běžně nepovolí web push pro stránku otevřenou jen v Safari.</p>
    <div className="grid three" style={{ margin: '12px 0' }}>
      <Kpi label="Service Worker" value={supported ? 'OK' : 'Ne'} hint="základ PWA" kind={supported ? 'good' : 'bad'} />
      <Kpi label="PushManager" value={pushSupported ? 'OK' : 'Ne'} hint="remote push" kind={pushSupported ? 'good' : 'bad'} />
      <Kpi label="VAPID klíč" value={vapidPublicKey ? 'vyplněn' : 'chybí'} hint="browser subscription" kind={vapidPublicKey ? 'good' : 'warn'} />
    </div>
    <div className="actions" style={{ justifyContent: 'flex-start' }}>
      <button className="primary" onClick={subscribe}>Povolit notifikace na tomto zařízení</button>
      <button className="ghost" onClick={test}>Lokální test</button>
      <button className="ghost" onClick={serverTest}>Server push test</button>
    </div>
    {status && <div className="alert warn" style={{ marginTop: 12 }}>{status}</div>}
    <div className="ios-guide"><b>iPhone postup</b><ol><li>Otevři aplikaci v Safari.</li><li>Dej Sdílet → Přidat na plochu.</li><li>Spusť RBSHIFT z plochy.</li><li>Potom povol notifikace.</li></ol></div>
    <div className="device-list">
      <div className="section-title"><h3>Moje zařízení</h3><span className={activeDevices.length ? 'pill good' : 'pill warn'}>{activeDevices.length} aktivní</span></div>
      {myDevices.map((d) => <div className="device-row" key={d.id}><div><b>{d.active === false ? 'Vypnuté zařízení' : 'Aktivní zařízení'}</b><br /><small className="muted">{d.platform ? d.platform.slice(0, 86) : 'bez názvu'}{d.endpoint ? ' · endpoint uložen' : ''}</small></div>{d.active !== false && <button className="danger" onClick={() => deactivateDevice(d.id)}>Odebrat</button>}</div>)}
      {!myDevices.length && <div className="empty">Na tomto účtu zatím není uložené žádné zařízení.</div>}
    </div>
    <p className="hintline">v5.4: zařízení se ukládá do Supabase, lze ho odebrat a řidič vidí stav notifikací přímo v mobilním režimu.</p>
  </div>
}

function NotificationsView({ data, helpers, commit, currentDriver, isDriver, profile }) {
  const visible = (data.notifications || []).filter((n) => isNoticeVisible(n, currentDriver, isDriver))
  const unread = visible.filter((n) => !isNoticeRead(n, currentDriver, isDriver))
  const markOne = (id) => commit((prev) => ({ ...prev, notifications: (prev.notifications || []).map((n) => n.id === id ? markNoticeRead(n, currentDriver, isDriver) : n) }), 'Notifikace označena jako přečtená.')
  const markAll = () => commit((prev) => ({ ...prev, notifications: (prev.notifications || []).map((n) => isNoticeVisible(n, currentDriver, isDriver) ? markNoticeRead(n, currentDriver, isDriver) : n) }), 'Notifikace označeny jako přečtené.')
  const clearOld = () => safeDelete('smazání notifikací') && commit((prev) => ({ ...prev, notifications: (prev.notifications || []).filter((n) => !isNoticeVisible(n, currentDriver, isDriver) || !isNoticeRead(n, currentDriver, isDriver)) }), 'Smazány přečtené notifikace.')
  return <>
    <PageTitle title="Notifikace" subtitle="Upozornění na nové směny, změny, výměny a provozní požadavky.">
      <button className="ghost" onClick={markAll}>Označit vše jako přečtené</button>
      <button className="danger" onClick={clearOld}>Smazat přečtené</button>
    </PageTitle>
    <div className="grid kpis" style={{ marginBottom: 16 }}>
      <Kpi label="Viditelné" value={visible.length} hint={isDriver ? 'pro tohoto řidiče' : 'admin vidí vše'} />
      <Kpi label="Nepřečtené" value={unread.length} hint="vyžaduje pozornost" kind={unread.length ? 'warn' : 'good'} />
      <Kpi label="Zařízení" value={(data.pushSubscriptions || []).length} hint="uložené odběry push" />
      <Kpi label="Režim" value={import.meta.env.VITE_VAPID_PUBLIC_KEY ? 'v5.4 push' : 'demo'} hint="VAPID + Vercel API" />
    </div>
    <div className="grid two">
      <div className="card"><div className="section-title"><h3>Centrum upozornění</h3><span className={unread.length ? 'pill warn' : 'pill good'}>{unread.length} nepřečteno</span></div><div className="stack">
        {visible.map((n) => <div className={isNoticeRead(n, currentDriver, isDriver) ? 'log' : 'alert warn'} key={n.id}>
          <div className="split"><div><b>{n.title}</b><br /><small className="muted">{new Date(n.at).toLocaleString('cs-CZ')} · {n.type || 'info'}</small></div>{!isNoticeRead(n, currentDriver, isDriver) && <span className="pill warn">nové</span>}</div>
          <p>{n.body || 'Bez detailu'}</p>
          {n.shiftId && <small className="muted">Směna: {n.shiftId}</small>}
          <div className="row-actions" style={{ marginTop: 8 }}><button onClick={() => markOne(n.id)}>Přečteno</button></div>
        </div>)}
        {!visible.length && <div className="empty">Zatím žádné notifikace.</div>}
      </div></div>
      <div className="stack"><PushSetupCard data={data} commit={commit} currentDriver={currentDriver} isDriver={isDriver} profile={profile} /><div className="card"><div className="section-title"><h3>Pravidla notifikací v5.4.1</h3><span className="pill good">připraveno</span></div><div className="stack">{notificationRules.map(([title, desc]) => <div className="log" key={title}><b>{title}</b><br /><small className="muted">{desc}</small></div>)}</div></div></div>
    </div>
  </>
}

function History({ data }) { return <><PageTitle title="Historie změn" subtitle="Audit log posledních akcí v aplikaci." /><div className="card"><div className="timeline stack">{data.audit?.map((log) => <div className="log" key={log.id}><b>{new Date(log.at).toLocaleString('cs-CZ')}</b><br /><span className="muted">{log.text}</span></div>)}{!data.audit?.length && <div className="empty">Historie je prázdná.</div>}</div></div></> }
function Settings({ data, commit, supabase, onlineMode, reloadOnline, profile }) {
  const [name, setName] = useState(data.settings?.companyName || 'RBSHIFT')
  const [autoBackupInfo, setAutoBackupInfo] = useState(() => {
    try { return JSON.parse(localStorage.getItem(AUTOBACKUP_KEY) || 'null') } catch { return null }
  })
  const importFile = (file) => { if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const parsed = JSON.parse(reader.result); commit(parsed.data || parsed, 'Obnovena data ze zálohy JSON.'); alert('Záloha byla obnovena.') } catch { alert('Soubor nejde načíst jako JSON.') } }; reader.readAsText(file) }
  const restoreAuto = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(AUTOBACKUP_KEY) || 'null')
      if (!parsed?.data) return alert('Automatická záloha není dostupná.')
      if (!confirm(`Obnovit automatickou zálohu z ${new Date(parsed.savedAt).toLocaleString('cs-CZ')}?`)) return
      commit(parsed.data, 'Obnovena automatická záloha.')
    } catch { alert('Automatická záloha nejde načíst.') }
  }
  return <><PageTitle title="Nastavení" subtitle="Záloha, obnova dat, demo režim, automatická ochrana dat a základní nastavení aplikace." />
    <div className="grid two">
      <div className="card"><h3>Firma / název aplikace</h3><div className="form two-col"><Field label="Název"><input value={name} onChange={(e) => setName(e.target.value)} /></Field><div className="field"><label>&nbsp;</label><button className="primary" onClick={() => commit((prev) => ({ ...prev, settings: { ...prev.settings, companyName: name } }), 'Změněn název aplikace.')}>Uložit název</button></div></div><hr style={{ borderColor: 'var(--line)', margin: '18px 0' }} /><h3>Supabase</h3><p className="muted">Stav: {onlineMode ? 'Online režim je aktivní. Změny se ukládají do Supabase.' : supabase ? 'Konfigurace je vyplněná, ale nejsi přihlášený / nemáš profil.' : 'Demo režim bez backendu. Data jsou jen v prohlížeči.'}</p><p className="hintline">Uživatel: {profile?.full_name || profile?.email || 'demo'} · Role: {profile?.role || 'demo'}</p><div className="row-actions" style={{ marginTop: 10 }}>{onlineMode && <button onClick={reloadOnline}>Načíst z databáze</button>}{onlineMode && ['admin','dispatcher'].includes(profile?.role) && <button onClick={async () => { if (!confirm('Nahrát aktuální lokální data do Supabase? Přepíše shodná ID.')) return; try { await seedSupabaseFromLocal(data); await reloadOnline(); alert('Data byla nahrána do Supabase.') } catch (e) { alert(e.message || String(e)) } }}>Nahrát aktuální data do Supabase</button>}</div><p className="hintline">Verze dat používá lokální zálohu: {STORAGE_KEY}. Online režim ukládá přes tabulky Supabase.</p></div>
      <div className="card"><h3>Záloha a obnova</h3><div className="stack"><button className="primary" onClick={() => backup(data)}>Stáhnout zálohu JSON</button><button className="ghost" onClick={() => exportCSV(data, buildHelpers(data))}>Stáhnout směny CSV</button><label className="ghost" style={{ textAlign: 'center' }}>Nahrát zálohu JSON<input type="file" accept="application/json" onChange={(e) => importFile(e.target.files?.[0])} style={{ display: 'none' }} /></label><button className="ghost" onClick={restoreAuto}>Obnovit automatickou zálohu</button><button className="danger" onClick={() => safeDelete('reset demo dat') && commit(seed(), 'Resetováno na demo data.')}>Reset demo dat</button></div><p className="hintline">Automatická záloha: {autoBackupInfo?.savedAt ? new Date(autoBackupInfo.savedAt).toLocaleString('cs-CZ') : 'zatím není dostupná'}</p></div>
    </div>
    <div className="card" style={{ marginTop: 16 }}><div className="section-title"><h3>Kontrola dat</h3><span className="pill good">finální lokální v4.6</span></div><div className="grid four"><Kpi label="Řidiči" value={data.drivers.length} hint={`${data.drivers.filter((d) => d.active).length} aktivní`} /><Kpi label="Vozidla" value={data.vehicles.length} hint={`${data.vehicles.filter((v) => v.active).length} aktivní`} /><Kpi label="Směny" value={data.shifts.length} hint="uloženo lokálně" /><Kpi label="Historie" value={data.audit?.length || 0} hint="poslední akce" /></div></div>
    <div className="card" style={{ marginTop: 16 }}><div className="section-title"><h3>Role a práva</h3><span className="pill good">zmrazeno před Supabase</span></div><div className="stack">{rolePolicies.map((r) => <div className="log" key={r.role}><b>{r.role}</b><br /><span className="muted">{r.can}</span></div>)}</div></div>
    <div className="card" style={{ marginTop: 16 }}><div className="section-title"><h3>Datový model pro Supabase</h3><span className="pill good">připraveno</span></div><p className="muted">Před napojením online databáze už aplikace používá stabilní strukturu: drivers, vehicles, shifts, availability, absences, service_blocks, swap_requests, notifications, attendance, audit_log a push_subscriptions.</p></div>
  </>
}


function weekText(data, helpers, weekStart) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const lines = [`RB TAXI – plán směn ${formatDate(weekStart)} až ${formatDate(addDays(weekStart, 6))}`, '']
  days.forEach((day) => {
    const shifts = sortByDateTime(data.shifts.filter((s) => s.date === day))
    lines.push(`${formatDate(day)}:`)
    if (!shifts.length) lines.push('  volno / bez směn')
    shifts.forEach((s) => {
      lines.push(`  ${s.start}–${s.end} · ${helpers.driverName(s.driverId)} · ${helpers.vehicleName(s.vehicleId)} · ${statusMap[s.status]}`)
      if (s.instruction) lines.push(`    Instrukce: ${s.instruction}`)
    })
    lines.push('')
  })
  return lines.join('\n')
}

function dayText(data, helpers, date) {
  const shifts = sortByDateTime(data.shifts.filter((s) => s.date === date))
  const lines = [`RB TAXI – plán ${formatDate(date)}`, '']
  if (!shifts.length) lines.push('Bez plánovaných směn.')
  shifts.forEach((s) => {
    const extra = s.declineReason ? ` · odmítnuto: ${s.declineReason}` : ''
    lines.push(`${s.start}–${s.end} · ${helpers.driverName(s.driverId)} · ${helpers.vehicleName(s.vehicleId)} · ${statusMap[s.status]}${extra}`)
    if (s.instruction) lines.push(`Instrukce: ${s.instruction}`)
  })
  return lines.join('\n')
}

function driverText(data, helpers, driverId) {
  const d = helpers.driver(driverId)
  const shifts = sortByDateTime(data.shifts.filter((s) => s.driverId === driverId && s.date >= todayISO() && s.status !== 'cancelled')).slice(0, 14)
  const lines = [`RB TAXI – tvoje směny${d ? ` (${d.name})` : ''}:`, '']
  if (!shifts.length) lines.push('Nemáš žádné plánované směny.')
  shifts.forEach((s) => {
    lines.push(`${formatDate(s.date)} ${s.start}–${s.end} · ${helpers.vehicleName(s.vehicleId)} · ${statusMap[s.status]}`)
    if (s.instruction) lines.push(`  Instrukce: ${s.instruction}`)
  })
  return lines.join('\n')
}
function backup(data) { download(`rbshift-zaloha-${todayISO()}.json`, JSON.stringify(data, null, 2)) }
function exportCSV(data, helpers) {
  const rows = [['Datum','Start','Konec','Řidič','Vozidlo','Typ','Stav','Poznámka','Instrukce','Důvod odmítnutí','Nástup','Ukončení','Reálný čas','Výměna','Kolize']]
  sortByDateTime(data.shifts).forEach((s) => rows.push([s.date, s.start, s.end, helpers.driverName(s.driverId), helpers.vehicleName(s.vehicleId), shiftTypeMap[s.type] || s.type, statusMap[s.status] || s.status, s.note || '', s.instruction || '', s.declineReason || '', s.actualStartAt || '', s.actualEndAt || '', durationLabel(actualDurationMinutes(s)), s.swapRequestStatus || '', helpers.conflictMessages(s).join(' | ')]))
  const csv = rows.map((r) => r.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';')).join('\n')
  download(`rbshift-smeny-${todayISO()}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8')
}


function Root() {
  installStyles()
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(isConfiguredSupabase)
  const [profileError, setProfileError] = useState('')

  const loadProfile = async (sess) => {
    if (!supabase || !sess?.user) { setProfile(null); setLoading(false); return }
    setLoading(true)
    setProfileError('')
    const { data, error } = await supabase.from('profiles').select('*').eq('id', sess.user.id).maybeSingle()
    if (error) setProfileError(error.message)
    setProfile(data ? { ...data, email: sess.user.email } : null)
    setLoading(false)
  }

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); loadProfile(data.session) })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => { setSession(sess); loadProfile(sess) })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!isConfiguredSupabase) return <App />
  if (loading) return <div className="auth-shell"><div className="card"><h2>RBSHIFT</h2><p className="muted">Načítám online režim…</p></div></div>
  if (!session) return <AuthGate />
  if (!profile) return <MissingProfile session={session} error={profileError} reload={() => loadProfile(session)} />
  return <App session={session} profile={profile} signOut={() => supabase.auth.signOut()} />
}

function AuthGate() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('login')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg('')
    try {
      const payload = { email, password }
      const res = mode === 'signup' ? await supabase.auth.signUp(payload) : await supabase.auth.signInWithPassword(payload)
      if (res.error) throw res.error
      setMsg(mode === 'signup' ? 'Účet je vytvořený. Pokud Supabase vyžaduje potvrzení e-mailu, potvrď ho a potom se přihlas.' : 'Přihlášeno.')
    } catch (err) { setMsg(err.message || String(err)) }
    setBusy(false)
  }
  return <div className="auth-shell"><div className="card auth-card"><div className="brand"><div className="logo">RB</div><div><h1>RBSHIFT</h1><small>Online přihlášení</small></div></div><form className="stack" onSubmit={submit}><Field label="E-mail"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field><Field label="Heslo"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></Field><button className="primary" disabled={busy}>{busy ? 'Pracuji…' : mode === 'login' ? 'Přihlásit' : 'Vytvořit účet'}</button></form><div className="row-actions" style={{ marginTop: 12 }}><button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'Vytvořit účet' : 'Mám účet – přihlásit'}</button></div>{msg && <p className="hintline">{msg}</p>}<p className="muted">Pro ostrý provoz vytvoř uživatele v Supabase Auth a v tabulce profiles mu nastav roli admin / dispatcher / driver.</p></div></div>
}

function MissingProfile({ session, error, reload }) {
  const [name, setName] = useState(session?.user?.email?.split('@')[0] || '')
  const [busy, setBusy] = useState(false)
  const createDriverProfile = async () => {
    setBusy(true)
    const { error } = await supabase.from('profiles').insert({ id: session.user.id, full_name: name || session.user.email, role: 'driver' })
    if (error) alert(error.message)
    await reload()
    setBusy(false)
  }
  return <div className="auth-shell"><div className="card auth-card"><h2>Chybí profil uživatele</h2><p className="muted">Přihlášení existuje, ale v tabulce <b>profiles</b> není záznam pro tento účet.</p>{error && <div className="alert bad">{error}</div>}<Field label="Jméno pro profil řidiče"><input value={name} onChange={(e) => setName(e.target.value)} /></Field><div className="row-actions" style={{ marginTop: 12 }}><button className="primary" disabled={busy} onClick={createDriverProfile}>Vytvořit profil řidiče</button><button onClick={reload}>Zkusit načíst znovu</button><button onClick={() => supabase.auth.signOut()}>Odhlásit</button></div><div className="alert warn" style={{ marginTop: 12 }}><b>První admin:</b><br />Po vytvoření účtu nastav v Supabase SQL editoru roli admin: <code>update public.profiles set role='admin' where id='USER_ID';</code></div></div></div>
}

createRoot(document.getElementById('root')).render(<Root />)
