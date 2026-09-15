import './main.css'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient } from '@supabase/supabase-js'
import { Check, TriangleAlert } from 'lucide-react'
import { DriverAppShell, StaffAppShell, UpdateReadyToast } from './AppShell.jsx'
import {
  ActionSummary,
  ConfirmActionModal,
  ConflictBox,
  Field,
  Kpi,
  Modal,
  NoticeToast,
  PageTitle,
  ReasonActionModal,
  Select,
  SettlementMobileSummary,
  SettlementStatusPill,
  SettlementSummary,
  ShiftActionSummary,
  SideDrawer,
  StatusPill,
  TonePill,
} from './AppUi.jsx'
import { AuthGate, MissingProfile, PasswordRecovery } from './AuthViews.jsx'
import { Availability } from './AvailabilityView.jsx'
import { Dashboard } from './DashboardView.jsx'
import { Drivers } from './DriversView.jsx'
import { DriverHome } from './DriverHome.jsx'
import { DriverSettings } from './DriverSettings.jsx'
import { History } from './HistoryView.jsx'
import { NotificationsView } from './NotificationsView.jsx'
import { Planner } from './PlannerView.jsx'
import { SettingsView } from './SettingsView.jsx'
import { SettlementFormModal } from './SettlementFormModal.jsx'
import { ShiftTable } from './StaffShiftTable.jsx'
import { ShiftTemplates } from './ShiftTemplatesView.jsx'
import { CoverageNorms } from './CoverageNormsView.jsx'
import { StaffAvailability } from './StaffAvailabilityView.jsx'
import { Vehicles } from './VehiclesView.jsx'
import { useCurrentDate } from './useCurrentDate.js'
import { createAppDataSync } from './lib/appDataSync.js'
import { clearStore } from './lib/appStore.js'
import {
  addDays,
  formatDate,
  hoursLabel,
  startOfWeek,
  timePart,
  todayISO,
} from './lib/dateTime.js'
import {
  addNotificationsToData,
  createNoticeFactory,
} from './lib/notifications.js'
import { notificationInboxState } from './lib/notificationInbox.js'
import { staffNoticeState } from './lib/staffNotifications.js'
import { coverageDayRows, coverageDaysLabel } from './lib/coverage.js'
import { uid } from './lib/ids.js'
import { sendPushForNotifications } from './lib/pushDelivery.js'
import {
  canOpenSettlement,
  settlementForShift,
} from './lib/settlements.js'
import {
  shiftTypeMap,
  statusMap,
} from './lib/appConfig.js'
import {
  shiftNoticeBody,
  shiftTypeName,
  sortByDateTime,
} from './lib/display.js'
import {
  attendanceRows,
  readinessChecks,
  readinessText,
} from './lib/opsMetrics.js'
import {
  download,
  driverText,
  exportAttendanceCSV,
  weekText,
} from './lib/shiftExports.js'
import { showNotice } from './lib/notice.js'
import { buildHelpers } from './lib/shiftHelpers.js'
import { isRoutineSchedulerLog } from './lib/auditLog.js'
import { ADMIN_PAGE_KEYS, navPageFor, overviewTabs, staffNavSections } from './lib/navigation.js'

const VERSION = `${__APP_VERSION__}-vycetka`
const makeNotice = createNoticeFactory(uid)
const pageTitleMap = { planner: 'Plán směn', dashboard: 'Dashboard', audit: 'Audit provozu', settlements: 'Výčetky', notifications: 'Notifikace', shifts: 'Seznam směn', drivers: 'Řidiči', vehicles: 'Vozidla', availability: 'Dostupnost', shiftTemplates: 'Šablony směn', coverageNorms: 'Normy pokrytí', history: 'Historie změn', settings: 'Nastavení' }


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
function adminNotice(title, body, type = 'info', shiftId = '', options = {}) {
  return makeNotice({ title, body, targetRole: 'admin', type, shiftId, ...options })
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
    showNotice('Text je zkopírovaný, vlož ho do zprávy.', { tone: 'good' })
  } catch {
    try { execCopy(); showNotice('Text je zkopírovaný, vlož ho do zprávy.', { tone: 'good' }) }
    catch { showNotice('Kopírování se nepodařilo. Označ text ručně a zkopíruj ho přes Ctrl/Cmd+C.', { tone: 'bad' }) }
  }
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
  const currentDate = useCurrentDate()
  const helpers = useMemo(() => buildHelpers(data), [data])
  const demoParams = getLocalDemoParams(onlineMode)
  const demoRole = ['admin', 'dispatcher', 'driver'].includes(demoParams.role) ? demoParams.role : ''
  const demoDriverId = resolveDemoDriverId(demoParams.driver, data.drivers)
  const [page, setPage] = useState(() => demoRole === 'driver' ? 'driver' : 'planner')
  // a dashboard task opens the planner once at its shift or missing coverage
  const [plannerIntent, setPlannerIntent] = useState(null)
  const openPlannerFor = (intent) => {
    setPlannerIntent(intent)
    setPage('planner')
  }
  useEffect(() => { if (page !== 'planner') setPlannerIntent(null) }, [page])
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
    if (!isDriver && role !== 'admin' && ADMIN_PAGE_KEYS.has(page)) setPage('planner')
  }, [isDriver, page, role])

  const { unread: unreadInbox } = notificationInboxState(data, { currentDriver, isDriver, profile })
  // Dispatch only counts notices that still wait for it; driver notices and handled items stay out of the badge.
  const unreadNotifications = isDriver ? unreadInbox : unreadInbox.filter((notice) => staffNoticeState(notice, data, { today: currentDate }) === 'open')
  const unreadForCurrent = unreadNotifications.length
  const canOpenSettings = role === 'admin'
  const sidebarSections = staffNavSections(role)
  const overviewPageTabs = <div className="tabs page-tabs" role="tablist" aria-label="Přehled provozu">
    {overviewTabs(role).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={page === key} className={page === key ? 'active' : ''} onClick={() => setPage(key)}>{label}</button>)}
  </div>
  const updateToast = <>{updateWorker && <UpdateReadyToast applying={updateApplying} onRefresh={applyPwaUpdate} onDismiss={dismissPwaUpdate} />}<NoticeToast /></>

  if (isDriver) return <DriverAppShell currentDriver={currentDriver} onlineMode={onlineMode} page={page} unreadCount={unreadForCurrent} onPageChange={setPage} syncState={syncState} onRetrySync={() => reloadOnline()} updateToast={updateToast}>
      {page === 'driver' && <DriverHome data={data} helpers={helpers} commit={commit} currentDriver={currentDriver} profile={profile} ui={driverHomeUi} services={driverHomeServices} />}
      {page === 'notifications' && <NotificationsView data={data} helpers={helpers} commit={commit} currentDriver={currentDriver} isDriver={isDriver} profile={profile} session={session} ui={notificationUi} services={notificationServices} />}
      {page === 'availability' && <Availability data={data} commit={commit} currentDriver={currentDriver} ui={availabilityUi} />}
      {page === 'driverSettings' && <DriverSettings data={data} commit={commit} currentDriver={currentDriver} profile={profile} session={session} onlineMode={onlineMode} signOut={signOut} syncState={syncState} version={VERSION} ui={driverSettingsUi} notificationUi={notificationUi} notificationServices={notificationServices} />}
  </DriverAppShell>

  return <StaffAppShell
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
      page={page}
      activePage={navPageFor(page)}
      sidebarSections={sidebarSections}
      onlineMode={onlineMode}
      syncState={syncState}
      onRetrySync={() => reloadOnline()}
      updateToast={updateToast}
    >
      {page === 'planner' && <Planner data={data} helpers={helpers} commit={commit} today={currentDate} ui={plannerUi} services={plannerServices} onOpenTemplates={role === 'admin' ? () => setPage('shiftTemplates') : undefined} onOpenNorms={() => setPage('coverageNorms')} intent={plannerIntent} />}
      {page === 'dashboard' && <Dashboard data={data} helpers={helpers} commit={commit} today={currentDate} ui={dashboardUi} services={dashboardServices} tabs={overviewPageTabs} onOpenPlanner={openPlannerFor} />}
      {page === 'settlements' && <Settlements data={data} helpers={helpers} commit={commit} />}
      {page === 'audit' && <OperationalAudit data={data} helpers={helpers} tabs={overviewPageTabs} onOpenNorms={() => setPage('coverageNorms')} />}
      {page === 'notifications' && <NotificationsView data={data} helpers={helpers} commit={commit} currentDriver={currentDriver} isDriver={isDriver} profile={profile} session={session} ui={notificationUi} services={notificationServices} />}
      {page === 'shifts' && <ShiftsList data={data} helpers={helpers} commit={commit} />}
      {page === 'drivers' && <Drivers data={data} commit={commit} ui={driversUi} services={driversServices} onlineMode={onlineMode} reloadOnline={reloadOnline} canRemoveDrivers={role === 'admin'} onOpenAvailability={() => setPage('availability')} />}
      {page === 'vehicles' && <Vehicles data={data} commit={commit} ui={vehiclesUi} services={vehiclesServices} />}
      {page === 'availability' && <StaffAvailability data={data} commit={commit} today={currentDate} ui={staffAvailabilityUi} />}
      {page === 'shiftTemplates' && <ShiftTemplates data={data} commit={commit} ui={shiftTemplatesUi} />}
      {page === 'coverageNorms' && <CoverageNorms data={data} commit={commit} today={currentDate} ui={coverageNormsUi} />}
      {page === 'history' && <History data={data} ui={historyUi} services={historyServices} tabs={overviewPageTabs} />}
      {page === 'settings' && <SettingsView data={data} helpers={helpers} commit={commit} supabase={supabase} onlineMode={onlineMode} reloadOnline={reloadOnline} profile={profile} version={VERSION} ui={settingsUi} onOpenTemplates={() => setPage('shiftTemplates')} onOpenNorms={() => setPage('coverageNorms')} />}
  </StaffAppShell>
}
const settlementFormUi = { Field, Modal, ReasonActionModal, SettlementStatusPill, ShiftActionSummary }
const settlementFormServices = { uid, makeNotice, adminNotice }
const shiftTableUi = { ConfirmActionModal, ReasonActionModal, ShiftActionSummary, StatusPill }
const shiftTableServices = { uid, isPastLocked, statusNoticeForShift, cancelShiftData, hardDeleteShiftData }
const plannerUi = { PageTitle, Kpi, Field, Select, ConflictBox, ConfirmActionModal, ReasonActionModal, ShiftActionSummary, SettlementStatusPill, SettlementSummary, SideDrawer, StatusPill }
const plannerServices = { uid, buildHelpers, makeNotice, adminNotice, appendSwapHistory, isPastLocked, statusNoticeForShift, cancelShiftData, hardDeleteShiftData, copyText, weekText, driverText, settlementFormUi, settlementFormServices, shiftTableUi, shiftTableServices }
const dashboardUi = { PageTitle, Kpi, StatusPill }
const dashboardServices = { copyText, makeNotice, shiftTableUi, shiftTableServices }
const driverHomeUi = { ConflictBox, Field, Kpi, Modal, ReasonActionModal, SettlementFormModal, SettlementStatusPill, SettlementSummary, ShiftActionSummary, StatusPill }
const availabilityUi = { ActionSummary, ConfirmActionModal, Field, Modal, PageTitle }
const staffAvailabilityUi = { ActionSummary, ConfirmActionModal, Field, PageTitle, SideDrawer }
const driversUi = { ActionSummary, ConfirmActionModal, Field, PageTitle, SideDrawer }
const driversServices = { uid, supabase, copyText }
const notificationUi = { Field, Kpi, Modal, PageTitle, SideDrawer }
const driverSettingsUi = { PageTitle }
const historyUi = { Field, PageTitle }
const historyServices = { download }
const settingsUi = { Field, Kpi, PageTitle }
const shiftTemplatesUi = { ActionSummary, ConfirmActionModal, Field, PageTitle, Select, SideDrawer }
const coverageNormsUi = { ActionSummary, ConfirmActionModal, Field, PageTitle, SideDrawer }
const vehiclesUi = { ActionSummary, ConfirmActionModal, Field, PageTitle, SideDrawer }
const vehiclesServices = { todayISO, uid }

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
      <TonePill tone="pending">{waiting} čeká na schválení</TonePill>
      <span className="pill">{missing} bez výčetky</span>
      <TonePill tone="confirmed">{approved} schváleno</TonePill>
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
    {selectedShift && <SettlementFormModal data={data} helpers={helpers} commit={commit} shift={selectedShift} isDriver={false} onClose={() => setSelectedShiftId('')} ui={settlementFormUi} services={settlementFormServices} />}
  </>
}

function OperationalAudit({ data, helpers, tabs = null, onOpenNorms }) {
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
  const coverageRows = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    .flatMap((day) => coverageDayRows(data, day).filter((row) => row.need > 0))
    .map((row) => ({ day: row.day, slot: row, planned: row.planned, need: row.need, override: row.override, missing: row.missing }))
  const attendance = attendanceRows(data, helpers, weekStart, to)
  const plannedTotal = attendance.reduce((sum, row) => sum + row.plannedMinutes, 0)
  const actualTotal = attendance.reduce((sum, row) => sum + row.actualMinutes, 0)
  const currentMonth = todayISO().slice(0, 7)
  const monthLogs = (data.audit || []).filter((row) => String(row.at || row.createdAt || '').startsWith(currentMonth) && !isRoutineSchedulerLog(row))
  const todayIssues = audit.conflicts.length + audit.gaps.length + audit.pendingSwaps.length + audit.declined.length
  const weekIssues = coverageRows.filter((r) => r.missing).length + attendance.filter((row) => row.open || Math.abs(row.diffMinutes) > 15).length
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
    {tabs}
    <div className="grid kpis compact-kpis">
      <Kpi label="Připravenost" value={`${readinessPct} %`} hint={`${passed}/${audit.checks.length} kontrol OK`} kind={readinessPct === 100 ? 'good' : readinessPct >= 75 ? 'warn' : 'bad'} />
      <Kpi label="Týden" value={`${formatDate(weekStart)}–${formatDate(to)}`} hint="auditované období" />
      <Kpi label="Problémy" value={audit.conflicts.length + audit.gaps.length + audit.pendingSwaps.length + audit.declined.length} hint="ve směnách, obsazení, výměny a odmítnutí" kind={(audit.conflicts.length + audit.gaps.length + audit.pendingSwaps.length + audit.declined.length) ? 'bad' : 'good'} />
      <Kpi label="Docházka" value={hoursLabel(actualTotal)} hint={`proběhlé směny: plán ${hoursLabel(plannedTotal)} · rozdíl ${hoursLabel(actualTotal - plannedTotal)}`} />
    </div>
    <div className="stack" style={{ marginTop: 16 }}>
      <details className="card collapse-card" {...sectionProps('today')}>
        <summary><span><b>Dnes</b><small>{passed}/{audit.checks.length} kontrol OK · {todayIssues ? `${todayIssues} problémů` : 'bez kritických problémů'}</small></span><span className={todayIssues ? 'pill warn' : 'pill good'}>{todayIssues || 'OK'}</span></summary>
        <div className="stack collapse-content">
          <div className="section-title"><h3>Připravenost provozu</h3><span className={readinessPct === 100 ? 'pill good' : 'pill warn'}>{readinessPct === 100 ? 'OK' : 'doplnit'}</span></div>
          <div className="audit-check-list">{audit.checks.map((check) => <div className={`alert audit-check ${check.ok ? 'good' : 'warn'}`} key={check.key}><b>{check.ok ? <Check size={16} strokeWidth={2.8} aria-hidden="true" /> : <TriangleAlert size={16} strokeWidth={2.4} aria-hidden="true" />}{check.label}</b><span>{check.detail}</span></div>)}</div>
        </div>
      </details>
      <details className="card collapse-card" {...sectionProps('week')}>
        <summary><span><b>Tento týden</b><small>{formatDate(weekStart)}–{formatDate(to)} · pokrytí a docházka</small></span><span className={weekIssues ? 'pill bad' : 'pill good'}>{weekIssues ? `${weekIssues} kontrol` : 'OK'}</span></summary>
        <div className="collapse-content stack">
          <div className="section-title"><h3>Pokrytí týdne</h3><span className={coverageRows.some((r) => r.missing) ? 'pill bad' : 'pill good'}>{coverageRows.filter((r) => r.missing).length}</span></div>
          <div className="table-wrap compact-table audit-table-scroll audit-card-table audit-coverage-table"><table className="table"><thead><tr><th>Den</th><th>Pásmo</th><th>Čas</th><th>Plán</th><th>Potřeba</th><th>Stav</th></tr></thead><tbody>{coverageRows.map((row) => <tr key={`${row.day}-${row.slot.id}`}><td><b>{formatDate(row.day)}</b></td><td>{row.slot.name}</td><td>{row.slot.start}–{row.slot.end}</td><td>{row.planned}</td><td>{row.need}{row.override && <small> · na tento den</small>}</td><td>{row.missing ? <TonePill tone="open">chybí {row.missing}</TonePill> : <span className="pill good">OK</span>}</td></tr>)}</tbody></table></div>
          <div className="section-title"><h3>Docházkový report</h3><span className="pill">{hoursLabel(actualTotal)}</span></div>
          <div className="table-wrap compact-table audit-table-scroll audit-card-table audit-attendance-table"><table className="table"><thead><tr><th>Řidič</th><th>Směn</th><th>Dokončeno</th><th>Plán</th><th>Reál</th><th>Rozdíl</th><th>Kontrola</th></tr></thead><tbody>{attendance.map((row) => <tr key={row.driver.id}><td><b>{row.driver.name}</b><br /><small>{row.driver.phone || row.driver.email || 'bez kontaktu'}</small></td><td>{row.shifts.length}</td><td>{row.completed}</td><td>{hoursLabel(row.plannedMinutes)}</td><td>{hoursLabel(row.actualMinutes)}</td><td>{hoursLabel(row.diffMinutes)}</td><td>{row.open ? <span className="pill warn">{row.open} běží</span> : <span className="pill good">OK</span>}</td></tr>)}</tbody></table></div>
        </div>
      </details>
      <details className="card collapse-card" {...sectionProps('month')}>
        <summary><span><b>Tento měsíc</b><small>{monthLogs.length} záznamů historie · dlouhodobé normy</small></span><span className="pill">{monthLogs.length}</span></summary>
        <div className="collapse-content stack">
          <div className="section-title"><h3>Normy pokrytí</h3>{onOpenNorms ? <button className="ghost" type="button" onClick={onOpenNorms}>Upravit normy</button> : <span className="pill">{data.settings?.coverageSlots?.length || 0}</span>}</div>
          {(data.settings?.coverageSlots || []).length ? <div className="table-wrap compact-table audit-table-scroll audit-card-table audit-standards-table"><table className="table"><thead><tr><th>Pásmo</th><th>Čas</th><th>Běžně řidičů</th><th>Dny</th></tr></thead><tbody>{(data.settings?.coverageSlots || []).map((slot) => <tr key={slot.id}><td><b>{slot.name}</b></td><td>{slot.start}–{slot.end}</td><td>{Number(slot.minDrivers) || 0}</td><td>{coverageDaysLabel(slot)}</td></tr>)}</tbody></table></div> : <div className="empty">Zatím žádné normy pokrytí.</div>}
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
      <input className="searchbox" aria-label="Hledat směnu" placeholder="Hledat směnu…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ minWidth: 240 }} />
      <select className="searchbox" aria-label="Filtr stavu směny" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 190 }}>{[['all', 'Vše'], ...Object.entries(statusMap)].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
    </PageTitle>
    <ShiftTable shifts={filtered} data={data} helpers={helpers} commit={commit} ui={shiftTableUi} services={shiftTableServices} />
  </>
}
function Root() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(isConfiguredSupabase)
  const [profileError, setProfileError] = useState('')
  const [passwordRecovery, setPasswordRecovery] = useState(false)

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
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (event === 'SIGNED_OUT') clearStore()
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      setSession(sess)
      loadProfile(sess)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    clearStore()
    await supabase.auth.signOut()
  }

  if (!isConfiguredSupabase) return <App />
  if (loading) return <div className="auth-shell"><div className="card"><h2>RBSHIFT</h2><p className="muted">Načítám online režim…</p></div></div>
  if (passwordRecovery && session) return <PasswordRecovery supabase={supabase} onDone={() => setPasswordRecovery(false)} />
  if (!session) return <AuthGate supabase={supabase} />
  if (!profile) return <MissingProfile supabase={supabase} session={session} error={profileError} reload={() => loadProfile(session)} />
  return <App session={session} profile={profile} signOut={signOut} />
}

const rootElement = document.getElementById('root')
const root = import.meta.hot
  ? (globalThis.__RBSHIFT_ROOT__ ||= createRoot(rootElement))
  : createRoot(rootElement)
root.render(<Root />)
