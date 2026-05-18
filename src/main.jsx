import './main.css'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient } from '@supabase/supabase-js'
import { Bell, Clock, House, Settings as SettingsIcon, Trash2 } from 'lucide-react'
import { AuthGate, MissingProfile } from './AuthViews.jsx'
import { DriverHome } from './DriverHome.jsx'
import { DriverSettings } from './DriverSettings.jsx'
import { NotificationsView } from './NotificationsView.jsx'
import { SettingsView } from './SettingsView.jsx'
import { createAppDataSync } from './lib/appDataSync.js'
import {
  actualDurationMinutes,
  addDays,
  dateInRange,
  datetimeLocal,
  durationLabel,
  formatDate,
  hoursLabel,
  intervalForShift,
  localStamp,
  minutes,
  overlapsShift,
  overlapsTimeWindow,
  startOfWeek,
  timePart,
  todayISO,
} from './lib/dateTime.js'
import {
  addNotificationsToData,
  createNoticeFactory,
} from './lib/notifications.js'
import { notificationInboxState } from './lib/notificationInbox.js'
import { uid } from './lib/ids.js'
import { sendPushForNotifications } from './lib/pushDelivery.js'
import {
  canOpenSettlement,
  computeSettlementMetrics,
  settlementConfigDefaults,
  settlementDefaultInputs,
  settlementForShift,
  settlementIsClosed,
  shiftIsInStartWindow,
  shiftNeedsSettlementAction,
  validateSettlementInputs,
} from './lib/settlements.js'
import { appFriendlyError } from './lib/errors.js'
import {
  repeatMap,
  settlementStatusMap,
  settlementToneMap,
  shiftTypeMap,
  statusMap,
  statusToneMap,
} from './lib/appConfig.js'
import {
  configuredShiftTimes,
  normalizeShiftTemplates,
  shiftTemplateOptions,
  shiftTemplateValue,
} from './lib/shiftTemplates.js'
import {
  activeSwapForShift,
  calendarDriverLabel,
  calendarShiftLineClass,
  driverInitials,
  money,
  shiftNoticeBody,
  shiftTypeName,
  sortByDateTime,
  staffDisplayName,
  staffInitials,
  statusCounts,
  time,
  todayRangeTitle,
} from './lib/display.js'
import {
  availabilityCoversShift,
  availabilityKind,
  availabilityKindMap,
  availabilityKindTone,
  availabilityLabel,
  availabilityNoteText,
  availabilityRangeOverlaps,
  availabilityRelevantToShift,
} from './lib/availability.js'
import {
  attendanceRows,
  coverageGaps,
  readinessChecks,
  readinessText,
} from './lib/opsMetrics.js'

const VERSION = `${__APP_VERSION__}-vycetka`
const makeNotice = createNoticeFactory(uid)
const swapStatusMap = { pending: 'Nabídnuto', accepted: 'Přijato kolegou', approved: 'Schváleno', rejected: 'Zamítnuto', cancelled: 'Zrušeno řidičem' }
const pageTitleMap = { planner: 'Plán směn', dashboard: 'Dashboard', audit: 'Audit provozu', settlements: 'Výčetky', notifications: 'Notifikace', shifts: 'Seznam směn', drivers: 'Řidiči', vehicles: 'Vozidla', availability: 'Dostupnost', shiftTemplates: 'Šablony směn', history: 'Historie změn', settings: 'Nastavení' }

const dispatcherNavItems = [
  ['planner', 'Plán směn'],
  ['dashboard', 'Dashboard'],
  ['settlements', 'Výčetky'],
  ['notifications', 'Notifikace'],
  ['audit', 'Audit']
]
const adminNavItems = [
  ['drivers', 'Řidiči'],
  ['vehicles', 'Vozidla'],
  ['availability', 'Dostupnost'],
  ['shiftTemplates', 'Šablony'],
  ['history', 'Historie'],
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
  const body = shiftNoticeBody(shift, helpers, reason ? `důvod: ${reason}` : '')
  return makeNotice({ title: `Stav směny: ${label}`, body, ...shiftNoticeTarget(shift), type: `shift-${status}`, shiftId: shift.id })
}
function cancellationNoticeForShift(shift, helpers, reason = '') {
  return makeNotice({
    title: 'Směna byla zrušena',
    body: shiftNoticeBody(shift, helpers, reason),
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
    if (r.acceptedByDriverId && r.acceptedByDriverId !== shift.driverId) notices.push(makeNotice({ title: 'Výměna směny zrušena', body: shiftNoticeBody(shift, helpers), targetDriverId: r.acceptedByDriverId, type: 'swap-cancelled', shiftId: shift.id }))
    if (r.targetDriverId && r.targetDriverId !== shift.driverId) notices.push(makeNotice({ title: 'Nabídka výměny zrušena', body: shiftNoticeBody(shift, helpers), targetDriverId: r.targetDriverId, type: 'swap-cancelled', shiftId: shift.id }))
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
function appendSwapHistory(req, text) {
  return { ...req, history: [...(req.history || []), { at: new Date().toISOString(), text }] }
}

const driverHomeServices = { uid, makeNotice, adminNotice, appendSwapHistory }


const isConfiguredSupabase = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
const supabase = isConfiguredSupabase ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY) : null
const { useAppData } = createAppDataSync({ supabase, isConfiguredSupabase, timePart, sendPushForNotifications })
const notificationServices = { uid, makeNotice, sendPushForNotifications }

function isPastLocked(shift) {
  if (!shift?.date) return false
  return shift.date < todayISO()
}
function exportAttendanceCSV(data, helpers, from, to) {
  const rows = [['Řidič','Směn','Dokončeno','Plán minut','Reál minut','Rozdíl minut','Otevřené směny']]
  attendanceRows(data, helpers, from, to).forEach((row) => rows.push([row.driver.name, row.shifts.length, row.completed, row.plannedMinutes, row.actualMinutes, row.diffMinutes, row.open]))
  const csv = rows.map((r) => r.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';')).join('\n')
  download(`rbshift-dochazka-${from}-${to}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8')
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
  const execCopy = () => {
    const el = document.createElement('textarea')
    el.value = text
    el.style.cssText = 'position:fixed;opacity:0;top:0;left:0;pointer-events:none'
    document.body.appendChild(el)
    el.focus()
    el.select()
    try { document.execCommand('copy') } finally { document.body.removeChild(el) }
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      execCopy()
    }
    alert('Text je zkopírovaný. Můžeš ho vložit třeba do WhatsAppu.')
  } catch {
    try { execCopy(); alert('Text je zkopírovaný. Můžeš ho vložit třeba do WhatsAppu.') }
    catch { alert('Kopírování se nepodařilo. Označ text ručně a zkopíruj ho přes Ctrl/Cmd+C.') }
  }
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
  const statusClass = (status) => statusToneMap[status] || 'warn'
  return { driver, vehicle, driverName, vehicleName, conflictMessages, statusClass }
}

function getLocalDemoParams(onlineMode) {
  if (onlineMode || typeof window === 'undefined') return { role: '', driver: '' }
  const params = new URLSearchParams(window.location.search)
  return {
    role: String(params.get('demoRole') || params.get('role') || '').trim().toLowerCase(),
    driver: String(params.get('demoDriver') || params.get('driverId') || '').trim(),
  }
}

function normalizeDemoText(value = '') {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function resolveDemoDriverId(value = '', drivers = []) {
  const query = normalizeDemoText(value)
  if (!query) return ''
  const match = drivers.find((driver) => {
    const fields = [driver.id, driver.name, driver.email].map((field) => normalizeDemoText(field))
    return fields.some((field) => field === query || field.includes(query))
  })
  return match?.id || ''
}

function App({ session = null, profile = null, signOut = null }) {
  const onlineMode = Boolean(isConfiguredSupabase && session?.user && profile)
  const [data, commit, syncState, reloadOnline] = useAppData(session, profile)
  const helpers = useMemo(() => buildHelpers(data), [data])
  const demoParams = getLocalDemoParams(onlineMode)
  const demoRole = ['admin', 'dispatcher', 'driver'].includes(demoParams.role) ? demoParams.role : ''
  const demoDriverId = resolveDemoDriverId(demoParams.driver, data.drivers)
  const [page, setPage] = useState(() => demoRole === 'driver' ? 'driver' : 'planner')
  const [role, setRole] = useState(() => profile?.role || demoRole || 'admin')
  const ownDriver = onlineMode ? data.drivers.find((d) => d.profileId === session.user.id || (d.email && d.email.toLowerCase() === session.user.email?.toLowerCase())) : null
  const [currentDriverId, setCurrentDriverId] = useState(demoDriverId || ownDriver?.id || data.drivers[0]?.id || '')
  useEffect(() => {
    if (profile?.role) {
      setRole(profile.role)
      return
    }
    if (!onlineMode && demoRole) setRole(demoRole)
  }, [profile?.role, onlineMode, demoRole])
  useEffect(() => { if (onlineMode && profile?.role === 'driver' && ownDriver?.id) setCurrentDriverId(ownDriver.id) }, [onlineMode, profile?.role, ownDriver?.id])
  useEffect(() => { if (!onlineMode && demoDriverId) setCurrentDriverId(demoDriverId) }, [onlineMode, demoDriverId])
  const isDriver = role === 'driver'
  const currentDriver = onlineMode && isDriver ? ownDriver : (data.drivers.find((d) => d.id === currentDriverId) || data.drivers[0])
  const [updateWorker, setUpdateWorker] = useState(null)
  const [updateApplying, setUpdateApplying] = useState(false)
  const updateReloadRequestedRef = useRef(false)
  const updateReloadTimerRef = useRef(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let mounted = true
    let reloading = false
    const showUpdate = (sw) => {
      if (!sw || !navigator.serviceWorker.controller || !mounted) return
      setUpdateWorker(sw)
      setUpdateApplying(false)
    }
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      if (reg.waiting) showUpdate(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed') showUpdate(installing)
        })
      })
    }).catch(() => null)
    const handleControllerChange = () => {
      if (!updateReloadRequestedRef.current || reloading) return
      reloading = true
      if (updateReloadTimerRef.current) window.clearTimeout(updateReloadTimerRef.current)
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)
    return () => {
      mounted = false
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
    }
  }, [])
  const applyPwaUpdate = () => {
    if (updateApplying) return
    updateReloadRequestedRef.current = true
    setUpdateApplying(true)
    updateWorker?.postMessage('SKIP_WAITING')
    updateReloadTimerRef.current = window.setTimeout(() => window.location.reload(), 1800)
  }
  const dismissPwaUpdate = () => {
    if (updateApplying) return
    setUpdateWorker(null)
  }
  useEffect(() => {
    if (isDriver && !['driver', 'notifications', 'availability', 'driverSettings'].includes(page)) setPage('driver')
    if (!isDriver && page === 'driver') setPage('planner')
    if (!isDriver && role !== 'admin' && adminPageKeys.has(page)) setPage('planner')
  }, [isDriver, page, role])

  const { unread: unreadNotifications } = notificationInboxState(data, { currentDriver, isDriver, profile })
  const unreadForCurrent = unreadNotifications.length
  const canOpenSettings = role === 'admin'
  const nav = isDriver
    ? [['driver', 'Domů', House], ['availability', 'Dostupnost', Clock], ['notifications', 'Notifikace', Bell], ['driverSettings', 'Nastavení', SettingsIcon]]
    : dispatcherNavItems
  const sidebarSections = [
    ['DISPEČINK', dispatcherNavItems],
    ...(role === 'admin' ? [['ADMIN', adminNavItems]] : [])
  ]
  const updateToast = updateWorker && <UpdateReadyToast applying={updateApplying} onRefresh={applyPwaUpdate} onDismiss={dismissPwaUpdate} />

  if (isDriver) return <div className="driver-shell-v2">
    <header className="driver-topbar-v2">
      <div className="driver-topbar-brand">{(currentDriver?.avatarUrl || currentDriver?.avatar_url) ? <img className="driver-avatar-img" src={currentDriver.avatarUrl || currentDriver.avatar_url} alt={currentDriver?.name || 'Řidič'} /> : <div className="logo compact-logo">{driverInitials(currentDriver?.name || 'Řidič')}</div>}<div><strong>{currentDriver?.name || 'Řidič'}</strong><small>Řidič</small></div></div>
      <span className={onlineMode ? 'pill good' : 'pill warn'}>{onlineMode ? 'Online ●' : 'Demo'}</span>
    </header>
    <main className={`driver-main-v2 ${page === 'driverSettings' ? 'driver-main-settings' : ''}`}>
      {page === 'driver' && <DriverHome data={data} helpers={helpers} commit={commit} currentDriver={currentDriver} syncState={syncState} ui={driverHomeUi} services={driverHomeServices} />}
      {page === 'notifications' && <NotificationsView data={data} helpers={helpers} commit={commit} currentDriver={currentDriver} isDriver={isDriver} profile={profile} session={session} ui={notificationUi} services={notificationServices} />}
      {page === 'availability' && <Availability data={data} commit={commit} currentDriver={currentDriver} />}
      {page === 'driverSettings' && <DriverSettings data={data} commit={commit} currentDriver={currentDriver} profile={profile} session={session} onlineMode={onlineMode} signOut={signOut} syncState={syncState} version={VERSION} ui={driverSettingsUi} notificationUi={notificationUi} notificationServices={notificationServices} />}
    </main>
    <nav className="driver-bottom-nav" aria-label="Řidičská navigace">
      {nav.map(([key, label, Icon]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => setPage(key)}><span className="driver-nav-icon"><Icon size={24} strokeWidth={2} />{key === 'notifications' && unreadForCurrent > 0 && <em>{unreadForCurrent}</em>}</span><b>{label}</b></button>)}
    </nav>
    {updateToast}
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
        {syncState?.error && <small className="danger-mini-text">{appFriendlyError(syncState.error)}</small>}
      </div>
    </aside>
    <main className="main">
      {page === 'planner' && <Planner data={data} helpers={helpers} commit={commit} />}
      {page === 'dashboard' && <Dashboard data={data} helpers={helpers} commit={commit} />}
      {page === 'settlements' && <Settlements data={data} helpers={helpers} commit={commit} />}
      {page === 'audit' && <OperationalAudit data={data} helpers={helpers} commit={commit} />}
      {page === 'notifications' && <NotificationsView data={data} helpers={helpers} commit={commit} currentDriver={currentDriver} isDriver={isDriver} profile={profile} session={session} ui={notificationUi} services={notificationServices} />}
      {page === 'shifts' && <ShiftsList data={data} helpers={helpers} commit={commit} />}
      {page === 'drivers' && <Drivers data={data} commit={commit} />}
      {page === 'vehicles' && <Vehicles data={data} commit={commit} />}
      {page === 'availability' && <Availability data={data} commit={commit} currentDriver={null} />}
      {page === 'shiftTemplates' && <ShiftTemplates data={data} commit={commit} />}
      {page === 'history' && <History data={data} />}
      {page === 'settings' && <SettingsView data={data} commit={commit} supabase={supabase} onlineMode={onlineMode} reloadOnline={reloadOnline} profile={profile} version={VERSION} ui={{ PageTitle, Field, Kpi }} />}
    </main>
    {updateToast}
  </div>
}

function UpdateReadyToast({ applying, onRefresh, onDismiss }) {
  return <div className="update-toast" role="status" aria-live="polite">
    <div className="update-toast-copy">
      <b>Je dostupná nová verze</b>
      <span>Obnovit aplikaci a načíst poslední změny.</span>
    </div>
    <div className="update-toast-actions">
      <button className="primary" onClick={onRefresh} disabled={applying}>{applying ? 'Obnovuji…' : 'Obnovit'}</button>
      <button className="ghost" onClick={onDismiss} disabled={applying}>Později</button>
    </div>
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
        <button className="topbar-icon-button" aria-label="Notifikace" aria-expanded={notificationsOpen} onClick={openNotifications}><Bell size={20} strokeWidth={2.2} aria-hidden="true" />{unreadCount > 0 && <span>{unreadCount}</span>}</button>
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
      <button className="topbar-icon-button" aria-label="Nastavení" onClick={() => canOpenSettings && setPage('settings')} disabled={!canOpenSettings}><SettingsIcon size={20} strokeWidth={2.2} aria-hidden="true" /></button>
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
function DeleteIconButton({ label = 'Odstranit', onClick, className = '' }) {
  return <button className={`danger-mini icon-only ${className}`.trim()} type="button" onClick={onClick} aria-label={label} title={label}><Trash2 size={16} strokeWidth={2.2} aria-hidden="true" /></button>
}
function Modal({ title, children, onClose, className = '', backdropClassName = '' }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previousHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
      document.documentElement.style.overflow = previousHtmlOverflow
    }
  }, [])
  return <div className={`modal-backdrop ${backdropClassName}`.trim()} role="dialog" aria-modal="true"><div className={`modal-card card ${className}`.trim()}><div className="section-title"><h3>{title}</h3><button className="ghost" onClick={onClose}>Zavřít</button></div>{children}</div></div>
}
function ActionSummary({ eyebrow, title, meta }) {
  return <div className="action-summary">
    {eyebrow && <span>{eyebrow}</span>}
    {title && <b>{title}</b>}
    {meta && <small>{meta}</small>}
  </div>
}
function ShiftActionSummary({ shift, helpers }) {
  if (!shift) return null
  return <ActionSummary
    eyebrow="Směna"
    title={`${formatDate(shift.date)} ${shift.start}–${shift.end}`}
    meta={`${helpers.driverName(shift.driverId)} · ${helpers.vehicleName(shift.vehicleId)}`}
  />
}
function ConfirmActionModal({ title, message, warning, children, confirmLabel = 'Potvrdit', confirmClass = 'primary', onConfirm, onClose }) {
  return <Modal title={title} onClose={onClose} className="action-modal">
    <div className="stack action-modal-body">
      {message && <p className="action-modal-copy">{message}</p>}
      {warning && <div className="alert warn">{warning}</div>}
      {children}
      <div className="row-actions action-modal-actions">
        <button className={confirmClass} type="button" onClick={onConfirm}>{confirmLabel}</button>
        <button className="ghost" type="button" onClick={onClose}>Zpět</button>
      </div>
    </div>
  </Modal>
}
function ReasonActionModal({ title, message, warning, children, label = 'Důvod', reason, placeholder = '', confirmLabel = 'Potvrdit', confirmClass = 'primary', onReasonChange, onConfirm, onClose }) {
  return <Modal title={title} onClose={onClose} className="action-modal">
    <form className="stack action-modal-body" onSubmit={(event) => { event.preventDefault(); onConfirm?.() }}>
      {message && <p className="action-modal-copy">{message}</p>}
      {warning && <div className="alert warn">{warning}</div>}
      {children}
      <Field label={label}>
        <textarea value={reason || ''} onChange={(event) => onReasonChange?.(event.target.value)} placeholder={placeholder} autoFocus />
      </Field>
      <div className="row-actions action-modal-actions">
        <button className={confirmClass} type="submit">{confirmLabel}</button>
        <button className="ghost" type="button" onClick={onClose}>Zpět</button>
      </div>
    </form>
  </Modal>
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
function SettlementStatusPill({ settlement }) {
  const status = settlement?.status || 'missing'
  if (status === 'missing') return <span className="pill warn">Bez výčetky</span>
  return <span className={`pill ${settlementToneMap[status] || 'warn'}`}>{settlementStatusMap[status] || status}</span>
}
function SettlementSummary({ settlement }) {
  if (!settlement) return <div className="settlement-summary muted">Výčetka zatím není založená.</div>
  const metrics = settlement.metrics || computeSettlementMetrics(settlement.inputs || {}, settlement.config || {})
  return <div className="settlement-summary">
    <div><span>K odevzdání</span><b>{money(metrics.settlement)}</b></div>
    <div><span>Výplata</span><b>{money(metrics.vyplata)}</b></div>
    <div><span>Km</span><b>{Math.round(metrics.kmReal || 0).toLocaleString('cs-CZ')}</b></div>
  </div>
}
function SettlementMobileSummary({ settlement }) {
  if (!settlement) return <span className="settlement-list-amount muted">Výčetka chybí</span>
  const metrics = settlement.metrics || computeSettlementMetrics(settlement.inputs || {}, settlement.config || {})
  return <span className="settlement-list-amount">
    <small>K odevzdání</small>
    <b>{money(metrics.settlement)}</b>
    <em>Hotovost {money(metrics.cashDiff)}</em>
  </span>
}
function SettlementFormModal({ data, helpers, commit, shift, currentDriver = null, isDriver = false, onClose }) {
  const existing = settlementForShift(data, shift?.id)
  const [inputs, setInputs] = useState(() => settlementDefaultInputs(shift, data, helpers, existing?.inputs))
  const [config] = useState(() => ({ ...settlementConfigDefaults, ...(existing?.config || {}) }))
  const [saving, setSaving] = useState(false)
  const [returnDialogOpen, setReturnDialogOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const readOnly = existing?.status === 'approved' || (isDriver && existing?.status === 'submitted')
  const metrics = useMemo(() => computeSettlementMetrics(inputs, config), [inputs, config])
  const errors = useMemo(() => validateSettlementInputs(inputs, config), [inputs, config])
  useEffect(() => setInputs(settlementDefaultInputs(shift, data, helpers, existing?.inputs)), [shift?.id, existing?.id])
  const setValue = (key, value) => setInputs((prev) => ({ ...prev, [key]: value }))
  const upsertSettlement = (status, returnedReason = '') => {
    if (!shift?.id) return
    if (['submitted','approved'].includes(status) && errors.length) return alert(errors[0])
    setSaving(true)
    const now = new Date().toISOString()
    const nextSettlement = {
      id: existing?.id || uid('set'),
      shiftId: shift.id,
      driverId: shift.driverId || currentDriver?.id || '',
      vehicleId: shift.vehicleId || '',
      status,
      inputs,
      metrics,
      config,
      note: inputs.note || '',
      submittedAt: status === 'submitted' ? (existing?.submittedAt || now) : (existing?.submittedAt || ''),
      approvedAt: status === 'approved' ? now : (status === 'returned' ? '' : (existing?.approvedAt || '')),
      approvedBy: status === 'approved' ? 'admin' : (status === 'returned' ? '' : (existing?.approvedBy || '')),
      returnedReason,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    const notices = []
    if (status === 'submitted') notices.push(adminNotice('Řidič odeslal výčetku', `${helpers.driverName(shift.driverId)} · ${shiftNoticeBody(shift, helpers)} · k odevzdání ${money(metrics.settlement)}`, 'settlement-submitted', shift.id))
    if (status === 'approved') notices.push(makeNotice({ title: 'Výčetka schválena', body: `${shiftNoticeBody(shift, helpers)} · k odevzdání ${money(metrics.settlement)}`, targetDriverId: shift.driverId, type: 'settlement-approved', shiftId: shift.id }))
    if (status === 'returned') notices.push(makeNotice({ title: 'Výčetka vrácena k opravě', body: `${shiftNoticeBody(shift, helpers)}${returnedReason ? ` · ${returnedReason}` : ''}`, targetDriverId: shift.driverId, type: 'settlement-returned', shiftId: shift.id }))
    commit((prev) => addNotificationsToData({
      ...prev,
      settlements: [nextSettlement, ...(prev.settlements || []).filter((s) => s.id !== nextSettlement.id && s.shiftId !== nextSettlement.shiftId)],
    }, notices), status === 'submitted' ? 'Řidič odeslal výčetku.' : status === 'approved' ? 'Výčetka schválena.' : status === 'returned' ? 'Výčetka vrácena k opravě.' : 'Výčetka uložena.', {
      onSuccess: () => setSaving(false),
      onError: () => setSaving(false),
    })
    if (status !== 'draft') onClose?.()
  }
  const returnSettlement = () => {
    setReturnReason(existing?.returnedReason || '')
    setReturnDialogOpen(true)
  }
  const fieldProps = { disabled: readOnly }
  return <>
  <Modal title={`Výčetka · ${formatDate(shift.date)} ${shift.start}–${shift.end}`} onClose={onClose} className="settlement-modal" backdropClassName="settlement-modal-backdrop">
    <div className="settlement-modal-head">
      <div><b>{helpers.driverName(shift.driverId)}</b><span>{helpers.vehicleName(shift.vehicleId)} · {shiftTypeName(shift)}</span></div>
      <SettlementStatusPill settlement={existing} />
    </div>
    {existing?.returnedReason && <div className="alert warn"><b>Vráceno k opravě:</b><br />{existing.returnedReason}</div>}
    {readOnly && isDriver && existing?.status === 'submitted' && <div className="alert good">Výčetka je odeslaná a čeká na schválení dispečerem.</div>}
    <div className="settlement-layout">
      <form className="form two-col settlement-form" onSubmit={(e) => e.preventDefault()}>
        <Field label="Řidič"><input value={inputs.driver} onChange={(e) => setValue('driver', e.target.value)} {...fieldProps} /></Field>
        <Field label="Směna"><select value={inputs.shift} onChange={(e) => setValue('shift', e.target.value)} disabled={readOnly}>{Object.entries({ den: 'Denní', noc: 'Noční', odpo: 'Odpolední', pul: '1/2 směna' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
        <Field label="RZ"><input value={inputs.rz} onChange={(e) => setValue('rz', e.target.value)} {...fieldProps} /></Field>
        <Field label="Počáteční km"><input inputMode="decimal" value={inputs.kmStart} onChange={(e) => setValue('kmStart', e.target.value)} {...fieldProps} /></Field>
        <Field label="Konečné km"><input inputMode="decimal" value={inputs.kmEnd} onChange={(e) => setValue('kmEnd', e.target.value)} {...fieldProps} /></Field>
        <Field label="Tržba"><input inputMode="decimal" value={inputs.trzba} onChange={(e) => setValue('trzba', e.target.value)} {...fieldProps} /></Field>
        <Field label="Přístavné"><input inputMode="decimal" value={inputs.pristavne} onChange={(e) => setValue('pristavne', e.target.value)} {...fieldProps} /></Field>
        <Field label="Palivo"><input inputMode="decimal" value={inputs.palivo} onChange={(e) => setValue('palivo', e.target.value)} {...fieldProps} /></Field>
        <Field label="Mytí"><input inputMode="decimal" value={inputs.myti} onChange={(e) => setValue('myti', e.target.value)} {...fieldProps} /></Field>
        <Field label="Kartou"><input inputMode="decimal" value={inputs.kartou} onChange={(e) => setValue('kartou', e.target.value)} {...fieldProps} /></Field>
        <Field label="Fakturou"><input inputMode="decimal" value={inputs.fakturou} onChange={(e) => setValue('fakturou', e.target.value)} {...fieldProps} /></Field>
        <Field label="Jiné náklady"><input inputMode="decimal" value={inputs.jine} onChange={(e) => setValue('jine', e.target.value)} {...fieldProps} /></Field>
        <Field label="Hotovost u sebe"><input inputMode="decimal" value={inputs.cashActual} onChange={(e) => setValue('cashActual', e.target.value)} {...fieldProps} /></Field>
        <Field label="IAC počet"><input inputMode="numeric" value={inputs.iacCount} onChange={(e) => setValue('iacCount', e.target.value)} {...fieldProps} /></Field>
        <Field label="SHKM počet"><input inputMode="numeric" value={inputs.shkmCount} onChange={(e) => setValue('shkmCount', e.target.value)} {...fieldProps} /></Field>
        <Field label="Poznámka" className="span2"><textarea value={inputs.note || ''} onChange={(e) => setValue('note', e.target.value)} {...fieldProps} /></Field>
      </form>
      <aside className="settlement-result">
        <div className="settlement-hero-result"><span>K odevzdání</span><b>{money(metrics.settlement)}</b><small>{metrics.payoutMode}</small></div>
        <div className="settlement-result-grid">
          <div><span>Výplata</span><b>{money(metrics.vyplata)}</b></div>
          <div><span>Doplatek</span><b style={metrics.doplatek > 0 ? { color: 'var(--bad)' } : undefined}>{money(metrics.doplatek)}{metrics.doplatek > 0 ? ' ⚠' : ''}</b></div>
          <div><span>Čistá tržba</span><b>{money(metrics.netto)}</b></div>
          <div><span>Najeto km</span><b>{Math.round(metrics.kmReal || 0).toLocaleString('cs-CZ')}</b></div>
          <div><span>Smluvní km</span><b>{Math.round(metrics.invoiceKm || 0).toLocaleString('cs-CZ')}</b></div>
          <div><span>Hotovost rozdíl</span><b style={metrics.hasCashActual ? { color: metrics.cashDiff > 0 ? 'var(--good)' : metrics.cashDiff < 0 ? 'var(--bad)' : undefined } : undefined}>{metrics.hasCashActual ? `${metrics.cashDiff > 0 ? '+' : ''}${money(metrics.cashDiff)}` : '—'}</b></div>
        </div>
        {errors.length > 0 && <div className="alert warn">{errors[0]}</div>}
        <div className="actions settlement-actions">
          {isDriver && existing?.status !== 'approved' && existing?.status !== 'submitted' && <>
            <button className="ghost" type="button" onClick={() => upsertSettlement('draft')} disabled={saving}>{saving ? 'Ukládám…' : 'Uložit rozpracované'}</button>
            <button className="primary" type="button" onClick={() => upsertSettlement('submitted')} disabled={saving}>{saving ? 'Odesílám…' : 'Odeslat výčetku'}</button>
          </>}
          {!isDriver && existing?.status !== 'approved' && <>
            <button className="ghost" type="button" onClick={() => upsertSettlement(existing?.status || 'draft')} disabled={saving}>{saving ? 'Ukládám…' : 'Uložit'}</button>
            <button className="primary" type="button" onClick={() => upsertSettlement('approved')} disabled={saving}>{saving ? 'Schvaluji…' : 'Schválit'}</button>
            {existing && <button className="danger" type="button" onClick={returnSettlement} disabled={saving}>Vrátit k opravě</button>}
          </>}
        </div>
      </aside>
    </div>
  </Modal>
  {returnDialogOpen && <ReasonActionModal
    title="Vrátit výčetku k opravě"
    message="Řidič dostane upozornění s důvodem, co má ve výčetce opravit."
    label="Důvod pro řidiče"
    reason={returnReason}
    placeholder="Např. doplň hotovost, oprav kilometry nebo přidej poznámku."
    confirmLabel="Vrátit k opravě"
    confirmClass="danger"
    onReasonChange={setReturnReason}
    onClose={() => setReturnDialogOpen(false)}
    onConfirm={() => {
      setReturnDialogOpen(false)
      upsertSettlement('returned', returnReason.trim() || 'Prosím oprav výčetku.')
    }}
  >
    <ShiftActionSummary shift={shift} helpers={helpers} />
  </ReasonActionModal>}
  </>
}

const driverHomeUi = { ConflictBox, Field, Kpi, Modal, SettlementFormModal, SettlementStatusPill, SettlementSummary, StatusPill }
const notificationUi = { Kpi, Modal, PageTitle }
const driverSettingsUi = { PageTitle }

const blankShift = (date = todayISO(), settings = {}) => { const firstTemplate = normalizeShiftTemplates(settings).find((tpl) => tpl.active); const preset = firstTemplate ? shiftTemplateValue(firstTemplate.id, settings) : null; const t = configuredShiftTimes(settings); return ({ date, start: preset?.start || t.dayStart, end: preset?.end || t.dayEnd, driverId: '', vehicleId: '', type: preset?.type || 'day', status: 'assigned', note: '', instruction: '', declineReason: '', actualStartAt: '', actualEndAt: '', swapRequestStatus: '' }) }
function ShiftForm({ data, helpers, commit, initialDate, editing, setEditing, onSaved, onCancel, onDirtyChange, variant = 'card' }) {
  const [form, setForm] = useState(blankShift(initialDate, data.settings))
  const [repeat, setRepeat] = useState('none')
  const [template, setTemplate] = useState('custom')
  const [override, setOverride] = useState(false)
  const [pastSaveDialogOpen, setPastSaveDialogOpen] = useState(false)
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
  const normalizeShiftForm = (item) => ({ ...item, status: !item.driverId ? 'open' : (item.status === 'open' ? 'assigned' : item.status) })
  const conflictMessages = helpers.conflictMessages({ id: editing?.id || 'new', ...normalizeShiftForm(form) })
  const buildRepeats = () => {
    if (editing || repeat === 'none') return [form]
    if (repeat === 'daily7') return Array.from({ length: 7 }, (_, i) => ({ ...form, date: addDays(form.date, i) }))
    if (repeat === 'workweek') return Array.from({ length: 5 }, (_, i) => ({ ...form, date: addDays(startOfWeek(form.date), i) }))
    if (repeat === 'weekend') return [5, 6].map((i) => ({ ...form, date: addDays(startOfWeek(form.date), i) }))
    return [form]
  }
  const saveShift = () => {
    const normalizedForm = normalizeShiftForm(form)
    const wasEditing = Boolean(editing)
    if (editing) {
      const notice = normalizedForm.status === 'open'
        ? makeNotice({ title: 'Volná směna upravena', body: shiftNoticeBody(normalizedForm, helpers), targetRole: 'driver_all', type: 'open-shift-change', shiftId: editing.id })
        : makeNotice({ title: 'Změna směny', body: shiftNoticeBody(normalizedForm, helpers), targetDriverId: normalizedForm.driverId, type: 'shift-change', shiftId: editing.id })
      commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === editing.id ? { ...s, ...normalizedForm } : s) }, notice), `Upravena směna ${normalizedForm.date} ${normalizedForm.start}–${normalizedForm.end}.`)
    } else {
      const items = buildRepeats().map((item) => ({ id: uid('sh'), ...normalizeShiftForm(item) }))
      const notices = items.map((item) => item.status === 'open'
        ? makeNotice({ title: 'Nová volná směna', body: shiftNoticeBody(item, helpers, 'můžeš se přihlásit'), targetRole: 'driver_all', type: 'open-shift', shiftId: item.id })
        : makeNotice({ title: 'Nová směna', body: shiftNoticeBody(item, helpers), targetDriverId: item.driverId, type: 'new-shift', shiftId: item.id }))
      commit((prev) => addNotificationsToData({ ...prev, shifts: [...items, ...prev.shifts] }, notices), `Vytvořeno směn: ${items.length}.`)
    }
    setForm(blankShift(form.date, data.settings)); setRepeat('none'); setTemplate('custom'); setOverride(false); setEditing(null)
    onSaved?.({ editing: wasEditing })
  }
  const submit = (e) => {
    e.preventDefault()
    if (!form.date || !form.start || !form.end) return alert('Vyplň datum a čas směny.')
    if (conflictMessages.length && !override) return alert('Směna má kolizi. Buď ji oprav, nebo zaškrtni uložení i s kolizí.')
    if (editing && isPastLocked(editing)) {
      setPastSaveDialogOpen(true)
      return
    }
    saveShift()
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
    {pastSaveDialogOpen && <ConfirmActionModal
      title="Upravit minulou směnu?"
      message="Tahle směna je v minulosti. Změna se uloží do historie a může ovlivnit docházku nebo výčetku."
      warning="Pokračuj jen pokud chceš zpětně upravit už proběhlou směnu."
      confirmLabel="Uložit změny"
      onClose={() => setPastSaveDialogOpen(false)}
      onConfirm={() => {
        setPastSaveDialogOpen(false)
        saveShift()
      }}
    >
      <ShiftActionSummary shift={editing} helpers={helpers} />
    </ConfirmActionModal>}
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
  const [closeDirtyDialogOpen, setCloseDirtyDialogOpen] = useState(false)
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
    if (shiftFormDirty) {
      setCloseDirtyDialogOpen(true)
      return
    }
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
      <div className="missing-coverage-mobile-list">
        {gaps.map((g) => <div className="missing-coverage-card" key={g.day + g.id}>
          <div>
            <b>{formatDate(g.day)} · {g.start}–{g.end}</b>
            <span>{g.name}</span>
          </div>
          <span className="pill bad">chybí {g.missing}</span>
          <small>Plánováno {g.planned} z {g.minDrivers}</small>
          <button className="ghost" type="button" onClick={() => { setPlannerView('calendar'); setShiftDrawerOpen(true); setShiftFormDirty(false); setEditing(null) }}>Vytvořit směnu</button>
        </div>)}
      </div>
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
    {closeDirtyDialogOpen && <ConfirmActionModal
      title="Zavřít bez uložení?"
      message="Formulář má neuložené změny. Po zavření se rozepsaná směna zahodí."
      confirmLabel="Zavřít bez uložení"
      confirmClass="danger"
      onClose={() => setCloseDirtyDialogOpen(false)}
      onConfirm={() => {
        setCloseDirtyDialogOpen(false)
        closeShiftDrawer()
      }}
    />}
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
  const [settlementOpen, setSettlementOpen] = useState(false)
  const [actionDialog, setActionDialog] = useState(null)
  const fresh = data.shifts.find((s) => s.id === shift.id) || shift
  const conflicts = helpers.conflictMessages(fresh)
  const swaps = (data.swapRequests || []).filter((r) => r.shiftId === fresh.id)
  const settlement = settlementForShift(data, fresh.id)
  const duration = actualDurationMinutes(fresh)
  const closeActionDialog = () => setActionDialog(null)
  const commitStatus = (status, reason = fresh.declineReason || '') => {
    commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === fresh.id ? { ...s, status, declineReason: reason } : s) }, statusNoticeForShift({ ...fresh, status, declineReason: reason }, status, helpers, reason)), `Detail směny: stav změněn na ${statusMap[status]}.`)
  }
  const requestStatus = (status, reason = fresh.declineReason || '') => {
    if (status === 'declined') {
      setActionDialog({ type: 'decline', status, reason })
      return
    }
    if (isPastLocked(fresh)) {
      setActionDialog({ type: 'status', status, reason })
      return
    }
    commitStatus(status, reason)
  }
  const confirmStatusAction = () => {
    if (!actionDialog?.status) return
    commitStatus(actionDialog.status, actionDialog.reason || '')
    closeActionDialog()
  }
  const requestEdit = () => {
    if (isPastLocked(fresh)) {
      setActionDialog({ type: 'editPast' })
      return
    }
    setEditing(fresh)
  }
  const confirmEdit = () => {
    closeActionDialog()
    setEditing(fresh)
  }
  const checkIn = () => commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === fresh.id ? { ...s, actualStartAt: s.actualStartAt || localStamp(), status: s.status === 'assigned' ? 'confirmed' : s.status } : s) }, adminNotice('Řidič nastoupil na směnu', `${helpers.driverName(fresh.driverId)} · ${shiftNoticeBody(fresh, helpers)}`, 'attendance-start', fresh.id)), 'V detailu směny zaznamenán nástup.')
  const checkOut = () => commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === fresh.id ? { ...s, actualEndAt: s.actualEndAt || localStamp(), status: 'completed' } : s) }, adminNotice('Řidič ukončil směnu', `${helpers.driverName(fresh.driverId)} · ${shiftNoticeBody(fresh, helpers)}`, 'attendance-end', fresh.id)), 'V detailu směny zaznamenáno ukončení.')
  const requestHardDelete = () => setActionDialog({ type: 'hardDelete' })
  const confirmHardDelete = () => {
    commit((prev) => hardDeleteShiftData(prev, fresh), '')
    closeActionDialog()
    setSelected(null)
  }
  const resolveSwap = (id, status) => {
    const req = swaps.find((r) => r.id === id)
    if (!req) return
    if (status === 'approved') {
      const newDriverId = req.acceptedByDriverId || req.targetDriverId
      if (!newDriverId) return alert('U nabídky všem musí nejdřív některý kolega kliknout „Chci převzít směnu“.')
      const notices = req.targetMode === 'open'
        ? [makeNotice({ title: 'Volná směna schválena a potvrzena', body: shiftNoticeBody(fresh, helpers, 'směna je rovnou potvrzená'), targetDriverId: newDriverId, type: 'open-shift-approved', shiftId: fresh.id })]
        : [
          makeNotice({ title: 'Výměna směny schválena', body: `${shiftNoticeBody(fresh, helpers)} · převedeno na ${helpers.driverName(newDriverId)}`, targetDriverId: req.driverId, type: 'swap-approved', shiftId: fresh.id }),
          makeNotice({ title: 'Převzal jsi směnu – potvrzeno', body: shiftNoticeBody(fresh, helpers, 'směna je rovnou potvrzená'), targetDriverId: newDriverId, type: 'swap-approved', shiftId: fresh.id }),
        ]
      return commit((prev) => addNotificationsToData({ ...prev, swapRequests: (prev.swapRequests || []).map((r) => r.id === id ? appendSwapHistory({ ...r, status, resolvedAt: new Date().toISOString(), approvedDriverId: newDriverId }, `Admin schválil převzetí pro ${helpers.driverName(newDriverId)}. Směna byla automaticky potvrzena.`) : r), shifts: prev.shifts.map((s) => s.id === fresh.id ? { ...s, driverId: newDriverId, status: 'confirmed', declineReason: '', swapRequestStatus: 'approved' } : s) }, notices), `${req.targetMode === 'open' ? 'Volná směna byla přidělena a potvrzena' : 'Výměna schválena, směna převedena a potvrzena pro'} ${helpers.driverName(newDriverId)}.`)
    }
    const notices = [makeNotice({ title: 'Výměna směny zamítnuta', body: shiftNoticeBody(fresh, helpers), targetDriverId: req.driverId, type: 'swap-rejected', shiftId: fresh.id })]
    if (req.acceptedByDriverId) notices.push(makeNotice({ title: 'Výměna nebyla schválena', body: shiftNoticeBody(fresh, helpers), targetDriverId: req.acceptedByDriverId, type: 'swap-rejected', shiftId: fresh.id }))
    commit((prev) => addNotificationsToData({ ...prev, swapRequests: (prev.swapRequests || []).map((r) => r.id === id ? appendSwapHistory({ ...r, status, resolvedAt: new Date().toISOString(), rejectedReason: status === 'rejected' ? 'Zamítnuto adminem' : '' }, status === 'rejected' ? 'Admin zamítl výměnu.' : `Stav výměny změněn na ${swapStatusMap[status]}.`) : r), shifts: prev.shifts.map((s) => s.id === fresh.id ? { ...s, swapRequestStatus: status } : s) }, notices), `Žádost o výměnu směny: ${swapStatusMap[status]}.`)
  }
  return <>
  <div className="card detail-panel">
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
    {(canOpenSettlement(fresh) || settlement) && <div className="card-soft settlement-inline-card">
      <div className="split"><div><b>Výčetka</b><br /><small className="muted">Navázaná na ukončenou směnu</small></div><SettlementStatusPill settlement={settlement} /></div>
      <SettlementSummary settlement={settlement} />
      <div className="row-actions" style={{ marginTop: 10 }}><button onClick={() => setSettlementOpen(true)}>{settlement ? 'Otevřít výčetku' : 'Založit výčetku'}</button></div>
    </div>}
    {fresh.declineReason && <div className="alert bad"><b>Důvod odmítnutí:</b><br />{fresh.declineReason}</div>}
    {swaps.length > 0 && <div className="card-soft"><h4>Žádosti / zájemci</h4><div className="stack">{swaps.map((r) => <div className="alert warn" key={r.id}><b>{r.targetMode === 'open' ? 'Zájem o volnou směnu' : swapStatusMap[r.status]}</b> · {new Date(r.createdAt).toLocaleString('cs-CZ')}<br />Od: {helpers.driverName(r.driverId)} · Komu: {r.targetMode === 'open' ? 'volná směna' : (r.targetMode === 'driver' ? helpers.driverName(r.targetDriverId) : 'všem kolegům')}{r.acceptedByDriverId && <><br />Přijal: <b>{helpers.driverName(r.acceptedByDriverId)}</b></>}{r.approvedDriverId && <><br />Schválený řidič: <b>{helpers.driverName(r.approvedDriverId)}</b></>}{r.rejectedReason && <><br />Důvod zamítnutí: {r.rejectedReason}</>}<br />{r.reason || 'Bez důvodu'}{r.history?.length ? <div className="swap-history">{r.history.map((h, i) => <small key={i}>{new Date(h.at).toLocaleString('cs-CZ')} · {h.text}</small>)}</div> : null}{['pending','accepted'].includes(r.status) && <div className="row-actions" style={{ marginTop: 8 }}><button onClick={() => resolveSwap(r.id, 'approved')}>Schválit a potvrdit</button><button onClick={() => resolveSwap(r.id, 'rejected')}>Zamítnout</button></div>}</div>)}</div></div>}
    <div style={{ marginTop: 12 }}><ConflictBox messages={conflicts} /></div>
    <div className="actions" style={{ marginTop: 14, justifyContent: 'flex-start' }}>
      <button className="primary" onClick={() => requestStatus('confirmed')}>Potvrdit</button>
      <button className="ghost" onClick={checkIn}>Nástup</button>
      <button className="ghost" onClick={checkOut}>Ukončit</button>
      <button className="ghost" onClick={() => setSettlementOpen(true)} disabled={!canOpenSettlement(fresh) && !settlement}>Výčetka</button>
      <button className="ghost" onClick={() => requestStatus('completed')}>Dokončeno</button>
      <button className="danger" onClick={() => requestStatus('declined')}>Odmítnout</button>
      <button className="ghost" onClick={requestEdit}>Upravit</button>
      <button className="ghost" onClick={() => copyText(driverText(data, helpers, fresh.driverId))}>WhatsApp řidič</button>
      <DeleteIconButton className="detail-delete-button" label="Trvale odstranit směnu" onClick={requestHardDelete} />
    </div>
  </div>
  {settlementOpen && <SettlementFormModal data={data} helpers={helpers} commit={commit} shift={fresh} isDriver={false} onClose={() => setSettlementOpen(false)} />}
  {actionDialog?.type === 'decline' && <ReasonActionModal
    title="Odmítnout směnu"
    message="Směna se označí jako odmítnutá a důvod zůstane viditelný v detailu."
    warning={isPastLocked(fresh) ? 'Tahle směna je v minulosti. Změna ovlivní historii směny.' : ''}
    label="Důvod odmítnutí"
    reason={actionDialog.reason}
    placeholder="Např. kolize, nemoc nebo provozní důvod."
    confirmLabel="Odmítnout směnu"
    confirmClass="danger"
    onReasonChange={(reason) => setActionDialog((current) => current ? { ...current, reason } : current)}
    onClose={closeActionDialog}
    onConfirm={confirmStatusAction}
  >
    <ShiftActionSummary shift={fresh} helpers={helpers} />
  </ReasonActionModal>}
  {actionDialog?.type === 'status' && <ConfirmActionModal
    title="Změnit minulou směnu?"
    message={`Stav směny se změní na „${statusMap[actionDialog.status] || actionDialog.status}”.`}
    warning="Tahle směna je v minulosti. Změna může ovlivnit historii, docházku nebo výčetku."
    confirmLabel="Změnit stav"
    onClose={closeActionDialog}
    onConfirm={confirmStatusAction}
  >
    <ShiftActionSummary shift={fresh} helpers={helpers} />
  </ConfirmActionModal>}
  {actionDialog?.type === 'editPast' && <ConfirmActionModal
    title="Upravit minulou směnu?"
    message="Otevře se formulář pro úpravu už proběhlé směny."
    warning="Pokračuj jen pokud chceš zpětně upravit historii směny."
    confirmLabel="Otevřít úpravu"
    onClose={closeActionDialog}
    onConfirm={confirmEdit}
  >
    <ShiftActionSummary shift={fresh} helpers={helpers} />
  </ConfirmActionModal>}
  {actionDialog?.type === 'hardDelete' && <ConfirmActionModal
    title="Trvale odstranit směnu"
    message="Tahle akce odstraní směnu z databáze, řidičské aplikace, související žádosti o výměnu, notifikace a navázané záznamy historie."
    warning="Řidiči se neposílá žádná další notifikace a akce nejde jednoduše vrátit."
    confirmLabel="Trvale odstranit"
    confirmClass="danger"
    onClose={closeActionDialog}
    onConfirm={confirmHardDelete}
  >
    <ShiftActionSummary shift={fresh} helpers={helpers} />
  </ConfirmActionModal>}
  </>
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

function Settlements({ data, helpers, commit }) {
  const [selectedShiftId, setSelectedShiftId] = useState('')
  const rows = sortByDateTime((data.shifts || []).filter((s) => canOpenSettlement(s) || settlementForShift(data, s.id))).map((shift) => {
    const settlement = settlementForShift(data, shift.id)
    return { shift, settlement }
  })
  const waiting = rows.filter((row) => row.settlement?.status === 'submitted').length
  const missing = rows.filter((row) => !row.settlement).length
  const approved = rows.filter((row) => row.settlement?.status === 'approved').length
  const selectedShift = (data.shifts || []).find((s) => s.id === selectedShiftId)
  return <>
    <PageTitle title="Výčetky směn" subtitle="Kontrola tržeb a výčetek po ukončených směnách.">
      <span className="pill waiting">{waiting} čeká</span>
      <span className="pill warn">{missing} chybí</span>
      <span className="pill good">{approved} schváleno</span>
    </PageTitle>
    <div className="card">
      <div className="section-title"><h3>Přehled výčetek</h3><span className="pill">{rows.length}</span></div>
      <div className="table-wrap settlement-table">
        <table className="table">
          <thead><tr><th>Směna</th><th>Řidič</th><th>Auto</th><th>Stav</th><th>Souhrn</th><th></th></tr></thead>
          <tbody>
            {rows.map(({ shift, settlement }) => <tr key={shift.id}>
              <td><b>{formatDate(shift.date)} {shift.start}–{shift.end}</b><br /><small>{shiftTypeName(shift)}</small></td>
              <td>{helpers.driverName(shift.driverId)}</td>
              <td>{helpers.vehicleName(shift.vehicleId)}</td>
              <td><SettlementStatusPill settlement={settlement} /></td>
              <td><SettlementSummary settlement={settlement} /></td>
              <td><button className="ghost" type="button" onClick={() => setSelectedShiftId(shift.id)}>{settlement ? 'Otevřít' : 'Založit'}</button></td>
            </tr>)}
            {!rows.length && <tr><td colSpan="6"><div className="empty">Zatím nejsou ukončené směny pro výčetku.</div></td></tr>}
          </tbody>
        </table>
      </div>
      <div className="settlement-mobile-list">
        {rows.map(({ shift, settlement }) => <button className="settlement-list-row" type="button" key={shift.id} onClick={() => setSelectedShiftId(shift.id)}>
          <span className="settlement-list-main">
            <b>{formatDate(shift.date)} {shift.start}–{shift.end}</b>
            <small>{helpers.driverName(shift.driverId)} · {helpers.vehicleName(shift.vehicleId)}</small>
          </span>
          <span className="settlement-list-meta">
            <SettlementStatusPill settlement={settlement} />
            <SettlementMobileSummary settlement={settlement} />
          </span>
        </button>)}
        {!rows.length && <div className="empty">Zatím nejsou ukončené směny pro výčetku.</div>}
      </div>
    </div>
    {selectedShift && <SettlementFormModal data={data} helpers={helpers} commit={commit} shift={selectedShift} isDriver={false} onClose={() => setSelectedShiftId('')} />}
  </>
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
          <div className="table-wrap compact-table audit-table-scroll audit-card-table audit-coverage-table"><table className="table"><thead><tr><th>Den</th><th>Pásmo</th><th>Čas</th><th>Plán</th><th>Min.</th><th>Stav</th></tr></thead><tbody>{coverageRows.map((row) => <tr key={`${row.day}-${row.slot.id}`}><td><b>{formatDate(row.day)}</b></td><td>{row.slot.name}</td><td>{row.slot.start}–{row.slot.end}</td><td>{row.planned}</td><td>{row.slot.minDrivers}</td><td>{row.missing ? <span className="pill bad">chybí {row.missing}</span> : <span className="pill good">OK</span>}</td></tr>)}</tbody></table></div>
          <div className="section-title"><h3>Docházkový report</h3><span className="pill">{hoursLabel(actualTotal)}</span></div>
          <div className="table-wrap compact-table audit-table-scroll audit-card-table audit-attendance-table"><table className="table"><thead><tr><th>Řidič</th><th>Směn</th><th>Hotovo</th><th>Plán</th><th>Reál</th><th>Rozdíl</th><th>Kontrola</th></tr></thead><tbody>{attendance.map((row) => <tr key={row.driver.id}><td><b>{row.driver.name}</b><br /><small>{row.driver.phone || row.driver.email || 'bez kontaktu'}</small></td><td>{row.shifts.length}</td><td>{row.completed}</td><td>{hoursLabel(row.plannedMinutes)}</td><td>{hoursLabel(row.actualMinutes)}</td><td>{hoursLabel(row.diffMinutes)}</td><td>{row.open ? <span className="pill warn">{row.open} běží</span> : <span className="pill good">OK</span>}</td></tr>)}</tbody></table></div>
        </div>
      </details>
      <details className="card collapse-card" {...sectionProps('month')}>
        <summary><span><b>Tento měsíc</b><small>{monthLogs.length} záznamů historie · dlouhodobé normy</small></span><span className="pill">{monthLogs.length}</span></summary>
        <div className="collapse-content stack">
          <div className="section-title"><h3>Normy pokrytí</h3><span className="pill">{data.settings?.coverageSlots?.length || 0}</span></div>
          <div className="table-wrap compact-table audit-table-scroll audit-card-table audit-standards-table"><table className="table"><thead><tr><th>Pásmo</th><th>Čas</th><th>Min. řidičů</th></tr></thead><tbody>{(data.settings?.coverageSlots || []).map((slot) => <tr key={slot.id}><td><b>{slot.name}</b></td><td>{slot.start}–{slot.end}</td><td><input type="number" min="0" value={slot.minDrivers} onChange={(e) => updateMinDrivers(slot.id, e.target.value)} style={{ width: 90 }} /></td></tr>)}</tbody></table></div>
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
function StaffShiftMobileCard({ shift: s, helpers, compact, onStatus, onDuplicate, onCancel, onHardDelete }) {
  const conflicts = helpers.conflictMessages(s)
  const attendance = `${s.actualStartAt ? new Date(s.actualStartAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—'} → ${s.actualEndAt ? new Date(s.actualEndAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—'}`
  return <div className={`staff-shift-card status-${s.status}`}>
    <div className="staff-shift-card-head">
      <div>
        <b>{formatDate(s.date)}</b>
        <span>{time(s.start)}–{time(s.end)} · {shiftTypeMap[s.type] || s.type}</span>
      </div>
      <StatusPill status={s.status} helpers={helpers} />
    </div>
    <div className="staff-shift-card-grid">
      <span><small>Řidič</small><b>{helpers.driverName(s.driverId)}</b></span>
      <span><small>Vozidlo</small><b>{helpers.vehicleName(s.vehicleId)}</b></span>
      <span><small>Docházka</small><b>{attendance}</b><em>{durationLabel(actualDurationMinutes(s))}</em></span>
      <span><small>Kontrola</small>{conflicts.length ? <b className="bad-text">{conflicts.length} kolize</b> : <b className="good-text">OK</b>}</span>
    </div>
    {(s.note || s.instruction || s.declineReason || ['pending','accepted'].includes(s.swapRequestStatus)) && <div className="staff-shift-card-notes">
      {['pending','accepted'].includes(s.swapRequestStatus) && <span className="pill warn">výměna</span>}
      {s.note && <small>{s.note}</small>}
      {s.instruction && <small>Instrukce: {s.instruction}</small>}
      {s.declineReason && <small>Důvod: {s.declineReason}</small>}
    </div>}
    {!compact && <div className="row-actions staff-shift-card-actions">
      <button type="button" onClick={() => onStatus(s, 'confirmed')}>Potvrdit</button>
      <button type="button" onClick={() => onStatus(s, 'declined')}>Odmítnout</button>
      <button className="staff-shift-complete" type="button" onClick={() => onStatus(s, 'completed')}>Hotovo</button>
    </div>}
    {!compact && <details className="staff-shift-more-actions">
      <summary>Další akce</summary>
      <div className="staff-shift-more-actions-panel">
        <button type="button" onClick={() => onDuplicate(s)}>Duplikovat</button>
        <button className="danger-mini" type="button" onClick={() => onCancel(s)}>Zrušit</button>
        <DeleteIconButton label="Trvale odstranit směnu" onClick={() => onHardDelete(s)} />
      </div>
    </details>}
  </div>
}
function ShiftTable({ shifts, data, helpers, commit, compact = false }) {
  const [actionDialog, setActionDialog] = useState(null)
  const actionShift = actionDialog?.shift?.id ? (data.shifts.find((s) => s.id === actionDialog.shift.id) || actionDialog.shift) : null
  const closeActionDialog = () => setActionDialog(null)
  const commitStatus = (shift, status, reason = '') => commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === shift.id ? { ...s, status, declineReason: reason } : s) }, statusNoticeForShift({ ...shift, status, declineReason: reason }, status, helpers, reason)), `Změněn stav směny na ${statusMap[status]}.`)
  const requestStatus = (shift, status, reason = '') => {
    if (status === 'declined') {
      setActionDialog({ type: 'decline', shift, status, reason: shift.declineReason || reason || '' })
      return
    }
    if (isPastLocked(shift)) {
      setActionDialog({ type: 'status', shift, status, reason })
      return
    }
    commitStatus(shift, status, reason)
  }
  const confirmStatusAction = () => {
    if (!actionShift || !actionDialog?.status) return
    commitStatus(actionShift, actionDialog.status, actionDialog.reason || '')
    closeActionDialog()
  }
  const duplicate = (shift) => commit((prev) => ({ ...prev, shifts: [{ ...shift, id: uid('sh'), date: addDays(shift.date, 1), status: 'draft', declineReason: '', actualStartAt: '', actualEndAt: '', swapRequestStatus: '' }, ...prev.shifts] }), 'Duplikována směna na další den.')
  const requestCancel = (shift) => setActionDialog({ type: 'cancel', shift, reason: 'Zrušeno dispečerem' })
  const confirmCancel = () => {
    if (!actionShift) return
    const reason = actionDialog?.reason?.trim() || 'Zrušeno dispečerem'
    commit((prev) => cancelShiftData(prev, actionShift, helpers, reason), `Zrušena směna ${formatDate(actionShift.date)} ${actionShift.start}–${actionShift.end}.`)
    closeActionDialog()
  }
  const requestHardDelete = (shift) => setActionDialog({ type: 'hardDelete', shift })
  const confirmHardDelete = () => {
    if (!actionShift) return
    commit((prev) => hardDeleteShiftData(prev, actionShift), '')
    closeActionDialog()
  }
  if (!shifts.length) return <div className="empty">Žádné směny k zobrazení.</div>
  return <>
  <div className="table-wrap shift-table-desktop"><table className="table"><thead><tr><th>Datum</th><th>Čas</th><th>Řidič</th><th>Vozidlo</th><th>Stav</th><th>Docházka</th><th>Kontrola</th>{!compact && <th>Akce</th>}</tr></thead><tbody>{shifts.map((s) => {
    const conflicts = helpers.conflictMessages(s)
    return <tr key={s.id}><td><b>{formatDate(s.date)}</b><br /><small>{s.date}</small></td><td>{time(s.start)}–{time(s.end)}<br /><small>{shiftTypeMap[s.type] || s.type}</small></td><td>{helpers.driverName(s.driverId)}<br /><small>{s.note || 'Bez poznámky'}</small>{s.instruction && <><br /><small>Instrukce: {s.instruction}</small></>}{s.declineReason && <><br /><small>Důvod: {s.declineReason}</small></>}</td><td>{helpers.vehicleName(s.vehicleId)}</td><td><StatusPill status={s.status} helpers={helpers} />{['pending','accepted'].includes(s.swapRequestStatus) && <><br /><span className="pill warn">výměna</span></>}</td><td>{s.actualStartAt ? new Date(s.actualStartAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—'} → {s.actualEndAt ? new Date(s.actualEndAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—'}<br /><small>{durationLabel(actualDurationMinutes(s))}</small></td><td>{conflicts.length ? <span className="pill bad">{conflicts.length} kolize</span> : <span className="pill good">OK</span>}</td>{!compact && <td><div className="row-actions"><button onClick={() => requestStatus(s, 'confirmed')}>Potvrdit</button><button onClick={() => requestStatus(s, 'declined')}>Odmítnout</button><button onClick={() => requestStatus(s, 'completed')}>Hotovo</button><button onClick={() => duplicate(s)}>Duplikovat</button><button className="danger-mini" onClick={() => requestCancel(s)}>Zrušit</button><DeleteIconButton label="Trvale odstranit směnu" onClick={() => requestHardDelete(s)} /></div></td>}</tr>
  })}</tbody></table></div>
  <div className="staff-shift-mobile-list">
    {shifts.map((s) => <StaffShiftMobileCard key={s.id} shift={s} helpers={helpers} compact={compact} onStatus={requestStatus} onDuplicate={duplicate} onCancel={requestCancel} onHardDelete={requestHardDelete} />)}
  </div>
  {actionDialog?.type === 'decline' && actionShift && <ReasonActionModal
    title="Odmítnout směnu"
    message="Směna se označí jako odmítnutá a důvod zůstane viditelný v detailu."
    warning={isPastLocked(actionShift) ? 'Tahle směna je v minulosti. Změna ovlivní historii směny.' : ''}
    label="Důvod odmítnutí"
    reason={actionDialog.reason}
    placeholder="Např. kolize, nemoc nebo provozní důvod."
    confirmLabel="Odmítnout směnu"
    confirmClass="danger"
    onReasonChange={(reason) => setActionDialog((current) => current ? { ...current, reason } : current)}
    onClose={closeActionDialog}
    onConfirm={confirmStatusAction}
  >
    <ShiftActionSummary shift={actionShift} helpers={helpers} />
  </ReasonActionModal>}
  {actionDialog?.type === 'status' && actionShift && <ConfirmActionModal
    title="Změnit minulou směnu?"
    message={`Stav směny se změní na „${statusMap[actionDialog.status] || actionDialog.status}”.`}
    warning="Tahle směna je v minulosti. Změna může ovlivnit historii, docházku nebo výčetku."
    confirmLabel="Změnit stav"
    onClose={closeActionDialog}
    onConfirm={confirmStatusAction}
  >
    <ShiftActionSummary shift={actionShift} helpers={helpers} />
  </ConfirmActionModal>}
  {actionDialog?.type === 'cancel' && actionShift && <ReasonActionModal
    title="Zrušit směnu"
    message="Směna se označí jako zrušená a řidič dostane notifikaci s důvodem."
    warning={isPastLocked(actionShift) ? 'Tahle směna je v minulosti. Zrušení ovlivní historii směny.' : ''}
    label="Důvod zrušení pro řidiče"
    reason={actionDialog.reason}
    placeholder="Např. nemoc, provozní změna nebo zrušeno dispečerem."
    confirmLabel="Zrušit směnu"
    confirmClass="danger"
    onReasonChange={(reason) => setActionDialog((current) => current ? { ...current, reason } : current)}
    onClose={closeActionDialog}
    onConfirm={confirmCancel}
  >
    <ShiftActionSummary shift={actionShift} helpers={helpers} />
  </ReasonActionModal>}
  {actionDialog?.type === 'hardDelete' && actionShift && <ConfirmActionModal
    title="Trvale odstranit směnu"
    message="Tahle akce odstraní směnu z databáze, řidičské aplikace, související žádosti o výměnu, notifikace a navázané záznamy historie."
    warning="Řidiči se neposílá žádná další notifikace a akce nejde jednoduše vrátit."
    confirmLabel="Trvale odstranit"
    confirmClass="danger"
    onClose={closeActionDialog}
    onConfirm={confirmHardDelete}
  >
    <ShiftActionSummary shift={actionShift} helpers={helpers} />
  </ConfirmActionModal>}
  </>
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
  const [driverToDelete, setDriverToDelete] = useState('')
  const editingDriver = editing ? data.drivers.find((d) => d.id === editing) : null
  const deleteDriver = driverToDelete ? data.drivers.find((d) => d.id === driverToDelete) : null
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
    if (!driver) return
    setDriverToDelete(driver.id)
  }
  const confirmSoftDelete = () => {
    if (!deleteDriver) return
    commit((prev) => ({ ...prev, drivers: prev.drivers.map((d) => d.id === deleteDriver.id ? { ...d, active: false } : d) }), 'Řidič deaktivován.')
    const wasEditing = editing === deleteDriver.id
    setDriverToDelete('')
    if (wasEditing) closeDrawer()
  }
  const restore = (driver) => commit((prev) => ({ ...prev, drivers: prev.drivers.map((d) => d.id === driver.id ? { ...d, active: true } : d) }), 'Řidič znovu aktivován.')
  return <>
    <PageTitle title="Řidiči"><button className="primary" onClick={openCreate}>+ Přidat řidiče</button></PageTitle>
    <div className="card">
      <div className="section-title"><h3>Seznam řidičů</h3><span className="pill">{activeCount} aktivní / {data.drivers.length} celkem</span></div>
      <div className="stack compact-list">{data.drivers.map((d) => <div className="log list-row" key={d.id}>
        <div className="list-row-main" role="button" tabIndex={0} onClick={() => openEdit(d)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(d) } }}>
          <div className="split"><div><b>{d.name || 'Bez jména'}</b><br /><small className="muted">{d.phone || 'Bez telefonu'} · {d.email || 'Bez e-mailu'}{d.profileId ? ' · profil: ' + d.profileId.slice(0, 8) + '…' : ''}</small></div><span className={d.active ? 'pill good' : 'pill bad'}>{d.active ? 'Aktivní' : 'Neaktivní'}</span></div>
          {d.note && <p className="muted compact-note">{d.note}</p>}
        </div>
        <div className="row-actions list-row-actions">
          <button onClick={() => openEdit(d)}>Upravit</button>
          {d.active === false ? <button onClick={() => restore(d)}>Obnovit</button> : <DeleteIconButton label="Deaktivovat řidiče" onClick={() => softDelete(d)} />}
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
          <button className="danger" type="button" onClick={() => softDelete()} disabled={editingDriver?.active === false}>Deaktivovat řidiče</button>
        </div>}
      </form>
    </SideDrawer>
    {deleteDriver && <ConfirmActionModal
      title="Deaktivovat řidiče"
      message="Řidič se skryje jako neaktivní, ale jeho historické směny a záznamy zůstanou zachované."
      confirmLabel="Deaktivovat řidiče"
      confirmClass="danger"
      onClose={() => setDriverToDelete('')}
      onConfirm={confirmSoftDelete}
    >
      <ActionSummary eyebrow="Řidič" title={deleteDriver.name || 'Bez jména'} meta={deleteDriver.email || deleteDriver.phone || 'Bez kontaktu'} />
    </ConfirmActionModal>}
  </>
}

function Vehicles({ data, commit }) {
  const empty = { name: '', plate: '', year: '', active: true, note: '' }
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [vehicleToDelete, setVehicleToDelete] = useState('')
  const [serviceBlockToDelete, setServiceBlockToDelete] = useState('')
  const [block, setBlock] = useState({ vehicleId: '', from: todayISO(), to: todayISO(), reason: '' })
  const editingVehicle = editing ? data.vehicles.find((v) => v.id === editing) : null
  const deleteVehicle = vehicleToDelete ? data.vehicles.find((v) => v.id === vehicleToDelete) : null
  const deleteServiceBlock = serviceBlockToDelete ? data.serviceBlocks.find((item) => item.id === serviceBlockToDelete) : null
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
  const removeBlock = (id) => setServiceBlockToDelete(id)
  const confirmRemoveBlock = () => {
    if (!deleteServiceBlock) return
    commit((prev) => ({ ...prev, serviceBlocks: prev.serviceBlocks.filter((b) => b.id !== deleteServiceBlock.id) }), 'Servisní blokace odstraněna.')
    setServiceBlockToDelete('')
  }
  const softDelete = (vehicle = editingVehicle) => {
    if (!vehicle) return
    setVehicleToDelete(vehicle.id)
  }
  const confirmSoftDelete = () => {
    if (!deleteVehicle) return
    commit((prev) => ({ ...prev, vehicles: prev.vehicles.map((v) => v.id === deleteVehicle.id ? { ...v, active: false } : v) }), 'Vozidlo deaktivováno.')
    const wasEditing = editing === deleteVehicle.id
    setVehicleToDelete('')
    if (wasEditing) closeDrawer()
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
          return <div className="log list-row" key={v.id}>
            <div className="list-row-main" role="button" tabIndex={0} onClick={() => openEdit(v)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(v) } }}>
              <div className="split"><div><b>{v.name || 'Bez modelu'}</b><br /><small className="muted">{v.plate || 'Bez SPZ'}{year ? ` · ${year}` : ''}{note ? ' · ' + note : ''}</small></div><span className={v.active ? 'pill good' : 'pill bad'}>{v.active ? 'Aktivní' : 'Neaktivní'}</span></div>
            </div>
            <div className="row-actions list-row-actions">
              <button onClick={() => openEdit(v)}>Upravit</button>
              {v.active === false ? <button onClick={() => restoreVehicle(v)}>Obnovit</button> : <DeleteIconButton label="Deaktivovat vozidlo" onClick={() => softDelete(v)} />}
            </div>
          </div>
        })}</div>
      </div>
      <div className="card"><div className="section-title"><h3>Servisní blokace</h3><span className="pill warn">{data.serviceBlocks.length}</span></div><form className="form two-col" onSubmit={addBlock}><Field label="Vozidlo"><select value={block.vehicleId} onChange={(e) => setBlock({ ...block, vehicleId: e.target.value })}><option value="">Vyber vůz</option>{data.vehicles.filter((v) => v.active !== false).map((v) => <option key={v.id} value={v.id}>{v.name} · {v.plate}</option>)}</select></Field><Field label="Důvod"><input value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })} /></Field><Field label="Od"><input type="date" value={block.from} onChange={(e) => setBlock({ ...block, from: e.target.value })} /></Field><Field label="Do"><input type="date" value={block.to} onChange={(e) => setBlock({ ...block, to: e.target.value })} /></Field><div className="field span2"><button className="primary" type="submit">Přidat blokaci</button></div></form><div className="stack" style={{ marginTop: 12 }}>{data.serviceBlocks.map((s) => <div className="alert warn" key={s.id}>{data.vehicles.find((v) => v.id === s.vehicleId)?.name || 'Vůz'} · {s.from} až {s.to}<br /><small>{s.reason}</small><div className="row-actions" style={{ marginTop: 8 }}><DeleteIconButton label="Odstranit servisní blokaci" onClick={() => removeBlock(s.id)} /></div></div>)}{!data.serviceBlocks.length && <div className="empty">Žádné servisní blokace.</div>}</div></div>
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
          <button className="danger" type="button" onClick={() => softDelete()} disabled={editingVehicle?.active === false}>Deaktivovat vozidlo</button>
        </div>}
      </form>
    </SideDrawer>
    {deleteVehicle && <ConfirmActionModal
      title="Deaktivovat vozidlo"
      message="Vozidlo se skryje jako neaktivní, ale historické směny a záznamy zůstanou zachované."
      confirmLabel="Deaktivovat vozidlo"
      confirmClass="danger"
      onClose={() => setVehicleToDelete('')}
      onConfirm={confirmSoftDelete}
    >
      <ActionSummary eyebrow="Vozidlo" title={`${deleteVehicle.name || 'Bez modelu'} · ${deleteVehicle.plate || 'Bez SPZ'}`} meta={vehicleNoteBody(deleteVehicle.note) || 'Bez poznámky'} />
    </ConfirmActionModal>}
    {deleteServiceBlock && <ConfirmActionModal
      title="Odstranit servisní blokaci"
      message="Servisní blokace se odstraní z plánování dostupnosti vozidla."
      confirmLabel="Odstranit blokaci"
      confirmClass="danger"
      onClose={() => setServiceBlockToDelete('')}
      onConfirm={confirmRemoveBlock}
    >
      <ActionSummary eyebrow="Blokace" title={`${deleteServiceBlock.from} až ${deleteServiceBlock.to}`} meta={deleteServiceBlock.reason || 'Bez důvodu'} />
    </ConfirmActionModal>}
  </>
}


function Availability({ data, commit, currentDriver }) {
  const firstDriverId = currentDriver?.id || data.drivers.find((d) => d.active !== false)?.id || data.drivers[0]?.id || ''
  const [absence, setAbsence] = useState({ driverId: firstDriverId, from: todayISO(), to: todayISO(), reason: '' })
  const [slot, setSlot] = useState({ driverId: firstDriverId, kind: 'available', fromAt: datetimeLocal(todayISO(), '07:00'), toAt: datetimeLocal(todayISO(), '19:00'), note: '' })
  const [availabilityToast, setAvailabilityToast] = useState('')
  const [deleteDialog, setDeleteDialog] = useState(null)
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
  const deleteTarget = deleteDialog?.type === 'absence'
    ? data.absences.find((item) => item.id === deleteDialog.id)
    : deleteDialog?.type === 'slot'
      ? (data.availability || []).find((item) => item.id === deleteDialog.id)
      : null
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
  const requestDelete = (type, id) => {
    setDeleteDialog({ type, id })
  }
  const confirmDelete = () => {
    if (!deleteTarget || !deleteDialog) return
    if (deleteDialog.type === 'absence') {
      commit((prev) => ({ ...prev, absences: prev.absences.filter((a) => a.id !== deleteTarget.id) }), 'Nepřítomnost řidiče odstraněna.')
    } else {
      commit((prev) => ({ ...prev, availability: (prev.availability || []).filter((a) => a.id !== deleteTarget.id) }), 'Dostupnost řidiče odstraněna.')
    }
    setDeleteDialog(null)
  }
  const removeAbsence = (id) => requestDelete('absence', id)
  const removeSlot = (id) => requestDelete('slot', id)
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
          <div className="row-actions" style={{ marginTop: 8 }}><DeleteIconButton label="Odstranit dostupnost" onClick={() => removeSlot(a.id)} /></div>
        </div>
      })}{!availability.length && <div className="empty">Není zadaná žádná dostupnost.</div>}</div></div>
      <div className="card"><div className="section-title"><h3>Nepřítomnosti</h3><span className="pill warn">{absences.length}</span></div><div className="stack compact-list">{absences.map((a) => <div className="alert warn" key={a.id}><b>{data.drivers.find((d) => d.id === a.driverId)?.name}</b> · {a.from} až {a.to}<br /><small>{a.reason || 'Bez důvodu'}</small><div className="row-actions" style={{ marginTop: 8 }}><DeleteIconButton label="Odstranit nepřítomnost" onClick={() => removeAbsence(a.id)} /></div></div>)}{!absences.length && <div className="empty">Žádné nepřítomnosti.</div>}</div></div>
    </div>
    {deleteTarget && <ConfirmActionModal
      title={deleteDialog.type === 'absence' ? 'Odstranit nepřítomnost' : 'Odstranit dostupnost'}
      message={deleteDialog.type === 'absence' ? 'Nepřítomnost se odstraní z plánování dostupnosti řidiče.' : 'Záznam dostupnosti se odstraní z plánování směn.'}
      confirmLabel={deleteDialog.type === 'absence' ? 'Odstranit nepřítomnost' : 'Odstranit dostupnost'}
      confirmClass="danger"
      onClose={() => setDeleteDialog(null)}
      onConfirm={confirmDelete}
    >
      <ActionSummary
        eyebrow={deleteDialog.type === 'absence' ? 'Nepřítomnost' : 'Dostupnost'}
        title={deleteDialog.type === 'absence' ? `${deleteTarget.from} až ${deleteTarget.to}` : availabilityLabel(deleteTarget)}
        meta={`${data.drivers.find((d) => d.id === deleteTarget.driverId)?.name || 'Řidič'} · ${deleteDialog.type === 'absence' ? (deleteTarget.reason || 'Bez důvodu') : (availabilityNoteText(deleteTarget) || availabilityKindMap[availabilityKind(deleteTarget)] || 'Dostupnost')}`}
      />
    </ConfirmActionModal>}
  </>
}

function ShiftTemplates({ data, commit }) {
  const empty = { name: '', start: '07:00', end: '19:00', active: true, type: 'custom' }
  const templates = normalizeShiftTemplates(data.settings)
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [templateToDeactivate, setTemplateToDeactivate] = useState(null)
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
    if (!tpl?.id) return
    setTemplateToDeactivate(tpl)
  }
  const confirmDeactivate = () => {
    if (!templateToDeactivate?.id) return
    saveTemplates((items) => items.map((item) => item.id === templateToDeactivate.id ? { ...item, active: false } : item), 'Šablona směny deaktivována.')
    setTemplateToDeactivate(null)
    closeDrawer()
  }
  const restore = (tpl) => saveTemplates((items) => items.map((item) => item.id === tpl.id ? { ...item, active: true } : item), 'Šablona směny znovu aktivována.')
  return <>
    <PageTitle title="Šablony směn"><button className="primary" onClick={openCreate}>+ Přidat šablonu</button></PageTitle>
    <div className="card">
      <div className="section-title"><h3>Časy směn</h3><span className="pill">{activeCount} aktivní / {templates.length} celkem</span></div>
      <div className="stack compact-list">
        {templates.map((tpl) => <div className="log list-row" key={tpl.id}>
          <div className="list-row-main" role="button" tabIndex={0} onClick={() => openEdit(tpl)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(tpl) } }}>
            <div className="split">
              <div><b>{tpl.name}</b><br /><small className="muted">{tpl.start}–{tpl.end} · {shiftTypeMap[tpl.type] || 'Vlastní'}</small></div>
              <span className={tpl.active ? 'pill good' : 'pill bad'}>{tpl.active ? 'Aktivní' : 'Neaktivní'}</span>
            </div>
          </div>
          <div className="row-actions list-row-actions">
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
    {templateToDeactivate && <ConfirmActionModal
      title="Deaktivovat šablonu směny"
      message="Šablona se přestane nabízet při tvorbě nových směn. Existující směny se nezmění."
      confirmLabel="Deaktivovat šablonu"
      confirmClass="danger"
      onClose={() => setTemplateToDeactivate(null)}
      onConfirm={confirmDeactivate}
    >
      <ActionSummary eyebrow="Šablona" title={templateToDeactivate.name} meta={`${templateToDeactivate.start}–${templateToDeactivate.end} · ${shiftTypeMap[templateToDeactivate.type] || 'Vlastní'}`} />
    </ConfirmActionModal>}
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
  if (!session) return <AuthGate supabase={supabase} />
  if (!profile) return <MissingProfile supabase={supabase} session={session} error={profileError} reload={() => loadProfile(session)} />
  return <App session={session} profile={profile} signOut={() => supabase.auth.signOut()} />
}

const rootElement = document.getElementById('root')
const root = import.meta.hot
  ? (globalThis.__RBSHIFT_ROOT__ ||= createRoot(rootElement))
  : createRoot(rootElement)
root.render(<Root />)
