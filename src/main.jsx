import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient } from '@supabase/supabase-js'

const VERSION = '1.3.8-v5.4.3-driver-swap-fix'
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
  const label = `${formatDate(shift.date)} ${shift.start}–${shift.end} · ${helpers.driverName(shift.driverId)} · ${helpers.vehicleName(shift.vehicleId)}`;
  // Add the rest of the function logic here
}
