import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient } from '@supabase/supabase-js'

const VERSION = '1.3.18-v5.5.3-driver-fixes-3-6'
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
  if (!notice || isNoticeDeleted(notice, currentDriver, isDriver)) return false
  if (!isDriver) return true
  if (notice.targetRole === 'all' || notice.targetRole === 'driver_all') return true
  return Boolean(currentDriver?.id && notice.targetDriverId === currentDriver.id)
}
function noticeUserKey(currentDriver, isDriver) {
  return isDriver ? `driver:${currentDriver?.id || ''}` : 'admin'
}
function isNoticeRead(notice, currentDriver, isDriver) {
  const key = noticeUserKey(currentDriver, isDriver)
  return (notice.readBy || []).includes(key)
}
function noticeDeletedKey(currentDriver, isDriver) {
  return `deleted:${noticeUserKey(currentDriver, isDriver)}`
}
function isNoticeDeleted(notice, currentDriver, isDriver) {
  const key = noticeDeletedKey(currentDriver, isDriver)
  return (notice.readBy || []).some((x) => x === key || String(x).startsWith(`${key}:`))
}
function markNoticeRead(notice, currentDriver, isDriver) {
  const key = noticeUserKey(currentDriver, isDriver)
  return { ...notice, readBy: [...new Set([...(notice.readBy || []), key])] }
}
function markNoticeDeleted(notice, currentDriver, isDriver) {
  const key = noticeDeletedKey(currentDriver, isDriver)
  const token = `${key}:${new Date().toISOString()}`
  // TODO: až bude v Supabase sloupec deleted_at, přepnout tento fallback z readBy tokenu na deleted_at/deleted_by.
  return { ...notice, readBy: [...new Set([...(notice.readBy || []).filter((x) => x !== key && !String(x).startsWith(`${key}:`)), token])] }
}
function unmarkNoticeDeleted(notice, currentDriver, isDriver) {
  const key = noticeDeletedKey(currentDriver, isDriver)
  return { ...notice, readBy: (notice.readBy || []).filter((x) => x !== key && !String(x).startsWith(`${key}:`)) }
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
const defaultShiftTimes = { dayStart: '07:00', dayEnd: '19:00', nightStart: '19:00', nightEnd: '07:00', eventStart: '18:00', eventEnd: '03:00' }
const defaultShiftTemplates = [
  { id: 'tpl_day', name: 'Denní', start: '07:00', end: '19:00', active: true, type: 'day' },
  { id: 'tpl_night', name: 'Noční', start: '19:00', end: '07:00', active: true, type: 'night' },
]
function configuredShiftTimes(settings = {}) {
  return { ...defaultShiftTimes, ...(settings.shiftTimes || {}) }
}
function inferShiftTemplateType(template = {}) {
  const name = String(template.name || '').toLowerCase()
  if (template.type && shiftTypeMap[template.type]) return template.type
  if (name.includes('noč')) return 'night'
  if (name.includes('den')) return 'day'
  return 'custom'
}
function normalizeShiftTemplates(settings = {}) {
  const legacy = configuredShiftTimes(settings)
  const source = Array.isArray(settings.shiftTemplates) && settings.shiftTemplates.length
    ? settings.shiftTemplates
    : [
      { ...defaultShiftTemplates[0], start: legacy.dayStart, end: legacy.dayEnd },
      { ...defaultShiftTemplates[1], start: legacy.nightStart, end: legacy.nightEnd },
    ]
  return source.map((tpl, index) => ({
    id: tpl.id || `tpl_${index + 1}`,
    name: String(tpl.name || `Šablona ${index + 1}`).trim(),
    start: String(tpl.start || '07:00').slice(0, 5),
    end: String(tpl.end || '19:00').slice(0, 5),
    active: tpl.active !== false,
    type: inferShiftTemplateType(tpl),
  }))
}
function shiftTemplateOptions(settings = {}) {
  const activeTemplates = normalizeShiftTemplates(settings).filter((tpl) => tpl.active)
  return {
    custom: 'Vlastní čas',
    ...Object.fromEntries(activeTemplates.map((tpl) => [tpl.id, `${tpl.name} ${tpl.start}–${tpl.end}`])),
  }
}
function shiftTemplateValue(key, settings = {}) {
  const template = normalizeShiftTemplates(settings).find((tpl) => tpl.id === key && tpl.active)
  if (!template) return null
  return { start: template.start, end: template.end, type: template.type || 'custom' }
}
const swapStatusMap = { pending: 'Nabídnuto', accepted: 'Přijato kolegou', approved: 'Schváleno', rejected: 'Zamítnuto', cancelled: 'Zrušeno řidičem' }
const weekdayMap = { 1: 'Po', 2: 'Út', 3: 'St', 4: 'Čt', 5: 'Pá', 6: 'So', 0: 'Ne' }
const pageTitleMap = { planner: 'Plán směn', dashboard: 'Dashboard', audit: 'Audit provozu', notifications: 'Notifikace', shifts: 'Seznam směn', drivers: 'Řidiči', vehicles: 'Vozidla', availability: 'Dostupnost', shiftTemplates: 'Šablony směn', history: 'Historie změn', settings: 'Nastavení' }

const dispatcherNavItems = [
  ['planner', 'Plán směn'],
  ['dashboard', 'Dashboard'],
  ['notifications', 'Notifikace'],
  ['audit', 'Audit provozu']
]
const adminNavItems = [
  ['drivers', 'Řidiči'],
  ['vehicles', 'Vozidla'],
  ['availability', 'Dostupnost'],
  ['shiftTemplates', 'Šablony směn'],
  ['history', 'Historie změn'],
  ['settings', 'Nastavení']
]
const adminPageKeys = new Set(adminNavItems.map(([key]) => key))

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
  availability: (a) => stripUndefined({ id: normalizeId(a.id, 'av'), driver_id: a.driverId, weekday: a.fromAt ? null : (a.date ? null : Number(a.weekday || 0)), avail_date: a.fromAt ? null : (a.date || null), from_at: a.fromAt || null, to_at: a.toAt || null, start_time: a.start || timePart(a.fromAt) || '00:00', end_time: a.end || timePart(a.toAt) || '23:59', note: a.note || null }),
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
  availability: (a) => ({ id: a.id, driverId: a.driver_id, weekday: a.weekday === null || a.weekday === undefined ? '' : Number(a.weekday), date: a.avail_date || '', fromAt: a.from_at ? String(a.from_at).slice(0,16) : '', toAt: a.to_at ? String(a.to_at).slice(0,16) : '', start: String(a.start_time || '').slice(0,5), end: String(a.end_time || '').slice(0,5), note: a.note || '' }),
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
  if (!clean.length) return { skipped: true, reason: 'no-notifications' }
  if (!isConfiguredSupabase) return { skipped: true, reason: 'supabase-not-configured' }
  if (!import.meta.env.VITE_VAPID_PUBLIC_KEY) return { skipped: true, reason: 'missing-vapid-public-key' }
  try {
    const res = await fetch('/api/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
async function syncChangedRows(prev, next, profile) {
  if (!supabase || !profile) return
  const isStaff = ['admin','dispatcher'].includes(profile.role)
  const currentDriver = !isStaff ? (next.drivers || []).find((d) => d.profileId === profile.id || (d.email && profile.email && d.email.toLowerCase() === profile.email.toLowerCase())) : null
  const currentDriverId = currentDriver?.id || ''
  const allowedForDriver = new Set(['shifts','absences','availability','swapRequests','notifications','pushSubscriptions','audit'])
  const errors = []
  const critical = new Set(['shifts','swapRequests','notifications','pushSubscriptions'])
  for (const key of ONLINE_TABLES) {
    if (!isStaff && !allowedForDriver.has(key)) continue
    let changed = changedRows(prev[key], next[key])
    // Řidič nesmí přepisovat cizí směny. Převzetí výměny/volné směny se ukládá přes swap_requests.
    if (!isStaff && key === 'shifts') changed = changed.filter((row) => row.driverId === currentDriverId)
    const rows = changed.map(toDb[key]).filter((r) => r.id)
    if (rows.length) {
      const { error } = await supabase.from(tableName(key)).upsert(rows, { onConflict: 'id' })
      if (error) {
        errors.push(`${tableName(key)}: ${error.message}`)
        if (critical.has(key)) throw new Error(errors.join('\n'))
      }
    }
    if (isStaff) {
      const nextIds = new Set((next[key] || []).map((x) => x.id))
      const removed = (prev[key] || []).filter((x) => x.id && !nextIds.has(x.id)).map((x) => x.id)
      if (removed.length) {
        const { error } = await supabase.from(tableName(key)).delete().in('id', removed)
        if (error) {
          errors.push(`${tableName(key)} delete: ${error.message}`)
          if (critical.has(key)) throw new Error(errors.join('\n'))
        }
      }
    }
  }
  if (isStaff && JSON.stringify(prev.settings || {}) !== JSON.stringify(next.settings || {})) {
    const { error } = await supabase.from('app_settings').upsert({ id: 'default', payload: next.settings || {}, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    if (error) errors.push(`app_settings: ${error.message}`)
  }
  if (errors.length) throw new Error(errors.join('\n'))
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
      { id: 'sh_1', date: w, start: '07:00', end: '19:00', driverId: 'drv_roman', vehicleId: 'car_tesla_1', type: 'day', status: 'confirmed', note: 'Denní Hodonín', declineReason: '' },
      { id: 'sh_2', date: w, start: '14:00', end: '22:00', driverId: 'drv_petra', vehicleId: 'car_tesla_2', type: 'day', status: 'assigned', note: 'Odpolední špička', declineReason: '' },
      { id: 'sh_3', date: w, start: '19:00', end: '07:00', driverId: 'drv_milan', vehicleId: 'car_tesla_1', type: 'night', status: 'assigned', note: 'Noční provoz', declineReason: '' },
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
    settings: { companyName: 'RBSHIFT', mode: 'demo', lastBackupAt: '', mobileCompact: true, shiftTimes: { ...defaultShiftTimes }, coverageSlots: [
      { id: 'cov_day', name: 'Denní', start: '07:00', end: '19:00', minDrivers: 1 },
      { id: 'cov_night', name: 'Noční', start: '19:00', end: '07:00', minDrivers: 1 },
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
      availability: (parsed.availability || base.availability || []).map((a) => ({ fromAt: '', toAt: '', ...a })),
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
function deviceLabelFromUserAgent(value = '') {
  const ua = String(value || '')
  if (/iPhone/i.test(ua)) return '📱 iPhone (Safari)'
  if (/iPad/i.test(ua)) return '📱 iPad (Safari)'
  if (/Android/i.test(ua) && /Firefox/i.test(ua)) return '📱 Android (Firefox)'
  if (/Android/i.test(ua) && /Chrome/i.test(ua)) return '📱 Android (Chrome)'
  if (/Macintosh/i.test(ua) && /Chrome/i.test(ua)) return '💻 Mac (Chrome)'
  if (/Macintosh/i.test(ua) && /Safari/i.test(ua)) return '💻 Mac (Safari)'
  if (/Windows/i.test(ua) && /Edg/i.test(ua)) return '💻 Windows (Edge)'
  if (/Windows/i.test(ua) && /Chrome/i.test(ua)) return '💻 Windows (Chrome)'
  return '📱 Neznámé zařízení'
}
function datetimeLocal(date = todayISO(), value = '07:00') { return `${date}T${value}` }
function datePart(value) { return value ? String(value).slice(0, 10) : '' }
function timePart(value) { return value ? String(value).slice(11, 16) : '' }
function formatDateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function driverInitials(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'Ř'
  const first = parts[0]?.[0] || ''
  const last = parts.length > 1 ? (parts[1]?.[0] || '') : ''
  return `${first}${last}`.toUpperCase() || 'Ř'
}
function staffDisplayName(profile, currentDriver, role) {
  return profile?.name || profile?.fullName || profile?.full_name || currentDriver?.name || roleMap[role] || 'Uživatel'
}
function staffInitials(profile, currentDriver, role) {
  return driverInitials(staffDisplayName(profile, currentDriver, role))
}
const availabilityKindMap = {
  available: 'Dostupný',
  unavailable: 'Nedostupný',
  preferred: 'Preferuje',
}
const availabilityKindTone = {
  available: 'good',
  unavailable: 'bad',
  preferred: 'warn',
}
function availabilityKind(slot) {
  const match = String(slot?.note || '').match(/^\[(available|unavailable|preferred)\]/)
  return match?.[1] || 'available'
}
function availabilityNoteText(slot) {
  return String(slot?.note || '').replace(/^\[(available|unavailable|preferred)\]\s*/, '').trim()
}
function availabilityLabel(slot) {
  if (slot.fromAt || slot.toAt) return `${formatDateTime(slot.fromAt)} → ${formatDateTime(slot.toAt)}`
  return `${slot.date ? formatDate(slot.date) : weekdayMap[slot.weekday]} ${slot.start}–${slot.end}`
}
function availabilityRangeOverlaps(a, b) {
  if (!a?.fromAt || !a?.toAt || !b?.fromAt || !b?.toAt) return false
  const a1 = new Date(a.fromAt).getTime()
  const a2 = new Date(a.toAt).getTime()
  const b1 = new Date(b.fromAt).getTime()
  const b2 = new Date(b.toAt).getTime()
  return Number.isFinite(a1) && Number.isFinite(a2) && Number.isFinite(b1) && Number.isFinite(b2) && a1 < b2 && b1 < a2
}
function availabilityRelevantToShift(slot, shift) {
  if (slot.fromAt || slot.toAt) {
    const fromDate = datePart(slot.fromAt)
    const toDate = datePart(slot.toAt || slot.fromAt)
    return fromDate && toDate && dateInRange(shift.date, fromDate, toDate)
  }
  return slot.date ? slot.date === shift.date : Number(slot.weekday) === weekdayOf(shift.date)
}
function availabilityCoversShift(slot, shift) {
  if (slot.fromAt || slot.toAt) {
    if (!slot.fromAt || !slot.toAt) return false
    const [s1, s2] = intervalForShift(shift)
    const a1 = new Date(slot.fromAt).getTime()
    const a2 = new Date(slot.toAt).getTime()
    return Number.isFinite(a1) && Number.isFinite(a2) && a1 <= s1 && s2 <= a2
  }
  return overlapsTimeWindow(shift.start, shift.end, slot.start, slot.end)
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
  const openInterests = pendingSwaps.filter((r) => r.targetMode === 'open')
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
function firstNamePart(name = '') {
  return String(name || '').trim().split(/\s+/).filter(Boolean)[0] || ''
}
function lastInitialPart(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  return parts.length > 1 ? `${parts[parts.length - 1].slice(0, 1).toLocaleUpperCase('cs-CZ')}.` : ''
}
function calendarDriverLabel(driverId, data, helpers) {
  if (!driverId) return 'Volná směna'
  const fullName = helpers.driverName(driverId)
  const firstName = firstNamePart(fullName)
  if (!firstName || fullName === 'Bez řidiče') return fullName || 'Bez řidiče'
  const sameFirstNameCount = (data.drivers || []).filter((driver) => firstNamePart(driver.name).toLocaleLowerCase('cs-CZ') === firstName.toLocaleLowerCase('cs-CZ')).length
  const initial = lastInitialPart(fullName)
  return sameFirstNameCount > 1 && initial ? `${firstName} ${initial}` : firstName
}
function activeSwapForShift(shift, data = {}) {
  return (data.swapRequests || []).find((r) => r.shiftId === shift.id && ['pending','accepted'].includes(r.status))
}
function calendarShiftLineClass(shift, conflicts = [], activeSwap = null) {
  if (conflicts.length || ['declined', 'cancelled'].includes(shift.status)) return 'line-bad'
  if (activeSwap || ['pending','accepted'].includes(shift.swapRequestStatus)) return 'line-swap'
  if (['confirmed', 'completed'].includes(shift.status)) return 'line-good'
  if (shift.status === 'open') return 'line-open'
  return 'line-waiting'
}
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


.driver-mobile-view{max-width:980px}.driver-status-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}.driver-hero{margin-bottom:16px;border-color:rgba(245,199,106,.55);background:linear-gradient(180deg,rgba(245,199,106,.18),rgba(255,255,255,.045));}.driver-shift-card{display:grid;gap:12px}.driver-shift-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.driver-shift-head h3{font-size:clamp(28px,6vw,46px);line-height:1;margin:4px 0 6px;letter-spacing:-.045em}.driver-date{display:inline-flex;align-items:center;gap:7px;color:#fff3c7;font-weight:900;font-size:13px;letter-spacing:.02em}.driver-ok-mini{color:#8ff0c0;font-size:11px;font-weight:850;letter-spacing:0;text-transform:none;opacity:.78}.driver-instruction{border:1px solid rgba(72,213,151,.42);background:rgba(72,213,151,.11);border-radius:18px;padding:14px;color:#eafff6}.driver-note{margin:0}.driver-mini-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.driver-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px}.driver-actions button{min-height:52px}.driver-actions .soft-primary{background:linear-gradient(135deg,#d8fff0,#48d597);border-color:rgba(72,213,151,.72)}.driver-actions-compact{grid-template-columns:repeat(2,minmax(0,1fr))}.driver-push-warning{margin-bottom:16px}.driver-card-list{display:grid;gap:14px}.driver-list-title{margin-top:18px}.driver-offers{margin-bottom:16px}.device-list{display:grid;gap:8px;margin-top:12px}.device-row{display:flex;justify-content:space-between;gap:10px;align-items:center;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.035);padding:10px}.ios-guide{margin-top:12px;border:1px solid rgba(128,199,255,.32);background:rgba(128,199,255,.08);border-radius:16px;padding:12px}.ios-guide ol{margin:8px 0 0 20px;padding:0}.ios-guide li{margin:4px 0;color:#dbeafe}

.auth-shell{min-height:100vh;display:grid;place-items:center;padding:22px}.auth-card{width:min(520px,100%)}code{background:rgba(0,0,0,.25);padding:2px 5px;border-radius:6px}

@media (max-width:1150px){.drawer-grid{grid-template-columns:1fr}.sticky-card{position:relative;top:auto}.kpis,.two,.three,.four{grid-template-columns:1fr}.week-grid{grid-template-columns:repeat(7,minmax(210px,1fr))}}
@media (max-width:1000px){.app{grid-template-columns:1fr}.sidebar{position:relative;height:auto}.main{padding:16px}.nav{grid-template-columns:repeat(3,minmax(0,1fr))}.nav button{text-align:center}.topbar{display:grid}.actions{justify-content:flex-start}.form,.form.two-col{grid-template-columns:1fr}.field.span2,.field.span3,.field.span4{grid-column:auto}.table{min-width:760px}}

/* v5.5.3 follow-up fixes 3–6: driver header avatar, CTA hierarchy and compact chips */
.driver-actions{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.driver-actions .driver-primary-action{grid-column:1/-1;width:100%;min-height:58px}.driver-quick-strip:empty{display:none}.quick-chip{cursor:pointer}.quick-chip:focus-visible{outline:2px solid rgba(245,199,106,.55);outline-offset:2px}.driver-calendar-card .section-title .pill{cursor:pointer}
@media (max-width:640px){.sidebar{padding:14px}.nav{grid-template-columns:repeat(2,minmax(0,1fr))}.nav button{padding:10px}.brand h1{font-size:16px}.card{border-radius:20px;padding:14px}.topbar h2{font-size:28px}.kpi .value{font-size:26px}.row-actions button,.ghost,.primary,.danger{width:100%;justify-content:center;text-align:center}.actions{width:100%}.week-grid{grid-template-columns:1fr}.day{min-height:auto}.hide-mobile{display:none}.mobile-day-head{display:block;color:var(--muted);font-size:12px}.planner-filter{grid-template-columns:1fr}.toolbar .searchbox{max-width:none}.quick-item{display:grid}}
/* v5.4.5 UX cleanup */
.minzero{min-width:0}.compact-card{padding:16px}.compact-kpis .kpi .value{font-size:26px}.calendar-card{overflow:hidden}.two-week-calendar{display:grid;gap:18px;min-width:0}.week-block{display:grid;gap:10px;min-width:0}.week-block-title{position:sticky;top:86px;z-index:18;display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:13px;padding:8px 10px;border:1px solid var(--line);border-radius:16px;background:rgba(8,17,31,.94);backdrop-filter:blur(14px)}.week-grid{grid-template-columns:repeat(7,minmax(0,1fr));overflow:visible;gap:10px}.day{min-width:0;min-height:210px;padding:10px}.day h4{font-size:14px;position:relative}.day-menu{position:relative}.day-menu>summary{list-style:none;width:30px;height:30px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.045);color:var(--muted);display:grid;place-items:center;cursor:pointer}.day-menu>summary::-webkit-details-marker{display:none}.day-menu-panel{position:absolute;right:0;top:34px;z-index:22;min-width:150px;border:1px solid var(--line);border-radius:14px;background:#0b1423;box-shadow:var(--shadow);padding:6px}.day-menu-panel button{width:100%;border:0;border-radius:10px;background:transparent;color:var(--text);padding:8px 10px;text-align:left}.day-menu-panel button:hover{background:rgba(245,199,106,.12)}.calendar-empty{padding:7px 9px!important;border-radius:12px;font-size:12px;min-height:0}.shift-summary{min-width:0}.shift-summary-main{min-width:0}.shift-summary-main b,.shift-summary-main span{overflow:hidden;text-overflow:ellipsis}.shift-summary-side .pill{max-width:110px;justify-content:center}.drawer-grid{grid-template-columns:minmax(0,1fr) minmax(320px,380px)}.sticky-card{max-height:calc(100vh - 36px);overflow:auto}.collapse-card{padding:0;overflow:hidden}.collapse-card summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 18px}.collapse-card summary::-webkit-details-marker{display:none}.collapse-card summary span:first-child{display:grid;gap:3px}.collapse-card summary small{color:var(--muted);font-weight:500}.history-item summary{padding:13px 14px}.history-item .collapse-content{padding:0 14px 14px}.collapse-content{padding:0 18px 18px}.compact-table .table{min-width:620px}.compact-table .table th,.compact-table .table td{padding:9px 10px}.compact-sidebox{padding:10px}.compact-sidebox button{padding:7px 10px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.05);color:var(--text)}
@media (max-width:1350px){.drawer-grid{grid-template-columns:1fr}.sticky-card{position:relative;top:auto;max-height:none}.week-grid{grid-template-columns:repeat(7,minmax(112px,1fr))}.day{min-height:170px}.shift-summary{display:grid}.shift-summary-side{align-items:flex-start}.compact-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:760px){.week-grid{grid-template-columns:1fr}.week-block-title{display:grid}.compact-kpis{grid-template-columns:1fr}.driver-status-grid,.driver-mini-grid,.driver-actions{grid-template-columns:1fr}.planner-filter{grid-template-columns:1fr}}

/* v5.4.7 senior layout/refactor */
html,body,#root{width:100%;max-width:100%;overflow-x:hidden}.main,.card,.drawer-grid,.calendar-card,.week-block,.week-grid,.day,.shift-card,.table-wrap{min-width:0;max-width:100%}.main{overflow:hidden}.table-wrap{max-width:100%;overflow:auto}.week-grid{width:100%;overflow:hidden}.shift-summary{width:100%;border:0;background:transparent;color:inherit;text-align:left;padding:0;display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.shift-summary-main,.shift-summary-side{display:grid;gap:4px;min-width:0}.shift-summary-main span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.compact-flags{display:flex;gap:6px;flex-wrap:wrap}.modal-backdrop{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.58);display:grid;place-items:center;padding:18px}.modal-card{width:min(720px,100%);max-height:calc(100vh - 36px);overflow:auto}.compact-list{max-height:calc(100vh - 240px);overflow:auto;padding-right:4px}.compact-note{margin:8px 0 0}.driver-status-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:16px}.driver-card-list,.driver-offers{margin-top:16px}.driver-shift-card{border-color:rgba(245,199,106,.25)}.driver-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.driver-mini-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.soft-primary{background:rgba(72,213,151,.18);color:#d8fff0;border-color:rgba(72,213,151,.45)}
@media (max-width:1350px){.drawer-grid{grid-template-columns:1fr}.sticky-card{position:relative;top:auto;max-height:none}.week-grid{grid-template-columns:repeat(7,minmax(96px,1fr));overflow:hidden}.day{min-height:170px}.compact-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:900px){.week-grid{grid-template-columns:1fr}.driver-status-grid,.driver-mini-grid,.driver-actions{grid-template-columns:1fr}.compact-list{max-height:none}.modal-card{max-height:calc(100vh - 20px)}}

/* v5.4.8 driver mobile priority UX */
/* v5.4.9 TASK 1: driver PWA safe-area guard for iOS notch/Dynamic Island and Android status bar */
.driver-app-shell .main{padding-top:calc(24px + env(safe-area-inset-top,0px));padding-right:max(24px,env(safe-area-inset-right,0px));padding-bottom:calc(24px + env(safe-area-inset-bottom,0px));padding-left:max(24px,env(safe-area-inset-left,0px))}
.driver-app-shell .sidebar{padding-right:max(22px,env(safe-area-inset-right,0px));padding-bottom:calc(22px + env(safe-area-inset-bottom,0px));padding-left:max(22px,env(safe-area-inset-left,0px))}
.driver-priority-view{max-width:760px;margin:0 auto;display:grid;gap:14px}.driver-mobile-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:0}.driver-mobile-head div{display:grid;gap:2px;min-width:0}.driver-mobile-head span{color:var(--muted);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}.driver-mobile-head b{font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.driver-mobile-head .ghost{padding:9px 12px;border-radius:14px}.driver-priority-view .driver-hero{margin-bottom:0}.driver-empty-focus{margin-bottom:0}.driver-quick-strip{display:flex;gap:8px;overflow-x:auto;padding:2px 1px 4px;scrollbar-width:none}.driver-quick-strip::-webkit-scrollbar{display:none}.quick-chip{flex:0 0 auto;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.055);color:var(--muted);padding:8px 10px;font-size:12px;font-weight:850;white-space:nowrap}.quick-chip.warn{color:#fff3c7;border-color:rgba(255,207,90,.45);background:rgba(255,207,90,.12)}.driver-open-shifts{margin-top:0}.driver-open-shifts summary{padding:14px 16px}.driver-open-shifts .collapse-content{padding:0 16px 16px}.driver-priority-view .driver-list-title{margin-top:4px}.driver-priority-view .driver-card-list{margin-top:0}.driver-shift-compact-card{width:100%;min-height:80px;padding:14px 16px;text-align:left;cursor:pointer}.driver-compact-main{display:flex;justify-content:space-between;align-items:center;gap:12px;min-width:0}.driver-compact-main>div:first-child{min-width:0}.driver-compact-title{display:block;color:#fff3c7;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.driver-shift-compact-card .muted{margin:5px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.driver-shift-status-row{display:flex;align-items:center;gap:8px;flex:0 0 auto}.driver-card-toggle{border:1px solid var(--line);background:rgba(255,255,255,.06);color:#fff3c7;border-radius:999px;min-width:34px;height:34px;display:inline-grid;place-items:center;font-weight:900;line-height:1;padding:0}.driver-card-toggle:hover{border-color:rgba(245,199,106,.55);background:rgba(245,199,106,.12)}
@media (max-width:1000px){.driver-app-shell{display:flex;flex-direction:column}.driver-app-shell .main{order:1}.driver-app-shell .sidebar{order:2;position:relative;top:auto;height:auto;max-height:none;overflow:visible;border-right:0;border-top:1px solid var(--line);padding-top:14px;padding-bottom:calc(22px + env(safe-area-inset-bottom,0px))}.driver-app-shell .brand{margin-bottom:10px}.driver-app-shell .nav{grid-template-columns:repeat(3,minmax(0,1fr));margin-top:10px}.driver-app-shell .compact-sidebox{margin-top:10px}}
/* v5.5.0 driver-only refactor: IA, bottom nav, safe-area, compact UX */
.driver-shell-v2{min-height:100vh;min-height:100dvh;background:inherit;color:var(--text);padding-bottom:calc(82px + env(safe-area-inset-bottom,0px));overflow-x:hidden}
.driver-shell-v2{min-height:100vh;background:#08111f;overflow-x:hidden}.driver-topbar-v2{position:sticky;top:0;z-index:40;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:calc(10px + env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) 10px max(16px,env(safe-area-inset-left,0px));background:#08111f;border-bottom:1px solid var(--line);box-shadow:0 10px 28px rgba(0,0,0,.18)}.driver-topbar-v2::before{content:"";position:absolute;left:0;right:0;top:calc(-1 * env(safe-area-inset-top,0px));height:env(safe-area-inset-top,0px);background:#08111f;pointer-events:none}
.driver-topbar-brand{display:flex;align-items:center;gap:10px;min-width:0}.driver-topbar-brand strong{display:block;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.driver-topbar-brand small{display:block;color:var(--muted);font-size:12px}.compact-logo{width:38px;height:38px;border-radius:14px;flex:0 0 auto}.driver-avatar-img{width:38px;height:38px;border-radius:14px;object-fit:cover;flex:0 0 auto;border:1px solid rgba(245,199,106,.35)}.driver-main-v2{width:100%;max-width:820px;margin:0 auto;padding:14px max(14px,env(safe-area-inset-right,0px)) 18px max(14px,env(safe-area-inset-left,0px));overflow-x:hidden}.driver-bottom-nav{position:fixed;left:0;right:0;bottom:0;z-index:30;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:8px max(10px,env(safe-area-inset-right,0px)) calc(8px + env(safe-area-inset-bottom,0px)) max(10px,env(safe-area-inset-left,0px));background:rgba(8,17,31,.96);border-top:1px solid var(--line);backdrop-filter:blur(18px)}.driver-bottom-nav button{position:relative;border:1px solid transparent;background:transparent;color:var(--muted);border-radius:14px;padding:8px 4px 7px;display:grid;gap:2px;place-items:center}.driver-bottom-nav button span{font-size:17px;line-height:1}.driver-bottom-nav button b{font-size:11px}.driver-bottom-nav button.active{color:var(--text);background:rgba(255,255,255,.065);border-color:var(--line)}.driver-bottom-nav em{position:absolute;top:2px;right:12px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:rgba(255,207,90,.95);color:#07101d;font-style:normal;font-size:11px;font-weight:950;display:grid;place-items:center}.driver-priority-view{gap:12px}.driver-info-line{border:1px dashed rgba(255,255,255,.14);border-radius:14px;padding:10px 12px;color:var(--muted);background:rgba(255,255,255,.035);font-size:13px}.driver-calendar-card{overflow:hidden}.driver-week-block{display:grid;gap:8px;margin-top:12px}.driver-week-title{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:12px;font-weight:850;text-transform:uppercase;letter-spacing:.04em}.driver-week-title span{text-transform:none;letter-spacing:0;font-weight:700}.driver-week-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}.driver-day{min-width:0;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.045);color:var(--text);padding:8px 3px;display:grid;place-items:center;gap:2px}.driver-day b{font-size:10px;color:var(--muted)}.driver-day strong{font-size:16px}.driver-day small{min-height:14px;color:var(--gold);font-weight:950;letter-spacing:1px}.driver-day.today{outline:2px solid rgba(245,199,106,.45);background:rgba(245,199,106,.10)}.driver-calendar-legend{display:flex;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin:10px 0}.driver-calendar-modal-backdrop{z-index:120}.driver-calendar-modal{width:min(560px,100%);max-height:calc(100vh - 34px);display:flex;flex-direction:column;overflow:hidden}.driver-calendar-modal .section-title{flex:0 0 auto}.driver-calendar-modal-body{overflow:auto;padding-right:2px}.toast-undo{position:sticky;top:calc(54px + env(safe-area-inset-top,0px));z-index:18;display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--line);border-radius:16px;padding:10px 12px;background:rgba(8,17,31,.94);box-shadow:var(--shadow);margin-bottom:12px}.notification-row{overflow:hidden}.notification-actions{justify-content:flex-end}.notification-actions .danger-mini{display:inline-flex;align-items:center;justify-content:center}.driver-settings-view{display:grid;gap:14px}.driver-settings-view .topbar{margin-bottom:0}
@media (max-width:640px){.driver-main-v2{padding-top:12px}.driver-shift-head h3{font-size:32px}.driver-week-grid{gap:4px}.driver-day{border-radius:12px;padding:7px 2px}.driver-day strong{font-size:15px}.driver-actions{grid-template-columns:1fr 1fr}.driver-bottom-nav{gap:4px}.driver-bottom-nav button b{font-size:10px}}
@media (max-width:640px){.driver-mobile-head .ghost{width:auto}.driver-priority-view{gap:12px}.driver-shift-head h3{font-size:34px}.driver-actions{grid-template-columns:1fr 1fr}.driver-actions button{min-height:48px}.driver-mini-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.driver-mini-grid .kpi{padding:10px}.driver-mini-grid .kpi .value{font-size:20px}.driver-open-shifts summary{align-items:flex-start}.driver-app-shell .nav button{padding:10px 8px;font-size:13px}}


/* TASK 3 role-based sidebar navigation */
.sidebar-nav{display:grid;gap:20px}.nav-section{display:grid;gap:8px}.nav-section-title{padding:0 4px;color:var(--muted);font-size:11px;font-weight:950;letter-spacing:.12em}.sidebar-footer{margin-top:auto;padding:10px 4px 0;color:var(--muted);font-size:12px;display:grid;gap:5px}.sync-line{display:flex;align-items:center;gap:8px}.sidebar-footer small{display:block;color:var(--muted);line-height:1.35}.app-with-topbar .sidebar .sidebar-nav .nav{margin-top:0}

/* TASK 2 app top bar */
.app-with-topbar{grid-template-columns:286px 1fr;grid-template-rows:74px 1fr}.app-with-topbar .app-topbar-shell{grid-column:1/-1;grid-row:1}.app-with-topbar .sidebar{grid-column:1;grid-row:2;top:74px;height:calc(100vh - 74px);display:flex;flex-direction:column;justify-content:space-between}.app-with-topbar .main{grid-column:2;grid-row:2}.app-topbar-shell{position:sticky;top:0;z-index:50;min-height:74px;padding:12px 22px;border-bottom:1px solid var(--line);background:rgba(8,17,31,.92);backdrop-filter:blur(18px);display:flex;align-items:center;justify-content:space-between;gap:16px}.app-topbar-brand,.app-topbar-actions{display:flex;align-items:center;gap:12px;min-width:0}.app-topbar-logo{width:46px;height:46px;border:0;border-radius:16px;background:linear-gradient(135deg,var(--gold),var(--gold2));color:#07101d;display:grid;place-items:center;font-weight:950;box-shadow:0 12px 34px rgba(245,199,106,.22);flex:0 0 auto}.app-topbar-title{border:0;background:transparent;color:var(--text);display:flex;align-items:center;gap:9px;min-width:0;padding:0;text-align:left}.app-topbar-title strong{font-size:17px;white-space:nowrap}.app-topbar-title span{color:var(--muted)}.app-topbar-title b{font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.topbar-menu-wrap{position:relative}.topbar-icon-button,.topbar-user-button{border:1px solid var(--line);background:rgba(255,255,255,.045);color:var(--text);border-radius:16px;min-height:44px;padding:9px 12px;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:.18s ease}.topbar-icon-button:hover,.topbar-user-button:hover{border-color:rgba(245,199,106,.55);transform:translateY(-1px)}.topbar-icon-button span{min-width:22px;height:22px;border-radius:999px;background:var(--gold);color:#07101d;font-size:12px;font-weight:950;display:grid;place-items:center;padding:0 6px}.topbar-icon-button:disabled,.topbar-user-button:disabled,.topbar-dropdown button:disabled{opacity:.45;cursor:not-allowed;transform:none}.topbar-user-button span{width:28px;height:28px;border-radius:999px;background:rgba(245,199,106,.18);border:1px solid rgba(245,199,106,.35);display:grid;place-items:center;color:#fff3c7;font-size:12px;font-weight:950}.topbar-user-button b{max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.topbar-user-button em{font-style:normal;color:var(--muted)}.topbar-dropdown{position:absolute;right:0;top:calc(100% + 10px);z-index:70;width:min(360px,calc(100vw - 28px));border:1px solid var(--line);border-radius:18px;background:#0b1423;box-shadow:var(--shadow);padding:12px;display:grid;gap:10px}.topbar-dropdown-list{display:grid;gap:8px;max-height:320px;overflow:auto}.topbar-dropdown-list button,.user-dropdown button{border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.045);color:var(--text);padding:10px 12px;text-align:left;display:grid;gap:4px}.topbar-dropdown-list button:hover,.user-dropdown button:hover{border-color:rgba(245,199,106,.45)}.topbar-dropdown-list strong{font-size:13px}.topbar-dropdown-list small{color:var(--muted);line-height:1.35}.topbar-dropdown-action{width:100%;justify-content:center}.user-dropdown{width:220px}.app-with-topbar .sidebar .nav{margin-top:0}.app-with-topbar .sidebar .sidebox{margin-top:auto}
@media (max-width:1000px){.app-with-topbar{display:grid;grid-template-columns:1fr;grid-template-rows:auto auto 1fr}.app-with-topbar .app-topbar-shell{grid-row:1;position:sticky}.app-with-topbar .sidebar{grid-column:1;grid-row:2;position:relative;top:auto;height:auto;padding:14px}.app-with-topbar .main{grid-column:1;grid-row:3}.app-topbar-shell{padding:10px 14px;align-items:flex-start}.app-topbar-actions{margin-left:auto}.topbar-user-button b,.app-topbar-title strong{display:none}}
@media (max-width:640px){.app-topbar-shell{gap:10px}.app-topbar-logo{width:40px;height:40px;border-radius:14px}.topbar-icon-button,.topbar-user-button{min-height:40px;padding:8px 10px}.topbar-user-button span{width:24px;height:24px}.app-topbar-title b{max-width:130px}.topbar-dropdown{right:-54px}}

/* TASK 1 calendar shift readability */
.calendar-shift-card{width:100%;border:1px solid var(--line);border-left-width:4px;text-align:left;color:var(--text);gap:3px;line-height:1.25;overflow:visible;background:rgba(0,0,0,.18);padding:8px 9px;margin-bottom:7px}
.calendar-shift-card:hover{border-color:rgba(245,199,106,.45);transform:translateY(-1px)}
.calendar-shift-card.line-good{border-left-color:var(--good)}
.calendar-shift-card.line-open{border-left-color:var(--warn)}
.calendar-shift-card.line-waiting{border-left-color:#ff9f43}
.calendar-shift-card.line-swap{border-left-color:var(--blue);background:rgba(128,199,255,.10)}
.calendar-shift-card.line-bad{border-left-color:var(--bad)}
.calendar-shift-time,.calendar-shift-driver,.calendar-shift-conflict,.calendar-shift-swap{display:block;overflow:visible;text-overflow:clip;white-space:nowrap;max-width:none}
.calendar-shift-time{font-weight:950;font-size:13px;letter-spacing:-.01em}
.calendar-shift-driver{font-weight:850;color:#f3f7ff}
.calendar-shift-conflict{font-size:12px;color:#ffdede;font-weight:850}
.calendar-shift-swap{font-size:12px;color:#cfeaff;font-weight:900}


/* TASK 4 new shift drawer */
.planner-main-grid{display:grid;gap:16px}.shift-drawer-backdrop{position:fixed;inset:0;z-index:90;background:rgba(2,6,12,.58);backdrop-filter:blur(8px);display:flex;justify-content:flex-end}.shift-drawer{width:400px;max-width:100vw;height:100vh;border-left:1px solid var(--line);background:linear-gradient(180deg,rgba(11,20,35,.98),rgba(8,17,31,.98));box-shadow:var(--shadow);display:flex;flex-direction:column}.shift-drawer-head{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--line);background:rgba(8,17,31,.96);backdrop-filter:blur(16px)}.shift-drawer-head h3{margin:0;font-size:19px}.shift-drawer-body{padding:18px;overflow:auto}.shift-form-panel{display:grid;gap:0}.drawer-form-actions{display:flex;flex-direction:row;gap:10px;align-items:center}.drawer-form-actions button{flex:1}.planner-toast{position:fixed;right:22px;bottom:22px;z-index:110;border:1px solid rgba(72,213,151,.45);border-radius:16px;background:rgba(8,17,31,.96);box-shadow:var(--shadow);color:#d8fff0;padding:12px 14px;font-weight:850}.planner-main-grid .calendar-card{min-width:0;overflow:visible}
@media (max-width:1000px){.shift-drawer-backdrop{justify-content:center}.shift-drawer{width:100%;border-left:0}.shift-drawer-head{padding:14px}.shift-drawer-body{padding:14px}.drawer-form-actions{flex-direction:column}.drawer-form-actions button{width:100%}}

/* TASK 5 compact KPI bar */
.planner-kpi-bar{display:flex;align-items:center;gap:10px;min-height:54px;max-height:60px;margin-bottom:12px;padding:10px 12px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.035));box-shadow:var(--shadow);overflow-x:auto}.planner-kpi-context,.planner-kpi-item,.planner-kpi-reset{height:34px;display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:999px;padding:0 11px;background:rgba(255,255,255,.045);color:var(--text);white-space:nowrap}.planner-kpi-context{color:#f7dfac;background:rgba(245,199,106,.09);border-color:rgba(245,199,106,.28)}.planner-kpi-item{transition:.18s ease}.planner-kpi-item b{font-weight:950}.planner-kpi-item span,.planner-kpi-reset{font-size:12px;color:var(--muted);font-weight:850}.planner-kpi-item:not(.passive):hover,.planner-kpi-reset:hover{border-color:rgba(245,199,106,.55);transform:translateY(-1px)}.planner-kpi-item.passive{cursor:default}.planner-kpi-item.danger{color:#ffdede;border-color:rgba(255,107,107,.45);background:rgba(255,107,107,.10)}.planner-kpi-item.danger span{color:#ffdede}.planner-kpi-item.danger.active{box-shadow:0 0 0 3px rgba(255,107,107,.14)}.planner-kpi-item.missing{color:#fff3c7;border-color:rgba(255,207,90,.42);background:rgba(255,207,90,.10)}.planner-kpi-item.missing span{color:#fff3c7}.planner-kpi-item.missing button{border:0;background:transparent;color:var(--gold);font-weight:950;padding:0 0 0 5px}.planner-kpi-reset{background:rgba(245,199,106,.08);color:#f7dfac}.planner-kpi-detail{margin:-2px 0 16px}.missing-coverage-table{max-height:50vh}.missing-coverage-table .table{min-width:720px}.audit-table-scroll{max-height:50vh;overflow:auto}
@media (max-width:900px){.planner-kpi-bar{max-height:none;flex-wrap:wrap}.planner-kpi-context,.planner-kpi-item,.planner-kpi-reset{height:32px}.week-block-title{top:0}}
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

  const commit = (updater, text, options = {}) => {
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
            options.onSuccess?.()
          })
          .catch((err) => {
            if (options.rollbackOnError) {
              writeStore(prev)
              setData(prev)
            }
            setSyncState((s) => ({ ...s, saving: false, error: err.message || String(err) }))
            options.onError?.(err)
          })
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
    const availability = shift.driverId ? (data.availability || []).filter((a) => a.driverId === shift.driverId && availabilityRelevantToShift(a, shift)) : []
    if (availability.length && !availability.some((a) => availabilityCoversShift(a, shift))) {
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
    if (isDriver && !['driver', 'notifications', 'availability', 'driverSettings'].includes(page)) setPage('driver')
    if (!isDriver && page === 'driver') setPage('planner')
    if (!isDriver && role !== 'admin' && adminPageKeys.has(page)) setPage('planner')
  }, [isDriver, page, role])

  const unreadNotifications = (data.notifications || []).filter((n) => isNoticeVisible(n, currentDriver, isDriver) && !isNoticeRead(n, currentDriver, isDriver))
  const unreadForCurrent = unreadNotifications.length
  const canOpenSettings = role === 'admin'
  const nav = isDriver
    ? [['driver', 'Domů', '⌂'], ['availability', 'Dostupnost', '◷'], ['notifications', 'Notifikace', '●'], ['driverSettings', 'Settings', '⚙']]
    : dispatcherNavItems
  const sidebarSections = [
    ['DISPEČINK', dispatcherNavItems],
    ...(role === 'admin' ? [['ADMIN', adminNavItems]] : [])
  ]

  if (isDriver) return <div className="driver-shell-v2">
    <header className="driver-topbar-v2">
      <div className="driver-topbar-brand">{(currentDriver?.avatarUrl || currentDriver?.avatar_url) ? <img className="driver-avatar-img" src={currentDriver.avatarUrl || currentDriver.avatar_url} alt={currentDriver?.name || 'Řidič'} /> : <div className="logo compact-logo">{driverInitials(currentDriver?.name || 'Řidič')}</div>}<div><strong>{currentDriver?.name || 'Řidič'}</strong><small>{onlineMode ? 'Online' : 'Demo'}</small></div></div>
      <span className={onlineMode ? 'pill good' : 'pill warn'}>{onlineMode ? 'Online ●' : 'Demo'}</span>
    </header>
    <main className="driver-main-v2">
      {page === 'driver' && <DriverHome data={data} helpers={helpers} commit={commit} currentDriver={currentDriver} onOpenNotifications={() => setPage('notifications')} />}
      {page === 'notifications' && <NotificationsView data={data} helpers={helpers} commit={commit} currentDriver={currentDriver} isDriver={isDriver} profile={profile} />}
      {page === 'availability' && <Availability data={data} commit={commit} currentDriver={currentDriver} />}
      {page === 'driverSettings' && <DriverSettings data={data} commit={commit} currentDriver={currentDriver} profile={profile} onlineMode={onlineMode} signOut={signOut} syncState={syncState} />}
    </main>
    <nav className="driver-bottom-nav" aria-label="Řidičská navigace">
      {nav.map(([key, label, icon]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => setPage(key)}><span>{icon}</span><b>{label}</b>{key === 'notifications' && unreadForCurrent > 0 && <em>{unreadForCurrent}</em>}</button>)}
    </nav>
  </div>

  return <div className="app app-with-topbar">
    <AppTopBar
      title={pageTitleMap[page] || 'Plán směn'}
      companyName={data.settings?.companyName || 'RB TAXI'}
      unreadCount={unreadForCurrent}
      notifications={unreadNotifications}
      profile={profile}
      currentDriver={currentDriver}
      role={role}
      canOpenSettings={canOpenSettings}
      signOut={signOut}
      setPage={setPage}
    />
    <aside className="sidebar">
      <nav className="sidebar-nav" aria-label="Hlavní navigace">
        {sidebarSections.map(([sectionTitle, items]) => <div className="nav-section" key={sectionTitle}>
          <div className="nav-section-title">{sectionTitle}</div>
          <div className="nav">{items.map(([key, label]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => setPage(key)}>{label}</button>)}</div>
        </div>)}
      </nav>
      <div className="sidebar-footer" aria-label="Stav úložiště">
        <div className="sync-line"><span className={onlineMode ? 'status-dot good' : 'status-dot warn'}></span><span>{onlineMode ? 'Supabase online' : 'Demo / localStorage'}</span></div>
        {onlineMode ? <small>{syncState?.saving ? 'Sync: ukládám…' : syncState?.lastSyncAt ? `Sync ${new Date(syncState.lastSyncAt).toLocaleTimeString('cs-CZ')}` : 'Sync aktivní'}</small> : <small>Lokální demo režim</small>}
        {syncState?.error && <small className="danger-mini-text">{syncState.error}</small>}
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
      {page === 'availability' && <Availability data={data} commit={commit} currentDriver={null} />}
      {page === 'shiftTemplates' && <ShiftTemplates data={data} commit={commit} />}
      {page === 'history' && <History data={data} />}
      {page === 'settings' && <Settings data={data} commit={commit} supabase={supabase} onlineMode={onlineMode} reloadOnline={reloadOnline} profile={profile} />}
    </main>
  </div>
}

function AppTopBar({ title, companyName, unreadCount, notifications, profile, currentDriver, role, canOpenSettings, signOut, setPage }) {
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const displayName = staffDisplayName(profile, currentDriver, role)
  const unreadItems = (notifications || []).slice(0, 6)
  const openNotifications = () => {
    setNotificationsOpen((value) => !value)
    setUserMenuOpen(false)
  }
  const openUserMenu = () => {
    setUserMenuOpen((value) => !value)
    setNotificationsOpen(false)
  }
  const goSettings = () => {
    if (!canOpenSettings) return
    setPage('settings')
    setUserMenuOpen(false)
  }
  return <header className="app-topbar-shell">
    <div className="app-topbar-brand">
      <button className="app-topbar-logo" onClick={() => setPage('planner')} aria-label="Přejít na Plán směn">RB</button>
      <button className="app-topbar-title" onClick={() => setPage('planner')}>
        <strong>{companyName}</strong><span>·</span><b>{title}</b>
      </button>
    </div>
    <div className="app-topbar-actions">
      <div className="topbar-menu-wrap">
        <button className="topbar-icon-button" aria-expanded={notificationsOpen} onClick={openNotifications}>🔔{unreadCount > 0 && <span>{unreadCount}</span>}</button>
        {notificationsOpen && <div className="topbar-dropdown notification-dropdown">
          <b>Nepřečtené notifikace</b>
          <div className="topbar-dropdown-list">
            {unreadItems.length ? unreadItems.map((n) => <button key={n.id} onClick={() => { setPage('notifications'); setNotificationsOpen(false) }}>
              <strong>{n.title}</strong>
              {n.body && <small>{n.body}</small>}
            </button>) : <p className="muted">Žádné nepřečtené notifikace.</p>}
          </div>
          <button className="ghost topbar-dropdown-action" onClick={() => { setPage('notifications'); setNotificationsOpen(false) }}>Zobrazit vše</button>
        </div>}
      </div>
      <div className="topbar-menu-wrap">
        <button className="topbar-user-button" aria-expanded={userMenuOpen} onClick={openUserMenu}><span>{staffInitials(profile, currentDriver, role)}</span><b>{displayName}</b><em>▾</em></button>
        {userMenuOpen && <div className="topbar-dropdown user-dropdown">
          <button onClick={goSettings} disabled={!canOpenSettings}>Profil</button>
          <button onClick={goSettings} disabled={!canOpenSettings}>Nastavení</button>
          <button onClick={() => { setUserMenuOpen(false); signOut?.() }} disabled={!signOut}>Odhlásit</button>
        </div>}
      </div>
      <button className="topbar-icon-button" aria-label="Nastavení" onClick={() => canOpenSettings && setPage('settings')} disabled={!canOpenSettings}>⚙️</button>
    </div>
  </header>
}
function PageTitle({ title, subtitle, children }) { return <div className="topbar"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{children && <div className="actions">{children}</div>}</div> }
function Kpi({ label, value, hint, kind = '' }) { return <div className="card kpi"><div className="label">{label}</div><div className="value">{value}</div>{hint && <div className={`hint ${kind}`}>{hint}</div>}</div> }

function PlannerKpiBar({ periodLabel, totalShifts, confirmedCount, conflictsCount, gapsCount, gapsOpen, conflictsOnly, onShowTable, onToggleConflicts, onToggleGaps }) {
  return <div className="planner-kpi-bar" aria-label="Souhrn plánu směn">
    <div className="planner-kpi-context"><span>📅</span><b>{periodLabel}</b></div>
    {totalShifts > 0 && <button type="button" className="planner-kpi-item" onClick={onShowTable}><b>{totalShifts}</b><span>směn</span></button>}
    {confirmedCount > 0 && <div className="planner-kpi-item passive"><b>{confirmedCount}</b><span>potvrzeno</span></div>}
    {conflictsCount > 0 && <button type="button" className={`planner-kpi-item danger ${conflictsOnly ? 'active' : ''}`} onClick={onToggleConflicts}><b>⚠ {conflictsCount}</b><span>kolize</span></button>}
    {gapsCount > 0 && <div className="planner-kpi-item missing"><b>{gapsCount}</b><span>chybí</span><button type="button" onClick={onToggleGaps}>{gapsOpen ? 'Sbalit ▴' : 'Rozbalit ▾'}</button></div>}
    {conflictsOnly && <button type="button" className="planner-kpi-reset" onClick={onToggleConflicts}>Zrušit filtr kolizí</button>}
  </div>
}
function StatusPill({ status, helpers }) { return <span className={`pill ${helpers.statusClass(status)}`}>{statusMap[status] || status}</span> }
function Field({ label, children, className = '' }) { return <div className={`field ${className}`}><label>{label}</label>{children}</div> }
function Select({ value, onChange, options }) { return <select value={value} onChange={(e) => onChange(e.target.value)}>{Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select> }
function Modal({ title, children, onClose }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="modal-card card"><div className="section-title"><h3>{title}</h3><button className="ghost" onClick={onClose}>Zavřít</button></div>{children}</div></div>
}
function SideDrawer({ title, open, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])
  if (!open) return null
  return <div className="shift-drawer-backdrop" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}>
    <aside className="shift-drawer" onMouseDown={(event) => event.stopPropagation()}>
      <div className="shift-drawer-head"><h3>{title}</h3><button className="ghost" type="button" onClick={onClose}>Zavřít</button></div>
      <div className="shift-drawer-body">{children}</div>
    </aside>
  </div>
}
function ConflictBox({ messages }) { return <div className="stack">{messages?.length ? messages.map((m, i) => <div key={i} className="alert bad">{m}</div>) : <div className="alert good">Bez kolize.</div>}</div> }

const blankShift = (date = todayISO(), settings = {}) => { const firstTemplate = normalizeShiftTemplates(settings).find((tpl) => tpl.active); const preset = firstTemplate ? shiftTemplateValue(firstTemplate.id, settings) : null; const t = configuredShiftTimes(settings); return ({ date, start: preset?.start || t.dayStart, end: preset?.end || t.dayEnd, driverId: '', vehicleId: '', type: preset?.type || 'day', status: 'assigned', note: '', instruction: '', declineReason: '', actualStartAt: '', actualEndAt: '', swapRequestStatus: '' }) }
function ShiftForm({ data, helpers, commit, initialDate, editing, setEditing, onSaved, onCancel, onDirtyChange, variant = 'card' }) {
  const [form, setForm] = useState(blankShift(initialDate, data.settings))
  const [repeat, setRepeat] = useState('none')
  const [template, setTemplate] = useState('custom')
  const [override, setOverride] = useState(false)
  useEffect(() => { if (!editing) setForm((f) => ({ ...f, date: initialDate })) }, [initialDate, editing])
  useEffect(() => { if (editing) { setForm({ ...blankShift(undefined, data.settings), ...editing }); setRepeat('none'); setTemplate('custom'); setOverride(false) } }, [editing])
  useEffect(() => {
    if (!onDirtyChange) return
    const baseline = editing ? { ...blankShift(undefined, data.settings), ...editing } : blankShift(initialDate, data.settings)
    const isDirty = JSON.stringify(form) !== JSON.stringify(baseline) || repeat !== 'none' || template !== 'custom' || override
    onDirtyChange(isDirty)
  }, [form, repeat, template, override, editing, initialDate, data.settings, onDirtyChange])
  const applyTemplate = (key) => {
    setTemplate(key)
    if (key === 'custom') return
    const preset = shiftTemplateValue(key, data.settings)
    if (preset) setForm((prev) => ({ ...prev, ...preset }))
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
    const wasEditing = Boolean(editing)
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
    setForm(blankShift(form.date, data.settings)); setRepeat('none'); setTemplate('custom'); setOverride(false); setEditing(null)
    onSaved?.({ editing: wasEditing })
  }
  return <div className={variant === 'drawer' ? 'shift-form-panel' : 'card sticky-card'}>
    {variant !== 'drawer' && <div className="section-title"><h3>{editing ? 'Upravit směnu' : 'Nová směna'}</h3>{editing && <button className="ghost" onClick={() => { setEditing(null); setForm(blankShift(initialDate, data.settings)) }}>Zrušit</button>}</div>}
    {editing && isPastLocked(editing) && <div className="alert warn" style={{ marginBottom: 12 }}>Minulá směna: úprava bude vyžadovat potvrzení.</div>}
    <form className="form two-col" onSubmit={submit}>
      <Field label="Šablona směny" className="span2"><Select value={template} onChange={applyTemplate} options={shiftTemplateOptions(data.settings)} /></Field>
      <Field label="Datum"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
      <Field label="Typ"><Select value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={shiftTypeMap} /></Field>
      <Field label="Začátek"><input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field>
      <Field label="Konec"><input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Field>
      <Field label="Řidič" className="span2"><select value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })}><option value="">Volná směna bez řidiče</option>{data.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{!d.active ? ' · neaktivní' : ''}</option>)}</select></Field>
      <Field label="Vozidlo" className="span2"><select value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}><option value="">Bez vozu / doplnit později</option>{data.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.plate}{!v.active ? ' · neaktivní' : ''}</option>)}</select></Field>
      <Field label="Stav"><Select value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={statusMap} /></Field>
      {!editing && <Field label="Opakování" className="span2"><Select value={repeat} onChange={setRepeat} options={repeatMap} /></Field>}
      <Field label="Poznámka pro plánovač" className="span2"><textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Např. letiště, záloha, firemní akce…" /></Field>
      <Field label="Instrukce pro řidiče" className="span2"><textarea value={form.instruction || ''} onChange={(e) => setForm({ ...form, instruction: e.target.value })} placeholder="Např. auto musí být čisté, bere terminál, SHKM, přesný čas odjezdu…" /></Field>
      {conflictMessages.length > 0 && <label className="field span2" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} style={{ width: 18 }} />Uložit i s kolizí / mimo dostupnost</label>}
      <div className="field span2 drawer-form-actions"><button className="primary" type="submit">Uložit</button><button className="ghost" type="button" onClick={onCancel}>Zrušit</button></div>
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
  const [gapsOpen, setGapsOpen] = useState(() => {
    try { return localStorage.getItem('rbshift-planner-gaps-open') === 'true' }
    catch { return false }
  })
  const [plannerView, setPlannerView] = useState('calendar')
  const [conflictsOnly, setConflictsOnly] = useState(false)
  const [shiftDrawerOpen, setShiftDrawerOpen] = useState(false)
  const [shiftFormDirty, setShiftFormDirty] = useState(false)
  const [plannerToast, setPlannerToast] = useState('')
  const days = Array.from({ length: 14 }, (_, i) => addDays(weekStart, i))
  const rangeEnd = addDays(weekStart, 13)
  const initialShiftDate = todayISO() >= weekStart && todayISO() <= rangeEnd ? todayISO() : weekStart
  const rangeAll = sortByDateTime(data.shifts.filter((s) => s.date >= weekStart && s.date <= rangeEnd))
  const rangeShifts = rangeAll.filter((s) => {
    const byDriver = driverFilter === 'all' || s.driverId === driverFilter
    const byVehicle = vehicleFilter === 'all' || s.vehicleId === vehicleFilter
    const byStatus = statusFilter === 'all' || (statusFilter === 'active' ? !['cancelled', 'declined'].includes(s.status) : s.status === statusFilter)
    return byDriver && byVehicle && byStatus
  })
  const conflicts = rangeAll.flatMap((s) => helpers.conflictMessages(s).map((message) => ({ shift: s, message })))
  const counts = statusCounts(rangeAll)
  const gaps = [...coverageGaps(data, weekStart), ...coverageGaps(data, addDays(weekStart, 7))]
  const visibleShifts = conflictsOnly ? rangeShifts.filter((s) => helpers.conflictMessages(s).length > 0) : rangeShifts
  const confirmedCount = rangeShifts.filter((s) => ['confirmed', 'completed'].includes(s.status)).length
  useEffect(() => {
    try { localStorage.setItem('rbshift-planner-gaps-open', String(gapsOpen)) }
    catch { }
  }, [gapsOpen])
  useEffect(() => {
    if (!plannerToast) return undefined
    const timer = setTimeout(() => setPlannerToast(''), 2800)
    return () => clearTimeout(timer)
  }, [plannerToast])
  const openNewShiftDrawer = () => {
    setEditing(null)
    setShiftFormDirty(false)
    setShiftDrawerOpen(true)
  }
  const openEditShiftDrawer = (shift) => {
    setEditing(shift)
    setShiftFormDirty(false)
    setShiftDrawerOpen(true)
  }
  const closeShiftDrawer = () => {
    setShiftDrawerOpen(false)
    setEditing(null)
    setShiftFormDirty(false)
  }
  const requestCloseShiftDrawer = () => {
    if (shiftFormDirty && !confirm('Formulář má neuložené změny. Opravdu zavřít?')) return
    closeShiftDrawer()
  }
  const handleShiftSaved = ({ editing: wasEditing } = {}) => {
    closeShiftDrawer()
    setPlannerToast(wasEditing ? 'Směna upravena.' : 'Směna vytvořena.')
  }
  const copyWeek = () => {
    const nextItems = rangeShifts.map((s) => ({ ...s, id: uid('sh'), date: addDays(s.date, 14), status: 'draft', declineReason: '', actualStartAt: '', actualEndAt: '', swapRequestStatus: '' }))
    if (!nextItems.length) return alert('Ve zobrazeném období nejsou žádné směny ke kopírování.')
    commit((prev) => ({ ...prev, shifts: [...nextItems, ...prev.shifts] }), `Zkopírováno zobrazené období na další 2 týdny: ${nextItems.length} směn.`)
    setWeekStart(addDays(weekStart, 14))
  }
  const copyToday = (date) => {
    const items = data.shifts.filter((s) => s.date === date).map((s) => ({ ...s, id: uid('sh'), date: addDays(date, 1), status: 'draft', declineReason: '', actualStartAt: '', actualEndAt: '', swapRequestStatus: '' }))
    if (!items.length) return alert('V daném dni nejsou žádné směny.')
    commit((prev) => ({ ...prev, shifts: [...items, ...prev.shifts] }), `Zkopírován den ${date} na další den.`)
  }
  const weeks = [weekStart, addDays(weekStart, 7)]
  return <>
    <PageTitle title="Plán směn">
      <button className="ghost" onClick={() => setWeekStart(addDays(weekStart, -14))}>← Předchozí</button>
      <button className="ghost" onClick={() => setWeekStart(startOfWeek(todayISO()))}>Dnes</button>
      <button className="ghost" onClick={() => setWeekStart(addDays(weekStart, 14))}>Další →</button>
      <button className="primary" onClick={openNewShiftDrawer}>+ Nová směna</button>
      <button className="primary" onClick={copyWeek}>Kopírovat 2 týdny</button>
      <button className="ghost" onClick={() => copyText(weekText({ ...data, shifts: rangeShifts }, helpers, weekStart, 14))}>WhatsApp</button>
    </PageTitle>
    <PlannerKpiBar
      periodLabel={`${formatDate(weekStart)}–${formatDate(rangeEnd)}`}
      totalShifts={rangeShifts.length}
      confirmedCount={confirmedCount}
      conflictsCount={conflicts.length}
      gapsCount={gaps.length}
      gapsOpen={gapsOpen}
      conflictsOnly={conflictsOnly}
      onShowTable={() => { setConflictsOnly(false); setPlannerView('table') }}
      onToggleConflicts={() => { setConflictsOnly((value) => !value); setPlannerView('calendar') }}
      onToggleGaps={() => setGapsOpen((value) => !value)}
    />
    {gaps.length > 0 && gapsOpen && <div className="card planner-kpi-detail">
      <div className="section-title"><h3>Chybí obsazení</h3><span className="pill bad">{gaps.length}</span></div>
      <div className="table-wrap missing-coverage-table"><table className="table"><thead><tr><th>Datum</th><th>Čas</th><th>Typ směny</th><th>Stav</th><th>Akce</th></tr></thead><tbody>{gaps.map((g) => <tr key={g.day + g.id}><td><b>{formatDate(g.day)}</b><br /><small>{g.day}</small></td><td>{g.start}–{g.end}</td><td>{g.name}</td><td><span className="pill bad">chybí {g.missing}</span><br /><small>plánováno {g.planned} z {g.minDrivers}</small></td><td><button className="ghost" type="button" onClick={() => { setPlannerView('calendar'); setShiftDrawerOpen(true); setShiftFormDirty(false); setEditing(null) }}>Vytvořit směnu</button></td></tr>)}</tbody></table></div>
    </div>}
    <div className="card compact-card" style={{ marginBottom: 16 }}>
      <div className="section-title"><h3>Filtry</h3></div>
      <div className="planner-filter">
        <select className="searchbox" value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)}><option value="all">Všichni řidiči</option>{data.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select className="searchbox" value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)}><option value="all">Všechna auta</option>{data.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.plate}</option>)}</select>
        <select className="searchbox" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="active">Aktivní</option><option value="all">Všechny stavy</option>{Object.entries(statusMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
    </div>
    <div className="planner-main-grid">
      <div className="grid stack minzero">
        {selected && plannerView === 'calendar' && <ShiftDetail shift={selected} data={data} helpers={helpers} commit={commit} setSelected={setSelected} setEditing={openEditShiftDrawer} />}
        {plannerView === 'table' ? <div className="card calendar-card">
          <div className="section-title"><h3>Tabulka směn</h3><button className="ghost" type="button" onClick={() => setPlannerView('calendar')}>Zpět na kalendář</button></div>
          <ShiftTable shifts={rangeShifts} data={data} helpers={helpers} commit={commit} />
        </div> : <div className="card calendar-card">
          <div className="section-title"><h3>Kalendář směn</h3>{conflictsOnly && <span className="pill bad">Filtr: kolize</span>}</div>
          <div className="two-week-calendar">
            {weeks.map((ws, idx) => {
              const weekDays = Array.from({ length: 7 }, (_, i) => addDays(ws, i))
              return <div className="week-block" key={ws}>
                <div className="week-block-title"><b>{idx + 1}. týden</b><span>{formatDate(ws)}–{formatDate(addDays(ws, 6))}</span></div>
                <div className="week-grid">
                  {weekDays.map((day) => <DayColumn key={day} day={day} shifts={visibleShifts} data={data} helpers={helpers} commit={commit} setEditing={openEditShiftDrawer} setSelected={setSelected} copyDay={copyToday} />)}
                </div>
              </div>
            })}
          </div>
        </div>}
      </div>
    </div>
    <SideDrawer title={editing ? 'Upravit směnu' : 'Nová směna'} open={shiftDrawerOpen} onClose={requestCloseShiftDrawer}>
      <ShiftForm
        data={data}
        helpers={helpers}
        commit={commit}
        initialDate={initialShiftDate}
        editing={editing}
        setEditing={setEditing}
        onSaved={handleShiftSaved}
        onCancel={requestCloseShiftDrawer}
        onDirtyChange={setShiftFormDirty}
        variant="drawer"
      />
    </SideDrawer>
    {plannerToast && <div className="planner-toast" role="status">{plannerToast}</div>}
  </>
}

function DayColumn({ day, shifts, data, helpers, commit, setEditing, setSelected, copyDay }) {
  const items = sortByDateTime(shifts.filter((s) => s.date === day))
  const copyThisDay = () => copyDay(day)
  const handleDayContextMenu = (event) => {
    if (event.target.closest?.('.calendar-shift-card')) return
    event.preventDefault()
    copyThisDay()
  }
  return <div className={`day ${day === todayISO() ? 'today' : ''}`} onContextMenu={handleDayContextMenu}>
    <h4>
      <span>{formatDate(day)}</span>
      <details className="day-menu" onClick={(event) => event.stopPropagation()}>
        <summary aria-label="Akce dne">⋯</summary>
        <div className="day-menu-panel">
          <button type="button" onClick={copyThisDay}>Kopírovat den</button>
        </div>
      </details>
    </h4>
    <span className="mobile-day-head">{items.length ? `${items.length} směn` : 'volno'}</span>
    {items.map((s) => <ShiftMini key={s.id} shift={s} data={data} helpers={helpers} commit={commit} setEditing={setEditing} setSelected={setSelected} />)}
    {!items.length && <div className="empty calendar-empty">Bez směn</div>}
  </div>
}
function ShiftMini({ shift, data, helpers, setSelected }) {
  const conflicts = helpers.conflictMessages(shift)
  const activeSwap = activeSwapForShift(shift, data)
  const driverLabel = calendarDriverLabel(shift.driverId, data, helpers)
  const lineClass = calendarShiftLineClass(shift, conflicts, activeSwap)
  const conflictLabel = conflicts.length === 1 ? '⚠ kolize' : `⚠ ${conflicts.length} kolize`
  const swapLabel = activeSwap?.targetMode === 'open' ? 'zájemce čeká' : (activeSwap?.status === 'accepted' ? 'výměna přijata' : 'čeká výměna')
  const title = [`${shift.start} – ${shift.end}`, helpers.driverName(shift.driverId), activeSwap ? swapLabel : '', ...conflicts].filter(Boolean).join('\n')
  return <button
    type="button"
    className={`shift-card compact-shift calendar-shift-card ${lineClass} status-${shift.status}`}
    title={title}
    aria-label={title}
    onClick={() => setSelected(shift)}
  >
    <span className="calendar-shift-time">{shift.start} – {shift.end}</span>
    <span className="calendar-shift-driver">{driverLabel}</span>
    {conflicts.length > 0 && <span className="calendar-shift-conflict">{conflictLabel}</span>}
    {!conflicts.length && activeSwap && <span className="calendar-shift-swap">{swapLabel}</span>}
  </button>
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
    <PageTitle title="Provozní dashboard" subtitle={`Dnes je ${todayRangeTitle()}.`}>
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
  const [openSections, setOpenSections] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('rbshift-audit-open-sections') || 'null')
      return saved && typeof saved === 'object' ? { today: false, week: false, month: false, ...saved } : { today: true, week: false, month: false }
    } catch { return { today: true, week: false, month: false } }
  })
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
  const currentMonth = todayISO().slice(0, 7)
  const monthLogs = (data.audit || []).filter((row) => String(row.at || row.createdAt || '').startsWith(currentMonth))
  const todayIssues = audit.conflicts.length + audit.gaps.length + audit.pendingSwaps.length + audit.declined.length
  const weekIssues = coverageRows.filter((r) => r.missing).length + attendance.filter((row) => row.open || Math.abs(row.diffMinutes) > 15).length
  const updateMinDrivers = (slotId, value) => {
    const n = Math.max(0, Number(value || 0))
    commit((prev) => ({ ...prev, settings: { ...prev.settings, coverageSlots: (prev.settings?.coverageSlots || []).map((slot) => slot.id === slotId ? { ...slot, minDrivers: n } : slot) } }), 'Upravena norma pokrytí provozu.')
  }
  useEffect(() => {
    try { localStorage.setItem('rbshift-audit-open-sections', JSON.stringify(openSections)) }
    catch { }
  }, [openSections])
  const sectionProps = (key) => ({
    open: Boolean(openSections[key]),
    onToggle: (event) => {
      const isOpen = event.currentTarget.open
      setOpenSections((prev) => ({ ...prev, [key]: isOpen }))
    }
  })
  return <>
    <PageTitle title="Audit provozu">
      <button className="ghost" onClick={() => setWeekStart(addDays(weekStart, -7))}>← Předchozí</button>
      <button className="ghost" onClick={() => setWeekStart(startOfWeek(todayISO()))}>Tento týden</button>
      <button className="ghost" onClick={() => setWeekStart(addDays(weekStart, 7))}>Další →</button>
      <button className="primary" onClick={() => copyText(readinessText(data, helpers, weekStart))}>Kopírovat audit</button>
      <button className="ghost" onClick={() => exportAttendanceCSV(data, helpers, weekStart, to)}>Export docházky CSV</button>
    </PageTitle>
    <div className="grid kpis compact-kpis">
      <Kpi label="Připravenost" value={`${readinessPct} %`} hint={`${passed}/${audit.checks.length} kontrol OK`} kind={readinessPct === 100 ? 'good' : readinessPct >= 75 ? 'warn' : 'bad'} />
      <Kpi label="Týden" value={`${formatDate(weekStart)}–${formatDate(to)}`} hint="auditované období" />
      <Kpi label="Problémy" value={audit.conflicts.length + audit.gaps.length + audit.pendingSwaps.length + audit.declined.length} hint="kolize + pokrytí + výměny" kind={(audit.conflicts.length + audit.gaps.length + audit.pendingSwaps.length + audit.declined.length) ? 'bad' : 'good'} />
      <Kpi label="Docházka" value={hoursLabel(actualTotal)} hint={`plán ${hoursLabel(plannedTotal)} · rozdíl ${hoursLabel(actualTotal - plannedTotal)}`} />
    </div>
    <div className="stack" style={{ marginTop: 16 }}>
      <details className="card collapse-card" {...sectionProps('today')}>
        <summary><span><b>Dnes</b><small>{passed}/{audit.checks.length} kontrol OK · {todayIssues ? `${todayIssues} problémů` : 'bez kritických problémů'}</small></span><span className={todayIssues ? 'pill warn' : 'pill good'}>{todayIssues || 'OK'}</span></summary>
        <div className="stack collapse-content">
          <div className="section-title"><h3>Připravenost provozu</h3><span className={readinessPct === 100 ? 'pill good' : 'pill warn'}>{readinessPct === 100 ? 'OK' : 'doplnit'}</span></div>
          {audit.checks.map((check) => <div className={`alert ${check.ok ? 'good' : 'warn'}`} key={check.key}><b>{check.ok ? '✓' : '!'} {check.label}</b><br /><span>{check.detail}</span></div>)}
        </div>
      </details>
      <details className="card collapse-card" {...sectionProps('week')}>
        <summary><span><b>Tento týden</b><small>{formatDate(weekStart)}–{formatDate(to)} · pokrytí a docházka</small></span><span className={weekIssues ? 'pill bad' : 'pill good'}>{weekIssues ? `${weekIssues} kontrol` : 'OK'}</span></summary>
        <div className="collapse-content stack">
          <div className="section-title"><h3>Pokrytí týdne</h3><span className={coverageRows.some((r) => r.missing) ? 'pill bad' : 'pill good'}>{coverageRows.filter((r) => r.missing).length}</span></div>
          <div className="table-wrap compact-table audit-table-scroll"><table className="table"><thead><tr><th>Den</th><th>Pásmo</th><th>Čas</th><th>Plán</th><th>Min.</th><th>Stav</th></tr></thead><tbody>{coverageRows.map((row) => <tr key={`${row.day}-${row.slot.id}`}><td><b>{formatDate(row.day)}</b></td><td>{row.slot.name}</td><td>{row.slot.start}–{row.slot.end}</td><td>{row.planned}</td><td>{row.slot.minDrivers}</td><td>{row.missing ? <span className="pill bad">chybí {row.missing}</span> : <span className="pill good">OK</span>}</td></tr>)}</tbody></table></div>
          <div className="section-title"><h3>Docházkový report</h3><span className="pill">{hoursLabel(actualTotal)}</span></div>
          <div className="table-wrap compact-table audit-table-scroll"><table className="table"><thead><tr><th>Řidič</th><th>Směn</th><th>Hotovo</th><th>Plán</th><th>Reál</th><th>Rozdíl</th><th>Kontrola</th></tr></thead><tbody>{attendance.map((row) => <tr key={row.driver.id}><td><b>{row.driver.name}</b><br /><small>{row.driver.phone || row.driver.email || 'bez kontaktu'}</small></td><td>{row.shifts.length}</td><td>{row.completed}</td><td>{hoursLabel(row.plannedMinutes)}</td><td>{hoursLabel(row.actualMinutes)}</td><td>{hoursLabel(row.diffMinutes)}</td><td>{row.open ? <span className="pill warn">{row.open} běží</span> : <span className="pill good">OK</span>}</td></tr>)}</tbody></table></div>
        </div>
      </details>
      <details className="card collapse-card" {...sectionProps('month')}>
        <summary><span><b>Tento měsíc</b><small>{monthLogs.length} záznamů historie · dlouhodobé normy</small></span><span className="pill">{monthLogs.length}</span></summary>
        <div className="collapse-content stack">
          <div className="section-title"><h3>Normy pokrytí</h3><span className="pill">{data.settings?.coverageSlots?.length || 0}</span></div>
          <div className="table-wrap compact-table audit-table-scroll"><table className="table"><thead><tr><th>Pásmo</th><th>Čas</th><th>Min. řidičů</th></tr></thead><tbody>{(data.settings?.coverageSlots || []).map((slot) => <tr key={slot.id}><td><b>{slot.name}</b></td><td>{slot.start}–{slot.end}</td><td><input type="number" min="0" value={slot.minDrivers} onChange={(e) => updateMinDrivers(slot.id, e.target.value)} style={{ width: 90 }} /></td></tr>)}</tbody></table></div>
          <div className="section-title"><h3>Historie za měsíc</h3><span className="pill">{monthLogs.length}</span></div>
          <div className="timeline stack audit-table-scroll">{monthLogs.slice(0, 50).map((log) => <div className="log" key={log.id}><b>{new Date(log.at).toLocaleString('cs-CZ')}</b><br /><span className="muted">{log.text}</span></div>)}{!monthLogs.length && <div className="empty">Za tento měsíc nejsou žádné záznamy.</div>}</div>
        </div>
      </details>
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
    <PageTitle title="Seznam směn">
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

const isValidEmail = (email = '') => !String(email || '').trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())
const normalizePlate = (plate = '') => String(plate || '').toUpperCase().replace(/\s+/g, ' ').trim()
const isValidPlate = (plate = '') => {
  const value = normalizePlate(plate)
  return value.length >= 2 && value.length <= 16 && !/[^\p{L}\p{N} -]/u.test(value)
}
const extractVehicleYear = (note = '') => {
  const match = String(note || '').match(/^Rok výroby:\s*(\d{4})(?:\s*·\s*)?/)
  return match?.[1] || ''
}
const vehicleNoteBody = (note = '') => String(note || '').replace(/^Rok výroby:\s*\d{4}(?:\s*·\s*)?/, '').trim()
const composeVehicleNote = (year = '', note = '') => [year ? `Rok výroby: ${year}` : '', String(note || '').trim()].filter(Boolean).join(' · ')
const isValidVehicleYear = (year = '') => {
  if (!String(year || '').trim()) return true
  const value = Number(year)
  const current = new Date().getFullYear() + 1
  return Number.isInteger(value) && value >= 1990 && value <= current
}
// TODO: mimo scope - avatar upload a samostatné role řidičů vyžadují Storage/sloupce v Supabase schématu.

function Drivers({ data, commit }) {
  const empty = { name: '', phone: '', email: '', profileId: '', active: true, note: '' }
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const editingDriver = editing ? data.drivers.find((d) => d.id === editing) : null
  const activeCount = data.drivers.filter((d) => d.active !== false).length
  const closeDrawer = () => { setDrawerOpen(false); setEditing(null); setForm(empty) }
  const openCreate = () => { setForm(empty); setEditing(null); setDrawerOpen(true) }
  const openEdit = (d) => {
    setForm({ ...empty, ...d, name: d.name || '', email: d.email || '', phone: d.phone || '', note: d.note || '' })
    setEditing(d.id)
    setDrawerOpen(true)
  }
  const submit = (e) => {
    e.preventDefault()
    const name = form.name.trim()
    const email = form.email.trim().toLowerCase()
    if (!name) return alert('Vyplň jméno řidiče.')
    if (!isValidEmail(email)) return alert('Vyplň platný e-mail řidiče, nebo pole nech prázdné.')
    const payload = { name, phone: form.phone.trim(), email, profileId: form.profileId?.trim() || '', active: form.active !== false, note: form.note.trim() }
    if (editing) commit((prev) => ({ ...prev, drivers: prev.drivers.map((d) => d.id === editing ? { ...d, ...payload } : d) }), 'Řidič upraven.')
    else commit((prev) => ({ ...prev, drivers: [{ id: uid('drv'), ...payload }, ...prev.drivers] }), 'Řidič vytvořen.')
    closeDrawer()
  }
  const softDelete = (driver = editingDriver) => {
    if (!driver || !safeDelete('deaktivaci řidiče')) return
    commit((prev) => ({ ...prev, drivers: prev.drivers.map((d) => d.id === driver.id ? { ...d, active: false } : d) }), 'Řidič deaktivován.')
    if (editing === driver.id) closeDrawer()
  }
  const restore = (driver) => commit((prev) => ({ ...prev, drivers: prev.drivers.map((d) => d.id === driver.id ? { ...d, active: true } : d) }), 'Řidič znovu aktivován.')
  return <>
    <PageTitle title="Řidiči"><button className="primary" onClick={openCreate}>+ Přidat řidiče</button></PageTitle>
    <div className="card">
      <div className="section-title"><h3>Seznam řidičů</h3><span className="pill">{activeCount} aktivní / {data.drivers.length} celkem</span></div>
      <div className="stack compact-list">{data.drivers.map((d) => <div className="log" key={d.id} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => openEdit(d)} onKeyDown={(e) => { if (e.key === 'Enter') openEdit(d) }}>
        <div className="split"><div><b>{d.name || 'Bez jména'}</b><br /><small className="muted">{d.phone || 'Bez telefonu'} · {d.email || 'Bez e-mailu'}{d.profileId ? ' · profil: ' + d.profileId.slice(0, 8) + '…' : ''}</small></div><span className={d.active ? 'pill good' : 'pill bad'}>{d.active ? 'Aktivní' : 'Neaktivní'}</span></div>
        {d.note && <p className="muted compact-note">{d.note}</p>}
        <div className="row-actions" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => openEdit(d)}>Upravit</button>
          {d.active === false ? <button onClick={() => restore(d)}>Obnovit</button> : <button className="danger-mini" onClick={() => softDelete(d)}>Smazat</button>}
        </div>
      </div>)}</div>
    </div>
    <SideDrawer title={editing ? 'Detail řidiče' : 'Přidat řidiče'} open={drawerOpen} onClose={closeDrawer}>
      <form className="form two-col" onSubmit={submit}>
        <Field label="Jméno řidiče" className="span2"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus required placeholder="Např. Aleš Novák" /></Field>
        <Field label="E-mail"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="volitelné" /></Field>
        <Field label="Telefon"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Role"><input value="Řidič" readOnly /></Field>
        <Field label="Aktivní"><select value={String(form.active)} onChange={(e) => setForm({ ...form, active: e.target.value === 'true' })}><option value="true">Ano</option><option value="false">Ne</option></select></Field>
        <Field label="Profile/Auth ID" className="span2"><input value={form.profileId || ''} onChange={(e) => setForm({ ...form, profileId: e.target.value })} placeholder="volitelné" /></Field>
        <Field label="Poznámka" className="span2"><textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        <div className="field span2 drawer-form-actions">
          <button className="primary" type="submit">{editing ? 'Uložit změny' : 'Vytvořit řidiče'}</button>
          <button className="ghost" type="button" onClick={closeDrawer}>Zrušit</button>
        </div>
        {editing && <div className="field span2">
          <button className="danger" type="button" onClick={() => softDelete()} disabled={editingDriver?.active === false}>Smazat řidiče</button>
        </div>}
      </form>
    </SideDrawer>
  </>
}

function Vehicles({ data, commit }) {
  const empty = { name: '', plate: '', year: '', active: true, note: '' }
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [block, setBlock] = useState({ vehicleId: '', from: todayISO(), to: todayISO(), reason: '' })
  const editingVehicle = editing ? data.vehicles.find((v) => v.id === editing) : null
  const activeCount = data.vehicles.filter((v) => v.active !== false).length
  const closeDrawer = () => { setDrawerOpen(false); setEditing(null); setForm(empty) }
  const openCreate = () => { setForm(empty); setEditing(null); setDrawerOpen(true) }
  const openEdit = (v) => {
    setForm({ ...empty, ...v, year: extractVehicleYear(v.note), note: vehicleNoteBody(v.note), plate: v.plate || '', name: v.name || '' })
    setEditing(v.id)
    setDrawerOpen(true)
  }
  const submit = (e) => {
    e.preventDefault()
    const name = form.name.trim()
    const plate = normalizePlate(form.plate)
    const year = String(form.year || '').trim()
    if (!name) return alert('Vyplň model vozidla.')
    if (!plate || !isValidPlate(plate)) return alert('Vyplň platnou SPZ. Použij 2–16 znaků: písmena, čísla, mezery nebo pomlčky.')
    if (!isValidVehicleYear(year)) return alert('Rok výroby musí být mezi 1990 a příštím rokem.')
    const payload = { name, plate, active: form.active !== false, note: composeVehicleNote(year, form.note) }
    if (editing) commit((prev) => ({ ...prev, vehicles: prev.vehicles.map((v) => v.id === editing ? { ...v, ...payload } : v) }), 'Vozidlo upraveno.')
    else commit((prev) => ({ ...prev, vehicles: [{ id: uid('car'), ...payload }, ...prev.vehicles] }), 'Vozidlo vytvořeno.')
    closeDrawer()
  }
  const addBlock = (e) => { e.preventDefault(); if (!block.vehicleId) return alert('Vyber vozidlo.'); commit((prev) => ({ ...prev, serviceBlocks: [{ id: uid('srv'), ...block }, ...prev.serviceBlocks] }), 'Přidána servisní blokace vozidla.'); setBlock({ vehicleId: '', from: todayISO(), to: todayISO(), reason: '' }) }
  const removeBlock = (id) => safeDelete('servisní blokace') && commit((prev) => ({ ...prev, serviceBlocks: prev.serviceBlocks.filter((b) => b.id !== id) }), 'Smazána servisní blokace.')
  const softDelete = (vehicle = editingVehicle) => {
    if (!vehicle || !safeDelete('deaktivaci vozidla')) return
    commit((prev) => ({ ...prev, vehicles: prev.vehicles.map((v) => v.id === vehicle.id ? { ...v, active: false } : v) }), 'Vozidlo deaktivováno.')
    if (editing === vehicle.id) closeDrawer()
  }
  const restoreVehicle = (vehicle) => commit((prev) => ({ ...prev, vehicles: prev.vehicles.map((v) => v.id === vehicle.id ? { ...v, active: true } : v) }), 'Vozidlo znovu aktivováno.')
  return <>
    <PageTitle title="Vozidla"><button className="primary" onClick={openCreate}>+ Přidat vozidlo</button></PageTitle>
    <div className="grid two">
      <div className="card">
        <div className="section-title"><h3>Seznam vozidel</h3><span className="pill">{activeCount} aktivní / {data.vehicles.length} celkem</span></div>
        <div className="stack compact-list">{data.vehicles.map((v) => {
          const year = extractVehicleYear(v.note)
          const note = vehicleNoteBody(v.note)
          return <div className="log" key={v.id} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => openEdit(v)} onKeyDown={(e) => { if (e.key === 'Enter') openEdit(v) }}>
            <div className="split"><div><b>{v.name || 'Bez modelu'}</b><br /><small className="muted">{v.plate || 'Bez SPZ'}{year ? ` · ${year}` : ''}{note ? ' · ' + note : ''}</small></div><span className={v.active ? 'pill good' : 'pill bad'}>{v.active ? 'Aktivní' : 'Neaktivní'}</span></div>
            <div className="row-actions" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => openEdit(v)}>Upravit</button>
              {v.active === false ? <button onClick={() => restoreVehicle(v)}>Obnovit</button> : <button className="danger-mini" onClick={() => softDelete(v)}>Smazat</button>}
            </div>
          </div>
        })}</div>
      </div>
      <div className="card"><div className="section-title"><h3>Servisní blokace</h3><span className="pill warn">{data.serviceBlocks.length}</span></div><form className="form two-col" onSubmit={addBlock}><Field label="Vozidlo"><select value={block.vehicleId} onChange={(e) => setBlock({ ...block, vehicleId: e.target.value })}><option value="">Vyber vůz</option>{data.vehicles.filter((v) => v.active !== false).map((v) => <option key={v.id} value={v.id}>{v.name} · {v.plate}</option>)}</select></Field><Field label="Důvod"><input value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })} /></Field><Field label="Od"><input type="date" value={block.from} onChange={(e) => setBlock({ ...block, from: e.target.value })} /></Field><Field label="Do"><input type="date" value={block.to} onChange={(e) => setBlock({ ...block, to: e.target.value })} /></Field><div className="field span2"><button className="primary" type="submit">Přidat blokaci</button></div></form><div className="stack" style={{ marginTop: 12 }}>{data.serviceBlocks.map((s) => <div className="alert warn" key={s.id}>{data.vehicles.find((v) => v.id === s.vehicleId)?.name || 'Vůz'} · {s.from} až {s.to}<br /><small>{s.reason}</small><div className="row-actions" style={{ marginTop: 8 }}><button onClick={() => removeBlock(s.id)}>Smazat</button></div></div>)}{!data.serviceBlocks.length && <div className="empty">Žádné servisní blokace.</div>}</div></div>
    </div>
    <SideDrawer title={editing ? 'Detail vozidla' : 'Přidat vozidlo'} open={drawerOpen} onClose={closeDrawer}>
      <form className="form two-col" onSubmit={submit}>
        <Field label="Model"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus required placeholder="Např. Tesla Model 3" /></Field>
        <Field label="SPZ"><input value={form.plate} onChange={(e) => setForm({ ...form, plate: normalizePlate(e.target.value) })} placeholder="např. 1AB 2345" required /></Field>
        <Field label="Rok výroby"><input inputMode="numeric" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="volitelné" /></Field>
        <Field label="Aktivní"><select value={String(form.active)} onChange={(e) => setForm({ ...form, active: e.target.value === 'true' })}><option value="true">Ano</option><option value="false">Ne</option></select></Field>
        <Field label="Poznámka" className="span2"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        <div className="field span2 drawer-form-actions">
          <button className="primary" type="submit">{editing ? 'Uložit změny' : 'Vytvořit vozidlo'}</button>
          <button className="ghost" type="button" onClick={closeDrawer}>Zrušit</button>
        </div>
        {editing && <div className="field span2">
          <button className="danger" type="button" onClick={() => softDelete()} disabled={editingVehicle?.active === false}>Smazat vozidlo</button>
        </div>}
      </form>
    </SideDrawer>
  </>
}


function Availability({ data, commit, currentDriver }) {
  const firstDriverId = currentDriver?.id || data.drivers.find((d) => d.active !== false)?.id || data.drivers[0]?.id || ''
  const [absence, setAbsence] = useState({ driverId: firstDriverId, from: todayISO(), to: todayISO(), reason: '' })
  const [slot, setSlot] = useState({ driverId: firstDriverId, kind: 'available', fromAt: datetimeLocal(todayISO(), '07:00'), toAt: datetimeLocal(todayISO(), '19:00'), note: '' })
  const [availabilityToast, setAvailabilityToast] = useState('')
  useEffect(() => {
    if (currentDriver?.id) {
      setAbsence((f) => ({ ...f, driverId: currentDriver.id }))
      setSlot((f) => ({ ...f, driverId: currentDriver.id }))
    }
  }, [currentDriver?.id])
  useEffect(() => {
    if (!availabilityToast) return undefined
    const timer = setTimeout(() => setAvailabilityToast(''), 4200)
    return () => clearTimeout(timer)
  }, [availabilityToast])
  const driversForSelect = currentDriver ? [currentDriver] : data.drivers.filter((d) => d.active !== false)
  const absences = data.absences.filter((a) => !currentDriver || a.driverId === currentDriver.id)
  const availability = (data.availability || []).filter((a) => !currentDriver || a.driverId === currentDriver.id)
  const submitAbsence = (e) => {
    e.preventDefault()
    if (!absence.driverId || !absence.from || !absence.to) return alert('Vyplň řidiče a datum.')
    if (absence.to < absence.from) return alert('Datum Do musí být stejné nebo pozdější než Od.')
    commit((prev) => ({ ...prev, absences: [{ id: uid('abs'), ...absence }, ...prev.absences] }), 'Přidána nepřítomnost řidiče.')
    setAbsence({ ...absence, from: todayISO(), to: todayISO(), reason: '' })
  }
  const submitSlot = (e) => {
    e.preventDefault()
    if (!slot.driverId) return alert('Vyber řidiče.')
    if (!slot.fromAt || !slot.toAt) return alert('Vyplň datum a čas od/do.')
    if (new Date(slot.toAt) <= new Date(slot.fromAt)) return alert('Čas Do musí být později než Od.')
    const payload = {
      id: uid('av'),
      driverId: slot.driverId,
      fromAt: slot.fromAt,
      toAt: slot.toAt,
      date: '',
      weekday: '',
      start: timePart(slot.fromAt),
      end: timePart(slot.toAt),
      note: `[${slot.kind}] ${slot.note || ''}`.trim(),
    }
    const overlaps = (data.availability || []).filter((a) => a.driverId === slot.driverId && availabilityRangeOverlaps(a, payload))
    if (overlaps.length) setAvailabilityToast(`Pozor: překryv s ${overlaps.length} existující dostupností. Záznam byl přidán bez přepsání.`)
    commit((prev) => ({ ...prev, availability: [payload, ...(prev.availability || [])] }), 'Přidána dostupnost řidiče.')
    setSlot({ ...slot, fromAt: datetimeLocal(todayISO(), '07:00'), toAt: datetimeLocal(todayISO(), '19:00'), note: '' })
  }
  const removeAbsence = (id) => safeDelete('nepřítomnost řidiče') && commit((prev) => ({ ...prev, absences: prev.absences.filter((a) => a.id !== id) }), 'Smazána nepřítomnost řidiče.')
  const removeSlot = (id) => safeDelete('dostupnost řidiče') && commit((prev) => ({ ...prev, availability: (prev.availability || []).filter((a) => a.id !== id) }), 'Smazána dostupnost řidiče.')
  const DriverSelect = ({ value, onChange }) => currentDriver ? null : <Field label="Řidič"><select value={value} onChange={(e) => onChange(e.target.value)}>{driversForSelect.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
  return <><PageTitle title="Dostupnost řidičů" />
    {availabilityToast && <div className="planner-toast" role="status">{availabilityToast}</div>}
    <div className="grid two">
      <div className="card"><div className="section-title"><h3>Nová dostupnost</h3><span className="pill">od–do</span></div><form className="form two-col" onSubmit={submitSlot}>
        <DriverSelect value={slot.driverId} onChange={(v) => setSlot({ ...slot, driverId: v })} />
        <Field label="Typ"><select value={slot.kind} onChange={(e) => setSlot({ ...slot, kind: e.target.value })}><option value="available">Dostupný</option><option value="unavailable">Nedostupný</option><option value="preferred">Preferuje</option></select></Field>
        <Field label="Od"><input type="datetime-local" value={slot.fromAt} onChange={(e) => setSlot({ ...slot, fromAt: e.target.value })} /></Field>
        <Field label="Do"><input type="datetime-local" value={slot.toAt} onChange={(e) => setSlot({ ...slot, toAt: e.target.value })} /></Field>
        <Field label="Poznámka" className="span2"><input value={slot.note} onChange={(e) => setSlot({ ...slot, note: e.target.value })} placeholder="Např. jen denní, po domluvě…" /></Field>
        <div className="field span2"><button className="primary" type="submit">Uložit dostupnost</button></div>
      </form></div>
      <div className="card"><h3>Nová nepřítomnost</h3><form className="form two-col" onSubmit={submitAbsence}>
        <DriverSelect value={absence.driverId} onChange={(v) => setAbsence({ ...absence, driverId: v })} />
        <Field label="Od"><input type="date" value={absence.from} onChange={(e) => setAbsence({ ...absence, from: e.target.value })} /></Field>
        <Field label="Do"><input type="date" value={absence.to} onChange={(e) => setAbsence({ ...absence, to: e.target.value })} /></Field>
        <Field label="Důvod" className="span2"><input value={absence.reason} onChange={(e) => setAbsence({ ...absence, reason: e.target.value })} placeholder="Volno, nemoc, dovolená…" /></Field>
        <div className="field span2"><button className="primary" type="submit">Uložit nepřítomnost</button></div>
      </form></div>
    </div>
    <div className="grid two" style={{ marginTop: 16 }}>
      <div className="card"><div className="section-title"><h3>Dostupnost</h3><span className="pill">{availability.length}</span></div><div className="stack compact-list">{availability.map((a) => {
        const kind = availabilityKind(a)
        const note = availabilityNoteText(a)
        return <div className={kind === 'unavailable' ? 'alert bad' : kind === 'preferred' ? 'alert warn' : 'alert good'} key={a.id}>
          <div className="split"><div><b>{data.drivers.find((d) => d.id === a.driverId)?.name}</b> · {availabilityLabel(a)}</div><span className={`pill ${availabilityKindTone[kind] || 'good'}`}>{availabilityKindMap[kind] || 'Dostupný'}</span></div>
          {note && <small>{note}</small>}
          <div className="row-actions" style={{ marginTop: 8 }}><button onClick={() => removeSlot(a.id)}>Smazat</button></div>
        </div>
      })}{!availability.length && <div className="empty">Není zadaná žádná dostupnost.</div>}</div></div>
      <div className="card"><div className="section-title"><h3>Nepřítomnosti</h3><span className="pill warn">{absences.length}</span></div><div className="stack compact-list">{absences.map((a) => <div className="alert warn" key={a.id}><b>{data.drivers.find((d) => d.id === a.driverId)?.name}</b> · {a.from} až {a.to}<br /><small>{a.reason || 'Bez důvodu'}</small><div className="row-actions" style={{ marginTop: 8 }}><button onClick={() => removeAbsence(a.id)}>Smazat</button></div></div>)}{!absences.length && <div className="empty">Žádné nepřítomnosti.</div>}</div></div>
    </div>
  </>
}

function DriverHome({ data, helpers, commit, currentDriver, onOpenNotifications }) {
  const [expandedShiftId, setExpandedShiftId] = useState('')
  const [driverToast, setDriverToast] = useState('')
  const driverToastTimer = useRef(null)
  const hiddenDriverStatuses = new Set(['cancelled', 'declined', 'rejected'])
  const showDriverToast = (message) => {
    setDriverToast(message)
    window.clearTimeout(driverToastTimer.current)
    driverToastTimer.current = window.setTimeout(() => setDriverToast(''), 2600)
  }
  const shifts = sortByDateTime(data.shifts.filter((s) => s.driverId === currentDriver?.id && s.date >= todayISO() && !hiddenDriverStatuses.has(s.status))).slice(0, 30)
  const openShifts = sortByDateTime((data.shifts || []).filter((s) => s.status === 'open' && !s.driverId && s.date >= todayISO())).slice(0, 30)
  const myOpenInterests = (data.swapRequests || []).filter((r) => r.targetMode === 'open' && r.driverId === currentDriver?.id && ['pending','accepted'].includes(r.status))
  const visibleNotices = (data.notifications || []).filter((n) => isNoticeVisible(n, currentDriver, true))
  const unreadNotices = visibleNotices.filter((n) => !isNoticeRead(n, currentDriver, true))
  const awaiting = shifts.filter((s) => s.status === 'assigned' || s.status === 'draft')
  const running = shifts.find((s) => s.actualStartAt && !s.actualEndAt)
  const todayShift = shifts.find((x) => x.date === todayISO())
  const nextShift = shifts.find((x) => x.date > todayISO()) || shifts[0]
  const focus = running || todayShift || nextShift
  const setStatus = (id, status, reason = '', options = {}) => {
    const shift = data.shifts.find((s) => s.id === id)
    const notices = shift ? [adminNotice(`Řidič změnil stav: ${statusMap[status]}`, `${currentDriver?.name || 'Řidič'} · ${formatDate(shift.date)} ${shift.start}–${shift.end}${reason ? ` · důvod: ${reason}` : ''}`, `driver-${status}`, id)] : []
    commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === id ? { ...s, status, declineReason: reason } : s) }, notices), `${currentDriver?.name || 'Řidič'} změnil stav směny na ${statusMap[status]}.`, options)
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
    const colleagues = data.drivers.filter((d) => d.active && d.id !== currentDriver?.id)
    const input = prompt('Komu nabídnout výměnu? Napiš VŠEM nebo jméno kolegy:', 'VŠEM')
    if (input === null) return
    const reason = prompt('Důvod / poznámka k výměně:', '') || ''
    const normalized = input.trim().toLowerCase()
    const targetDriver = normalized && !['vsem', 'všem', 'all', '*'].includes(normalized) ? colleagues.find((d) => d.name.toLowerCase().includes(normalized)) : null
    if (normalized && !targetDriver && !['vsem', 'všem', 'all', '*'].includes(normalized)) return alert('Kolega nebyl nalezený. Zkus přesnější jméno nebo napiš VŠEM.')
    const request = { id: uid('swap'), shiftId: shift.id, driverId: currentDriver?.id, reason, status: 'pending', targetMode: targetDriver ? 'driver' : 'all', targetDriverId: targetDriver?.id || '', acceptedByDriverId: '', acceptedAt: '', createdAt: new Date().toISOString(), history: [{ at: new Date().toISOString(), text: targetDriver ? `Nabídnuto kolegovi ${targetDriver.name}.` : 'Nabídnuto všem kolegům.' }] }
    const targetIds = targetDriver ? [targetDriver.id] : colleagues.map((d) => d.id)
    const notices = targetIds.map((id) => makeNotice({ title: 'Nabídka výměny směny', body: `${currentDriver?.name || 'Kolega'} nabízí směnu ${formatDate(shift.date)} ${shift.start}–${shift.end}.${reason ? ` Důvod: ${reason}` : ''}`, targetDriverId: id, type: 'swap-offer', shiftId: shift.id }))
    notices.push(adminNotice('Nová žádost o výměnu směny', `${currentDriver?.name || 'Řidič'} · ${formatDate(shift.date)} ${shift.start}–${shift.end}`, 'swap-request', shift.id))
    commit((prev) => addNotificationsToData({ ...prev, swapRequests: [request, ...(prev.swapRequests || [])], shifts: prev.shifts.map((s) => s.id === shift.id ? { ...s, swapRequestStatus: 'pending' } : s) }, notices), `${currentDriver?.name || 'Řidič'} požádal o výměnu směny.`)
  }
  const cancelSwap = (shift) => {
    const activeReq = (data.swapRequests || []).find((r) => r.shiftId === shift.id && r.driverId === currentDriver?.id && ['pending','accepted'].includes(r.status))
    if (!activeReq || !confirm('Zrušit žádost o výměnu?')) return
    const notices = [adminNotice('Řidič zrušil žádost o výměnu', `${currentDriver?.name || 'Řidič'} · ${formatDate(shift.date)} ${shift.start}–${shift.end}`, 'swap-cancelled', shift.id)]
    commit((prev) => addNotificationsToData({ ...prev, swapRequests: (prev.swapRequests || []).map((r) => r.id === activeReq.id ? appendSwapHistory({ ...r, status: 'cancelled', cancelledAt: new Date().toISOString() }, 'Řidič žádost zrušil.') : r), shifts: prev.shifts.map((s) => s.id === shift.id ? { ...s, swapRequestStatus: 'cancelled' } : s) }, notices), `${currentDriver?.name || 'Řidič'} zrušil žádost o výměnu.`)
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
    commit((prev) => addNotificationsToData({ ...prev, swapRequests: (prev.swapRequests || []).map((r) => r.id === request.id ? appendSwapHistory({ ...r, status: 'accepted', acceptedByDriverId: currentDriver?.id, acceptedAt: new Date().toISOString() }, `${currentDriver?.name || 'Kolega'} chce směnu převzít.`) : r), shifts: prev.shifts.map((s) => s.id === request.shiftId ? { ...s, swapRequestStatus: 'accepted' } : s) }, notices), `${currentDriver?.name || 'Řidič'} přijal nabídku výměny směny.`)
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
  const decline = (shift) => {
    const reason = prompt('Důvod odmítnutí:', shift.declineReason || '')
    if (reason === null) return
    showDriverToast('Směna odmítnuta.')
    setStatus(shift.id, 'declined', reason || '', {
      rollbackOnError: true,
      onError: () => showDriverToast('Nepodařilo se odmítnout, zkus to znovu.'),
    })
  }
  const scrollToDriverSection = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const quickChips = [
    awaiting.length > 0 ? { key: 'awaiting', label: `⏳ ${awaiting.length} čeká`, kind: 'warn', onClick: () => scrollToDriverSection('driver-awaiting-section') } : null,
    unreadNotices.length > 0 ? { key: 'notices', label: `🔔 ${unreadNotices.length} nové`, kind: 'warn', onClick: onOpenNotifications } : null,
    openShifts.length > 0 ? { key: 'open', label: `➕ ${openShifts.length} volné`, kind: 'warn', onClick: () => scrollToDriverSection('driver-open-shifts-section') } : null,
    incomingSwaps.length > 0 ? { key: 'swaps', label: `↔ ${incomingSwaps.length} výměny`, kind: 'warn', onClick: () => scrollToDriverSection('driver-incoming-swaps-section') } : null,
  ].filter(Boolean)
  const DriverActions = ({ shift, compact = false }) => {
    const canConfirm = !['confirmed','completed','cancelled'].includes(shift.status)
    const canDecline = !['declined','completed','cancelled'].includes(shift.status) && !shift.actualStartAt
    const canCheckIn = !shift.actualStartAt && !['declined','cancelled','completed'].includes(shift.status)
    const canCheckOut = Boolean(shift.actualStartAt && !shift.actualEndAt)
    const canSwap = !['cancelled','completed'].includes(shift.status) && !['pending','accepted'].includes(shift.swapRequestStatus)
    return <div className={compact ? 'driver-actions driver-actions-compact' : 'driver-actions'}>
      {canConfirm && <button className="primary" onClick={() => setStatus(shift.id, 'confirmed')}>Potvrdit</button>}
      {canCheckIn && <button className="primary soft-primary driver-primary-action" onClick={() => checkIn(shift.id)}>Nastoupil jsem</button>}
      {canCheckOut && <button className="primary" onClick={() => checkOut(shift.id)}>Ukončit směnu</button>}
      {canSwap && <button className="ghost" onClick={() => requestSwap(shift)}>Výměna</button>}
      {['pending','accepted'].includes(shift.swapRequestStatus) && <button className="danger" onClick={() => cancelSwap(shift)}>Zrušit výměnu</button>}
      {canDecline && <button className="danger" onClick={() => decline(shift)}>Odmítnout</button>}
    </div>
  }
  const ShiftMobileCard = ({ s, focusCard = false }) => {
    const isPendingAction = ['assigned', 'draft', 'pending'].includes(s.status)
    const isInProgress = Boolean(s.actualStartAt && !s.actualEndAt) || s.status === 'in_progress'
    const [startAt, endAt] = intervalForShift(s)
    const now = Date.now()
    const isStartWindow = startAt - now <= 60 * 60 * 1000 && endAt >= now
    const showStartPrompt = s.status === 'confirmed' && !s.actualStartAt && now >= startAt - 60 * 60 * 1000 && now <= startAt + 30 * 60 * 1000
    const shouldDefaultFull = focusCard || isPendingAction || isInProgress || isStartWindow || s.status !== 'confirmed'
    const isExpanded = expandedShiftId === s.id
    const compactCard = !shouldDefaultFull && !isExpanded
    const duration = actualDurationMinutes(s)
    const vehicle = helpers.vehicle(s.vehicleId)
    const conflictMessages = helpers.conflictMessages(s).filter((message) => !(message === 'Není vybrané vozidlo.' && !vehicle))
    if (compactCard) {
      return <button type="button" className="card driver-shift-card driver-shift-compact-card" onClick={() => setExpandedShiftId(s.id)}>
        <div className="driver-compact-main">
          <div>
            <span className="driver-compact-title">{formatDate(s.date)} · {s.start}–{s.end}</span>
            <p className="muted">{vehicle?.name ? `${vehicle.name} · ${vehicle.plate || 'SPZ nezadaná'}` : 'Vozidlo přiřadí dispečer před nástupem.'}</p>
          </div>
          <div className="driver-shift-status-row"><StatusPill status={s.status} helpers={helpers} /><span className="driver-card-toggle" aria-hidden="true">▾</span></div>
        </div>
      </button>
    }
    const canCollapse = !shouldDefaultFull
    return <div className={focusCard ? 'card driver-hero' : 'card driver-shift-card'}>
      <div className="driver-shift-head"><div><span className="driver-date">{formatDate(s.date)}{!conflictMessages.length && <em className="driver-ok-mini">· bez kolize</em>}</span><h3>{s.start}–{s.end}</h3><p className="muted">{vehicle?.name ? `${vehicle.name} · ${vehicle.plate || 'SPZ nezadaná'}` : 'Vozidlo přiřadí dispečer před nástupem.'}</p></div><div className="driver-shift-status-row"><StatusPill status={s.status} helpers={helpers} />{canCollapse && <button type="button" className="driver-card-toggle" aria-label="Sbalit směnu" onClick={() => setExpandedShiftId('')}>▴</button>}</div></div>
      {s.instruction && <div className="driver-instruction"><b>Instrukce:</b><br />{s.instruction}</div>}
      {s.note && <p className="muted driver-note">{s.note}</p>}
      {(s.actualStartAt || s.actualEndAt) && <div className="driver-mini-grid">{s.actualStartAt && <Kpi label="Nástup" value={new Date(s.actualStartAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })} hint="zaznamenáno" />}{s.actualEndAt && <Kpi label="Konec" value={new Date(s.actualEndAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })} hint="hotovo" />}{duration != null && <Kpi label="Reál" value={durationLabel(duration)} hint="docházka" />}</div>}
      {showStartPrompt && <div className="driver-info-line">Začněte směnu kliknutím na „Nastoupil jsem“.</div>}
      {conflictMessages.length > 0 && <ConflictBox messages={conflictMessages} />}
      {['pending','accepted'].includes(s.swapRequestStatus) && <div className="alert warn">Žádost o výměnu je odeslaná a čeká na admina.</div>}
      {s.declineReason && <p className="muted">Důvod odmítnutí: {s.declineReason}</p>}
      <DriverActions shift={s} compact={!focusCard} />
    </div>
  }
  const otherShifts = shifts.filter((s) => s.id !== focus?.id)
  return <div className="driver-view driver-mobile-view driver-priority-view">
    {driverToast && <div className="planner-toast" role="status">{driverToast}</div>}
    {focus ? <ShiftMobileCard s={focus} focusCard /> : <div className="empty driver-empty-focus"><b>Žádná nadcházející směna</b><br /><span className="muted">Zkontroluj volné směny níže nebo počkej na přiřazení od dispečera.</span></div>}
    {quickChips.length > 0 && <div className="driver-quick-strip" aria-label="Rychlý přehled">{quickChips.map((chip) => <button key={chip.key} type="button" className={`quick-chip ${chip.kind || ''}`} onClick={chip.onClick}>{chip.label}</button>)}</div>}
    {awaiting.length > 0 && <details id="driver-awaiting-section" className="card collapse-card driver-open-shifts"><summary><span><b>Čeká na potvrzení ({awaiting.length})</b><small>Směny vyžadující reakci</small></span><span className="pill warn">{awaiting.length}</span></summary><div className="collapse-content"><div className="stack">{awaiting.filter((s) => s.id !== focus?.id).map((s) => <ShiftMobileCard s={s} key={s.id} />)}{awaiting.filter((s) => s.id !== focus?.id).length === 0 && <div className="empty">Aktuální směna je zobrazená nahoře.</div>}</div></div></details>}
    <details id="driver-open-shifts-section" className="card driver-offers collapse-card driver-open-shifts"><summary><span><b>Zobrazit volné směny ({openShifts.length})</b><small>Nabídky, na které se můžeš přihlásit</small></span><span className={openShifts.length ? 'pill warn' : 'pill'}>{openShifts.length}</span></summary><div className="collapse-content"><div className="stack">{openShifts.map((shift) => { const interested = myOpenInterests.some((r) => r.shiftId === shift.id); return <div className="alert warn" key={shift.id}><b>{formatDate(shift.date)} {shift.start}–{shift.end}</b><br />{helpers.vehicleName(shift.vehicleId)} · {shift.note || 'Volná směna k obsazení'}<br />{shift.instruction && <small>Instrukce: {shift.instruction}</small>}<div className="row-actions" style={{ marginTop: 8 }}>{interested ? <span className="pill good">Zájem odeslán</span> : <button onClick={() => applyForOpenShift(shift)}>Mám zájem</button>}</div></div> })}{!openShifts.length && <div className="empty">Momentálně nejsou žádné volné směny.</div>}</div></div></details>
    {incomingSwaps.length > 0 && <div id="driver-incoming-swaps-section" className="card driver-offers"><div className="section-title"><h3>Nabídnuté výměny pro mě</h3><span className="pill warn">{incomingSwaps.length}</span></div><div className="stack">{incomingSwaps.map(({ request, shift }) => <div className="alert warn" key={request.id}><b>{formatDate(shift.date)} {shift.start}–{shift.end}</b><br />Nabízí: {helpers.driverName(request.driverId)} · {helpers.vehicleName(shift.vehicleId)}<br /><small>{request.reason || 'Bez zprávy'}</small><div className="row-actions" style={{ marginTop: 8 }}><button onClick={() => acceptSwap(request)}>Chci převzít směnu</button></div></div>)}</div></div>}
    <div className="section-title driver-list-title"><h3>Moje další směny</h3><span className="pill">{otherShifts.length}</span></div>
    <div className="driver-card-list">{otherShifts.map((s) => <ShiftMobileCard s={s} key={s.id} />)}{!otherShifts.length && <div className="empty">Nemáš další plánované směny.</div>}</div>
    <DriverTwoWeekCalendar shifts={shifts} openShifts={openShifts} helpers={helpers} />
  </div>
}
function DriverTwoWeekCalendar({ shifts, openShifts, helpers }) {
  const [selectedDay, setSelectedDay] = useState('')
  const [calendarOpen, setCalendarOpen] = useState(false)
  const weekStart = startOfWeek(todayISO())
  const dayRows = [0, 7].map((offset) => Array.from({ length: 7 }, (_, i) => addDays(weekStart, offset + i)))
  const modalRows = [0, 7, 14, 21].map((offset) => Array.from({ length: 7 }, (_, i) => addDays(weekStart, offset + i)))
  useEffect(() => {
    if (!calendarOpen) return undefined
    const onKey = (event) => { if (event.key === 'Escape') setCalendarOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [calendarOpen])
  const dayItems = (day) => [
    ...shifts.filter((s) => s.date === day).map((s) => ({ type: s.status === 'confirmed' ? 'confirmed' : 'own', label: `${s.start}–${s.end} · ${statusMap[s.status] || s.status}` })),
    ...openShifts.filter((s) => s.date === day).map((s) => ({ type: 'open', label: `${s.start}–${s.end} · volná směna` })),
  ]
  const weekLabel = (index) => index === 0 ? 'Tento týden' : (index === 1 ? 'Příští týden' : `Týden ${index + 1}`)
  const WeekRow = ({ days, index, interactive = true }) => <div className="driver-week-block">
    <div className="driver-week-title">{weekLabel(index)} <span>{formatDate(days[0])} – {formatDate(days[6])}</span></div>
    <div className="driver-week-grid">{days.map((day) => {
      const items = dayItems(day)
      const className = day === todayISO() ? 'driver-day today' : 'driver-day'
      const content = <><b>{weekdayMap[new Date(day).getDay()]?.slice(0,2)}</b><strong>{Number(day.slice(8,10))}</strong><small>{items.some((x) => x.type === 'open') ? '•' : ''}{items.some((x) => x.type === 'confirmed') ? '●' : ''}{items.some((x) => x.type === 'own') && !items.some((x) => x.type === 'confirmed') ? '◦' : ''}</small></>
      return interactive
        ? <button key={day} className={className} onClick={() => setSelectedDay(selectedDay === day ? '' : day)}>{content}</button>
        : <div key={day} className={className}>{content}</div>
    })}</div>
  </div>
  return <div className="card driver-calendar-card">
    <div className="section-title"><h3>Kalendář 2 týdny</h3><button type="button" className="pill" onClick={() => setCalendarOpen(true)}>Zobrazit</button></div>
    {dayRows.map((days, rowIndex) => <WeekRow key={rowIndex} days={days} index={rowIndex} />)}
    <div className="driver-calendar-legend"><span>• volná</span><span>● potvrzená</span><span>◦ ostatní moje</span></div>
    {selectedDay && <div className="alert good"><b>{formatDate(selectedDay)}</b><br />{dayItems(selectedDay).length ? dayItems(selectedDay).map((x, i) => <div key={i}>{x.label}</div>) : <span>Bez směn.</span>}</div>}
    {calendarOpen && <div className="modal-backdrop driver-calendar-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCalendarOpen(false) }}>
      <div className="modal-card card driver-calendar-modal" role="dialog" aria-modal="true" aria-label="Kalendář">
        <div className="section-title"><h3>Kalendář</h3><button className="ghost" onClick={() => setCalendarOpen(false)} aria-label="Zavřít kalendář">✕</button></div>
        <div className="driver-calendar-modal-body">{modalRows.map((days, rowIndex) => <WeekRow key={rowIndex} days={days} index={rowIndex} interactive={false} />)}</div>
        <div className="driver-calendar-legend"><span>• volná</span><span>● potvrzená</span><span>◦ ostatní moje</span></div>
      </div>
    </div>}
  </div>
}

function DriverSettings({ data, commit, currentDriver, profile, onlineMode, signOut, syncState }) {
  const devices = (data.pushSubscriptions || []).filter((p) => p.active !== false && p.driverId === currentDriver?.id)
  const removeDevice = (id) => safeDelete('push zařízení') && commit((prev) => ({ ...prev, pushSubscriptions: (prev.pushSubscriptions || []).map((p) => p.id === id ? { ...p, active: false } : p) }), 'Push zařízení bylo odhlášeno.')
  return <div className="driver-settings-view">
    <PageTitle title="Settings" />
    <div className="card"><div className="section-title"><h3>Účet</h3><span className={onlineMode ? 'pill good' : 'pill warn'}>{onlineMode ? 'Online' : 'Demo'}</span></div>
      <div className="compact-list"><div className="log"><b>{currentDriver?.name || profile?.full_name || 'Řidič'}</b><br /><span className="muted">{currentDriver?.email || profile?.email || 'Email nezadaný'}</span>{currentDriver?.phone && <><br /><span className="muted">{currentDriver.phone}</span></>}</div></div>
    </div>
    <div className="card"><div className="section-title"><h3>Notifikace</h3><span className="pill">{devices.length}</span></div><PushSetupCard data={data} commit={commit} currentDriver={currentDriver} isDriver={true} profile={profile} /></div>
    <details className="card collapse-card"><summary><span><b>Diagnostika</b><small>Zařízení a verze aplikace</small></span><span className="pill">{devices.length}</span></summary><div className="collapse-content stack">
      {devices.map((d) => <div className="log" key={d.id}><b>{deviceLabelFromUserAgent(d.platform)}</b><br /><small className="muted">Aktivní push zařízení</small><div className="row-actions" style={{ marginTop: 8 }}><button onClick={() => removeDevice(d.id)}>Odhlásit zařízení</button></div></div>)}
      {!devices.length && <div className="empty">Žádné aktivní push zařízení.</div>}
      <div className="log"><b>Verze app</b><br /><span className="muted">v{VERSION}</span></div>
      {syncState?.error && <div className="alert warn">{syncState.error}</div>}
    </div></details>
    <div className="card"><button className="danger" onClick={signOut}>Odhlásit</button></div>
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
  const pushResultLabel = (result) => {
    if (!result) return 'Server nevrátil žádnou odpověď.'
    if (result.skipped) {
      const labels = {
        'no-notifications': 'není co odeslat',
        'supabase-not-configured': 'chybí Supabase konfigurace ve frontendu',
        'missing-vapid-public-key': 'chybí VITE_VAPID_PUBLIC_KEY ve Vercelu',
      }
      return `Server push přeskočen: ${labels[result.reason] || result.reason}.`
    }
    if (!result.ok) return `Server push selhal: ${result.error || `HTTP ${result.status || '?'}`}`
    const recipients = (result.deliveries || []).reduce((sum, row) => sum + Number(row.recipients || 0), 0)
    if (!recipients) return 'Server odpověděl OK, ale nenašel žádné aktivní zařízení pro tento účet/roli. Klikni nejdřív na Povolit notifikace na tomto zařízení.'
    return `Server push OK: odesláno ${result.sent || 0}, selhalo ${result.failed || 0}, cílová zařízení ${recipients}.`
  }
  const serverTest = async () => {
    const notice = makeNotice({
      title: 'RBSHIFT server push test',
      body: 'Toto je ostrý test přes Vercel backend a uložené zařízení.',
      targetDriverId: isDriver ? currentDriver?.id || '' : '',
      targetRole: isDriver ? 'driver_all' : (profile?.role || 'admin'),
      type: 'push-test',
    })
    setStatus('Odesílám server push test…')
    commit((prev) => addNotificationsToData(prev, notice), 'Odeslán test serverové push notifikace.')
    const result = await sendPushForNotifications([notice])
    setStatus(pushResultLabel(result))
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
      {myDevices.map((d) => <div className="device-row" key={d.id}><div><b>{deviceLabelFromUserAgent(d.platform)}</b><br /><small className="muted">{d.active === false ? 'Vypnuté zařízení' : 'Aktivní push zařízení'}</small></div>{d.active !== false && <button className="danger" onClick={() => deactivateDevice(d.id)}>Odebrat</button>}</div>)}
      {!myDevices.length && <div className="empty">Na tomto účtu zatím není uložené žádné zařízení.</div>}
    </div>
    <p className="hintline">Notifikace dostanete na všechna zařízení, kde je app aktivní.</p>
  </div>
}

function NotificationsView({ data, helpers, commit, currentDriver, isDriver, profile }) {
  const visible = (data.notifications || []).filter((n) => isNoticeVisible(n, currentDriver, isDriver))
  const unread = visible.filter((n) => !isNoticeRead(n, currentDriver, isDriver))
  const [undoDeleteIds, setUndoDeleteIds] = useState([])
  const markOne = (id) => commit((prev) => ({ ...prev, notifications: (prev.notifications || []).map((n) => n.id === id ? markNoticeRead(n, currentDriver, isDriver) : n) }), 'Notifikace označena jako přečtená.')
  const queueUndo = (ids) => {
    const clean = [...new Set((ids || []).filter(Boolean))]
    if (!clean.length) return
    setUndoDeleteIds(clean)
    setTimeout(() => setUndoDeleteIds((current) => clean.every((id) => current.includes(id)) ? [] : current), 5000)
  }
  const deleteOne = (id) => {
    if (!visible.some((n) => n.id === id)) return
    commit((prev) => ({ ...prev, notifications: (prev.notifications || []).map((n) => n.id === id ? markNoticeDeleted(n, currentDriver, isDriver) : n) }), 'Notifikace skryta.')
    queueUndo([id])
  }
  const undoDelete = () => {
    if (!undoDeleteIds.length) return
    const ids = new Set(undoDeleteIds)
    commit((prev) => ({ ...prev, notifications: (prev.notifications || []).map((n) => ids.has(n.id) ? unmarkNoticeDeleted(n, currentDriver, isDriver) : n) }), 'Smazání notifikace vráceno zpět.')
    setUndoDeleteIds([])
  }
  const markAll = () => commit((prev) => ({ ...prev, notifications: (prev.notifications || []).map((n) => isNoticeVisible(n, currentDriver, isDriver) ? markNoticeRead(n, currentDriver, isDriver) : n) }), 'Notifikace označeny jako přečtené.')
  const clearRead = () => {
    const ids = visible.filter((n) => isNoticeRead(n, currentDriver, isDriver)).map((n) => n.id)
    if (!ids.length || !safeDelete('smazání přečtených notifikací')) return
    const idSet = new Set(ids)
    commit((prev) => ({ ...prev, notifications: (prev.notifications || []).map((n) => idSet.has(n.id) ? markNoticeDeleted(n, currentDriver, isDriver) : n) }), 'Přečtené notifikace skryty.')
    queueUndo(ids)
  }
  return <>
    <PageTitle title="Notifikace">
      <button className="ghost" onClick={markAll}>Označit vše jako přečtené</button>
      <button className="danger" onClick={clearRead}>Smazat přečtené</button>
    </PageTitle>
    {undoDeleteIds.length > 0 && <div className="toast-undo"><span>{undoDeleteIds.length === 1 ? 'Notifikace smazána.' : `${undoDeleteIds.length} notifikací smazáno.`}</span><button onClick={undoDelete}>Vrátit zpět</button></div>}
    <div className="card"><div className="section-title"><h3>Centrum upozornění</h3><span className={unread.length ? 'pill warn' : 'pill good'}>{unread.length} nepřečteno</span></div><div className="stack">
      {visible.map((n) => {
        const read = isNoticeRead(n, currentDriver, isDriver)
        return <div className={read ? 'log notification-row' : 'alert warn notification-row'} key={n.id}>
          <div className="split"><div><b>{n.title}</b><br /><small className="muted">{new Date(n.at).toLocaleString('cs-CZ')}</small></div>{!read && <span className="pill warn">nové</span>}</div>
          <p>{n.body || 'Bez detailu'}</p>
          <div className="row-actions notification-actions" style={{ marginTop: 8 }}>
            {!read && <button onClick={() => markOne(n.id)}>Přečteno</button>}
            <button className="danger-mini" onClick={() => deleteOne(n.id)}>Smazat</button>
          </div>
        </div>
      })}
      {!visible.length && <div className="empty">Zatím žádné notifikace.</div>}
    </div></div>
    {!isDriver && <div className="stack" style={{ marginTop: 16 }}><PushSetupCard data={data} commit={commit} currentDriver={currentDriver} isDriver={isDriver} profile={profile} /></div>}
  </>
}



function ShiftTemplates({ data, commit }) {
  const empty = { name: '', start: '07:00', end: '19:00', active: true, type: 'custom' }
  const templates = normalizeShiftTemplates(data.settings)
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const activeCount = templates.filter((tpl) => tpl.active).length
  const closeDrawer = () => { setDrawerOpen(false); setEditing(null); setForm(empty) }
  const openCreate = () => { setForm(empty); setEditing(null); setDrawerOpen(true) }
  const openEdit = (tpl) => { setForm({ ...empty, ...tpl }); setEditing(tpl.id); setDrawerOpen(true) }
  const saveTemplates = (updater, message) => commit((prev) => {
    const current = normalizeShiftTemplates(prev.settings)
    const nextTemplates = updater(current)
    return { ...prev, settings: { ...prev.settings, shiftTemplates: nextTemplates } }
  }, message)
  const submit = (e) => {
    e.preventDefault()
    const name = form.name.trim()
    if (!name) return alert('Vyplň název šablony.')
    if (!form.start || !form.end) return alert('Vyplň začátek a konec šablony.')
    const payload = { id: editing || uid('tpl'), name, start: form.start, end: form.end, active: form.active !== false, type: form.type || 'custom' }
    if (editing) saveTemplates((items) => items.map((tpl) => tpl.id === editing ? { ...tpl, ...payload } : tpl), 'Šablona směny upravena.')
    else saveTemplates((items) => [payload, ...items], 'Šablona směny vytvořena.')
    closeDrawer()
  }
  const deactivate = (tpl) => {
    if (!tpl?.id || !confirm('Deaktivovat tuto šablonu směny? Existující směny se nezmění.')) return
    saveTemplates((items) => items.map((item) => item.id === tpl.id ? { ...item, active: false } : item), 'Šablona směny deaktivována.')
    closeDrawer()
  }
  const restore = (tpl) => saveTemplates((items) => items.map((item) => item.id === tpl.id ? { ...item, active: true } : item), 'Šablona směny znovu aktivována.')
  return <>
    <PageTitle title="Šablony směn"><button className="primary" onClick={openCreate}>+ Přidat šablonu</button></PageTitle>
    <div className="card">
      <div className="section-title"><h3>Časy směn</h3><span className="pill">{activeCount} aktivní / {templates.length} celkem</span></div>
      <div className="stack compact-list">
        {templates.map((tpl) => <div className="log" key={tpl.id} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => openEdit(tpl)} onKeyDown={(e) => { if (e.key === 'Enter') openEdit(tpl) }}>
          <div className="split">
            <div><b>{tpl.name}</b><br /><small className="muted">{tpl.start}–{tpl.end} · {shiftTypeMap[tpl.type] || 'Vlastní'}</small></div>
            <span className={tpl.active ? 'pill good' : 'pill bad'}>{tpl.active ? 'Aktivní' : 'Neaktivní'}</span>
          </div>
          <div className="row-actions" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => openEdit(tpl)}>Upravit</button>
            {tpl.active === false ? <button onClick={() => restore(tpl)}>Obnovit</button> : <button className="danger-mini" onClick={() => deactivate(tpl)}>Deaktivovat</button>}
          </div>
        </div>)}
      </div>
    </div>
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title"><h3>Použití při tvorbě směny</h3></div>
      <div className="log"><b>Dropdown „Šablona směny“</b><br /><span className="muted">Při vytváření nové směny se v nabídce zobrazují jen aktivní šablony. Volba „Vlastní čas“ zůstává dostupná vždy.</span></div>
    </div>
    <SideDrawer title={editing ? 'Detail šablony' : 'Přidat šablonu'} open={drawerOpen} onClose={closeDrawer}>
      <form className="form two-col" onSubmit={submit}>
        <Field label="Název šablony" className="span2"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus required /></Field>
        <Field label="Začátek"><input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} required /></Field>
        <Field label="Konec"><input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} required /></Field>
        <Field label="Typ směny"><Select value={form.type} onChange={(value) => setForm({ ...form, type: value })} options={shiftTypeMap} /></Field>
        <Field label="Aktivní"><select value={String(form.active)} onChange={(e) => setForm({ ...form, active: e.target.value === 'true' })}><option value="true">Ano</option><option value="false">Ne</option></select></Field>
        <div className="field span2 drawer-form-actions">
          <button className="primary" type="submit">{editing ? 'Uložit změny' : 'Vytvořit šablonu'}</button>
          <button className="ghost" type="button" onClick={closeDrawer}>Zrušit</button>
        </div>
        {editing && <div className="field span2">
          <button className="danger" type="button" onClick={() => deactivate(form)} disabled={form.active === false}>Deaktivovat šablonu</button>
        </div>}
      </form>
    </SideDrawer>
  </>
}


function History({ data }) {
  const pageSize = 50
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [userFilter, setUserFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [page, setPage] = useState(1)
  const logs = [...(data.audit || [])].sort((a, b) => String(b.at || b.createdAt || '').localeCompare(String(a.at || a.createdAt || '')))
  const typeOptions = {
    all: 'Všechny typy',
    shifts: 'Směny',
    drivers: 'Řidiči',
    vehicles: 'Vozidla',
    availability: 'Dostupnost',
    notifications: 'Notifikace',
    settings: 'Nastavení',
    other: 'Ostatní',
  }
  const logDate = (log) => String(log.at || log.createdAt || '').slice(0, 10)
  const logText = (log) => String(log.text || log.action || '')
  const logType = (log) => {
    const text = logText(log).toLocaleLowerCase('cs-CZ')
    if (/směn|smen|shift|výměn|vymen|koliz/.test(text)) return 'shifts'
    if (/řidič|ridic|driver/.test(text)) return 'drivers'
    if (/vozidl|vozidlo|vůz|vuz|auto|car|spz/.test(text)) return 'vehicles'
    if (/dostupnost|nepřítomnost|nepritomnost|absence/.test(text)) return 'availability'
    if (/notifik|upozorn/.test(text)) return 'notifications'
    if (/nastaven|šablon|sablon|firma|integrac|supabase/.test(text)) return 'settings'
    return 'other'
  }
  const logActor = (log) => log.actor || log.user || log.userName || log.payload?.user || log.payload?.actor || ''
  const filtered = logs.filter((log) => {
    const d = logDate(log)
    const text = logText(log).toLocaleLowerCase('cs-CZ')
    const actor = String(logActor(log)).toLocaleLowerCase('cs-CZ')
    const q = userFilter.trim().toLocaleLowerCase('cs-CZ')
    if (dateFrom && d && d < dateFrom) return false
    if (dateTo && d && d > dateTo) return false
    if (typeFilter !== 'all' && logType(log) !== typeFilter) return false
    if (q && !actor.includes(q) && !text.includes(q)) return false
    return true
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  useEffect(() => setPage(1), [dateFrom, dateTo, userFilter, typeFilter])
  const resetFilters = () => { setDateFrom(''); setDateTo(''); setUserFilter(''); setTypeFilter('all'); setPage(1) }
  const exportFiltered = () => {
    const rows = [['Datum','Typ','Uživatel','Popis']]
    filtered.forEach((log) => rows.push([new Date(log.at || log.createdAt || '').toLocaleString('cs-CZ'), typeOptions[logType(log)] || 'Ostatní', logActor(log) || '', logText(log)]))
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';')).join('\n')
    download(`rbshift-historie-${todayISO()}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8')
  }
  return <>
    <PageTitle title="Historie změn">
      <button className="ghost" onClick={resetFilters}>Reset filtrů</button>
      <button className="primary" onClick={exportFiltered}>Export CSV</button>
    </PageTitle>
    <div className="card">
      <div className="section-title"><h3>Filtry</h3><span className="pill">{filtered.length} / {logs.length}</span></div>
      <div className="form four">
        <Field label="Datum od"><input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></Field>
        <Field label="Datum do"><input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></Field>
        <Field label="Uživatel / text"><input value={userFilter} onChange={(e) => setUserFilter(e.target.value)} placeholder="jméno, e-mail nebo text akce" /></Field>
        <Field label="Typ akce"><select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>{Object.entries(typeOptions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      </div>
    </div>
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title">
        <h3>Záznamy</h3>
        <span className="pill">strana {safePage}/{totalPages} · {pageRows.length} záznamů</span>
      </div>
      <div className="stack">
        {pageRows.map((log) => {
          const type = logType(log)
          const date = log.at || log.createdAt || ''
          const text = logText(log)
          const actor = logActor(log)
          return <details className="collapse-card history-item" key={log.id || `${date}-${text}`} style={{ border: '1px solid var(--line)', borderRadius: 16, background: 'rgba(255,255,255,.035)' }}>
            <summary>
              <span><b>{text || 'Záznam bez popisu'}</b><small>{date ? new Date(date).toLocaleString('cs-CZ') : 'bez data'}{actor ? ` · ${actor}` : ''}</small></span>
              <span className="pill">{typeOptions[type] || 'Ostatní'}</span>
            </summary>
            <div className="collapse-content">
              <div className="grid two">
                <div className="log"><b>Detail akce</b><br /><span className="muted">{text || 'Bez detailu'}</span></div>
                <div className="log"><b>Metadata</b><br /><span className="muted">ID: {log.id || '—'}<br />Typ: {typeOptions[type] || 'Ostatní'}<br />Uživatel: {actor || 'nezjištěno'}</span></div>
              </div>
              {log.payload && <pre className="log" style={{ overflow: 'auto', marginTop: 12 }}>{JSON.stringify(log.payload, null, 2)}</pre>}
            </div>
          </details>
        })}
        {!pageRows.length && <div className="empty">Žádné záznamy neodpovídají filtrům.</div>}
      </div>
      <div className="row-actions" style={{ marginTop: 14, justifyContent: 'space-between' }}>
        <button className="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>← Předchozí</button>
        <span className="muted">Zobrazeno {(safePage - 1) * pageSize + (pageRows.length ? 1 : 0)}–{(safePage - 1) * pageSize + pageRows.length} z {filtered.length}</span>
        <button className="ghost" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>Další →</button>
      </div>
    </div>
  </>
}


const defaultDriverReminderCron = '0 18 * * 3'
const weekdayCronMap = {
  0: 'neděle',
  1: 'pondělí',
  2: 'úterý',
  3: 'středa',
  4: 'čtvrtek',
  5: 'pátek',
  6: 'sobota',
}
function parseDriverReminderCron(value = defaultDriverReminderCron) {
  const parts = String(value || defaultDriverReminderCron).trim().split(/\s+/)
  if (parts.length !== 5) return { minute: '0', hour: '18', weekday: '3' }
  return { minute: parts[0], hour: parts[1], weekday: parts[4] }
}
function buildWeeklyCron(weekday = '3', timeValue = '18:00') {
  const [hour = '18', minute = '00'] = String(timeValue || '18:00').split(':')
  return `${Number(minute || 0)} ${Number(hour || 18)} * * ${weekday}`
}
function cronTimeValue(cron = defaultDriverReminderCron) {
  const parsed = parseDriverReminderCron(cron)
  return `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`
}
function isValidSimpleWeeklyCron(value = '') {
  const parts = String(value || '').trim().split(/\s+/)
  if (parts.length !== 5) return false
  const [minute, hour, dayOfMonth, month, weekday] = parts
  const nMinute = Number(minute)
  const nHour = Number(hour)
  const nWeekday = Number(weekday)
  return Number.isInteger(nMinute) && nMinute >= 0 && nMinute <= 59 &&
    Number.isInteger(nHour) && nHour >= 0 && nHour <= 23 &&
    dayOfMonth === '*' && month === '*' &&
    Number.isInteger(nWeekday) && nWeekday >= 0 && nWeekday <= 6
}
function humanDriverReminderCron(value = defaultDriverReminderCron) {
  if (!isValidSimpleWeeklyCron(value)) return 'Neplatný cron formát'
  const parsed = parseDriverReminderCron(value)
  return `Každou ${weekdayCronMap[Number(parsed.weekday)] || 'středu'} v ${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`
}

function Settings({ title = 'Nastavení', data, commit, supabase, onlineMode, reloadOnline, profile }) {
  const [name, setName] = useState(data.settings?.companyName || 'RBSHIFT')
  const [contact, setContact] = useState(data.settings?.companyContact || '')
  const [logoUrl, setLogoUrl] = useState(data.settings?.logoUrl || '')
  const [times, setTimes] = useState(configuredShiftTimes(data.settings))
  const currentDriverReminderCron = data.settings?.driverReminderSchedule || defaultDriverReminderCron
  const [driverReminderCron, setDriverReminderCron] = useState(currentDriverReminderCron)
  const [driverReminderWeekday, setDriverReminderWeekday] = useState(parseDriverReminderCron(currentDriverReminderCron).weekday)
  const [driverReminderTime, setDriverReminderTime] = useState(cronTimeValue(currentDriverReminderCron))
  const [driverReminderStatus, setDriverReminderStatus] = useState('')
  const [notificationConfig, setNotificationConfig] = useState(() => ({
    push: data.settings?.notifications?.push !== false,
    email: data.settings?.notifications?.email === true,
    whatsapp: data.settings?.notifications?.whatsapp === true,
  }))
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
  const whatsappConfigured = Boolean(data.settings?.integrations?.whatsappConfigured || import.meta.env.VITE_WHATSAPP_API_URL || import.meta.env.VITE_WHATSAPP_API_KEY)
  const operationalNotificationRules = [
    ['Nová směna', 'řidič dostane upozornění po vytvoření nebo přiřazení směny'],
    ['Změna směny', 'řidič dostane upozornění při změně času, auta, instrukcí nebo stavu'],
    ['Výměny směn', 'dispečer vidí žádosti a schvaluje převzetí směny'],
    ['Nástup / konec směny', 'změna se propíše do provozní historie a notifikací'],
  ]
  useEffect(() => {
    setName(data.settings?.companyName || 'RBSHIFT')
    setContact(data.settings?.companyContact || '')
    setLogoUrl(data.settings?.logoUrl || '')
  }, [data.settings?.companyName, data.settings?.companyContact, data.settings?.logoUrl])
  useEffect(() => setTimes(configuredShiftTimes(data.settings)), [data.settings?.shiftTimes])
  useEffect(() => {
    const cron = data.settings?.driverReminderSchedule || defaultDriverReminderCron
    const parsed = parseDriverReminderCron(cron)
    setDriverReminderCron(cron)
    setDriverReminderWeekday(parsed.weekday)
    setDriverReminderTime(cronTimeValue(cron))
  }, [data.settings?.driverReminderSchedule])
  useEffect(() => setNotificationConfig({
    push: data.settings?.notifications?.push !== false,
    email: data.settings?.notifications?.email === true,
    whatsapp: data.settings?.notifications?.whatsapp === true,
  }), [data.settings?.notifications])
  const saveGeneral = () => commit((prev) => ({ ...prev, settings: { ...prev.settings, companyName: name, companyContact: contact, logoUrl } }), 'Upraveno obecné nastavení.')
  const saveTimes = () => commit((prev) => ({ ...prev, settings: { ...prev.settings, shiftTimes: times } }), 'Upraveno nastavení časů směn.')
  const saveNotifications = () => commit((prev) => ({ ...prev, settings: { ...prev.settings, notifications: notificationConfig } }), 'Upraveno nastavení notifikací.')
  const applyDriverReminderPreset = () => {
    const cron = buildWeeklyCron(driverReminderWeekday, driverReminderTime)
    setDriverReminderCron(cron)
  }
  const saveDriverReminderSchedule = async () => {
    const cron = String(driverReminderCron || '').trim()
    if (!isValidSimpleWeeklyCron(cron)) return alert('Zadej cron ve formátu: minuta hodina * * den_v_týdnu. Například 0 18 * * 3.')
    setDriverReminderStatus('Ukládám nastavení připomínky…')
    commit((prev) => ({ ...prev, settings: { ...prev.settings, driverReminderSchedule: cron } }), 'Upraven čas připomínky volných směn řidičům.')
    if (onlineMode && supabase?.rpc) {
      const { error } = await supabase.rpc('refresh_driver_reminder_cron')
      if (error) {
        setDriverReminderStatus(`Uloženo, ale cron se nepodařilo obnovit automaticky: ${error.message}`)
        return
      }
      setDriverReminderStatus('Uloženo a cron job byl obnoven.')
      return
    }
    setDriverReminderStatus('Uloženo lokálně. Cron obnov v Supabase SQL: select public.refresh_driver_reminder_cron();')
  }
  const requestWhatsappReset = () => commit((prev) => ({ ...prev, settings: { ...prev.settings, integrations: { ...(prev.settings?.integrations || {}), whatsappConfigured: false, whatsappKeyResetRequestedAt: new Date().toISOString() } } }), 'Vyžádán reset WhatsApp integrace.')
  return <><PageTitle title={title} />
    <div className="grid two">
      <div className="card">
        <div className="section-title"><h3>Obecné</h3></div>
        <div className="form two-col">
          <Field label="Jméno firmy"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Kontakt"><input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="+420 777 702 702" /></Field>
          <Field label="Logo URL" className="span2"><input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" /></Field>
          <div className="field span2"><button className="primary" onClick={saveGeneral}>Uložit obecné</button></div>
        </div>
      </div>
      <div className="card">
        <div className="section-title"><h3>Šablony směn</h3><span className="pill">globální</span></div>
        <div className="form two-col">
          <Field label="Denní od"><input type="time" value={times.dayStart} onChange={(e) => setTimes({ ...times, dayStart: e.target.value })} /></Field>
          <Field label="Denní do"><input type="time" value={times.dayEnd} onChange={(e) => setTimes({ ...times, dayEnd: e.target.value })} /></Field>
          <Field label="Noční od"><input type="time" value={times.nightStart} onChange={(e) => setTimes({ ...times, nightStart: e.target.value })} /></Field>
          <Field label="Noční do"><input type="time" value={times.nightEnd} onChange={(e) => setTimes({ ...times, nightEnd: e.target.value })} /></Field>
          <Field label="Akce od"><input type="time" value={times.eventStart} onChange={(e) => setTimes({ ...times, eventStart: e.target.value })} /></Field>
          <Field label="Akce do"><input type="time" value={times.eventEnd} onChange={(e) => setTimes({ ...times, eventEnd: e.target.value })} /></Field>
          <div className="field span2"><button className="primary" onClick={saveTimes}>Uložit šablony</button></div>
        </div>
      </div>
    </div>
    <div className="grid two" style={{ marginTop: 16 }}>
      <div className="card">
        <div className="section-title"><h3>Notifikace</h3></div>
        <div className="stack">
          <label className="quick-item"><span><strong>Push notifikace</strong><small>okamžitá upozornění v aplikaci</small></span><input type="checkbox" checked={notificationConfig.push} onChange={(e) => setNotificationConfig({ ...notificationConfig, push: e.target.checked })} /></label>
          <label className="quick-item"><span><strong>E-mail</strong><small>doplňkový kanál pro důležité zprávy</small></span><input type="checkbox" checked={notificationConfig.email} onChange={(e) => setNotificationConfig({ ...notificationConfig, email: e.target.checked })} /></label>
          <label className="quick-item"><span><strong>WhatsApp</strong><small>kanál pro provozní zprávy řidičům</small></span><input type="checkbox" checked={notificationConfig.whatsapp} onChange={(e) => setNotificationConfig({ ...notificationConfig, whatsapp: e.target.checked })} /></label>
          <button className="primary" onClick={saveNotifications}>Uložit notifikace</button>
        </div>
        <div className="stack" style={{ marginTop: 14 }}>
          {operationalNotificationRules.map(([rule, description]) => <div className="log" key={rule}><b>{rule}</b><br /><span className="muted">{description}</span></div>)}
        </div>
      </div>
      <div className="card">
        <div className="section-title"><h3>Připomínka volných směn</h3><span className="pill">{humanDriverReminderCron(driverReminderCron)}</span></div>
        <div className="form two-col">
          <Field label="Den v týdnu"><select value={driverReminderWeekday} onChange={(e) => setDriverReminderWeekday(e.target.value)}>{Object.entries(weekdayCronMap).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
          <Field label="Čas"><input type="time" value={driverReminderTime} onChange={(e) => setDriverReminderTime(e.target.value)} /></Field>
          <div className="field span2"><button className="ghost" onClick={applyDriverReminderPreset}>Převést na cron</button></div>
          <Field label="Cron expression" className="span2"><input value={driverReminderCron} onChange={(e) => setDriverReminderCron(e.target.value)} placeholder="0 18 * * 3" /></Field>
          <div className="field span2"><button className="primary" onClick={saveDriverReminderSchedule}>Uložit připomínku</button></div>
        </div>
        <div className="log" style={{ marginTop: 12 }}>
          <b>Aktuální pravidlo</b><br />
          <span className="muted">Job driver-signup-reminder upozorní aktivní řidiče na volné směny v příštích 14 dnech. Výchozí hodnota je každou středu v 18:00.</span>
        </div>
        {driverReminderStatus && <div className="alert warn" style={{ marginTop: 12 }}>{driverReminderStatus}</div>}
      </div>
    </div>
    <div className="grid two" style={{ marginTop: 16 }}>
      <div className="card">
        <div className="section-title"><h3>Integrace</h3></div>
        <div className="form">
          <Field label="WhatsApp API klíč"><input type="password" value={whatsappConfigured ? '••••••••••••' : ''} readOnly placeholder="není nastaveno" /></Field>
          <div className="row-actions">
            <button className="ghost" onClick={requestWhatsappReset} disabled={!whatsappConfigured}>Resetovat WhatsApp klíč</button>
          </div>
          <Field label="Supabase URL"><input value={supabaseUrl || (supabase ? 'připojeno' : 'není nastaveno')} readOnly /></Field>
          <div className="sync-line"><span className={onlineMode ? 'status-dot good' : 'status-dot warn'}></span><span className="muted">{onlineMode ? 'Supabase je připojený' : 'Aplikace běží bez online připojení'}</span></div>
        </div>
      </div>
      <div className="card">
        <div className="section-title"><h3>O aplikaci</h3><span className="pill">v{VERSION}</span></div>
        <div className="grid four">
          <Kpi label="Verze" value={`v${VERSION}`} hint="aktuální build" />
          <Kpi label="Build" value="React + Vite" hint="webová administrace" />
          <Kpi label="Prostředí" value={onlineMode ? 'Online' : 'Lokální'} hint={onlineMode ? 'Supabase' : 'bez Supabase'} />
          <Kpi label="Uživatel" value={profile?.role || 'admin'} hint="aktuální role" />
        </div>
        <div className="stack" style={{ marginTop: 14 }}>
          <div className="log"><b>Changelog</b><br /><span className="muted">Přidáno nastavení připomínky volných směn pro řidiče.</span></div>
        </div>
      </div>
    </div>
  </>
}

function weekText(data, helpers, weekStart, count = 7) {
  const days = Array.from({ length: count }, (_, i) => addDays(weekStart, i))
  const lines = [`RB TAXI – plán směn ${formatDate(weekStart)} až ${formatDate(addDays(weekStart, count - 1))}`, '']
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
  return <div className="auth-shell"><div className="card auth-card"><div className="brand"><div className="logo">RB</div><div><h1>RBSHIFT</h1><small>Online přihlášení</small></div></div><form className="stack" onSubmit={submit}><Field label="E-mail"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field><Field label="Heslo"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></Field><button className="primary" disabled={busy}>{busy ? 'Pracuji…' : mode === 'login' ? 'Přihlásit' : 'Vytvořit účet'}</button></form><div className="row-actions" style={{ marginTop: 12 }}><button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'Vytvořit účet' : 'Mám účet – přihlásit'}</button></div>{msg && <p className="hintline">{msg}</p>}</div></div>
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
  return <div className="auth-shell"><div className="card auth-card"><h2>Chybí profil uživatele</h2><p className="muted">Přihlášení existuje, ale v tabulce <b>profiles</b> není záznam pro tento účet.</p>{error && <div className="alert bad">{error}</div>}<Field label="Jméno pro profil řidiče"><input value={name} onChange={(e) => setName(e.target.value)} /></Field><div className="row-actions" style={{ marginTop: 12 }}><button className="primary" disabled={busy} onClick={createDriverProfile}>Vytvořit profil řidiče</button><button onClick={reload}>Zkusit načíst znovu</button><button onClick={() => supabase.auth.signOut()}>Odhlásit</button></div></div></div>
}

createRoot(document.getElementById('root')).render(<Root />)
