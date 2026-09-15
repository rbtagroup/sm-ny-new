import { useEffect, useState } from 'react'
import { Bell, CalendarDays, Car, ChevronDown, Clock, House, LayoutDashboard, LayoutTemplate, LogOut, Menu, Receipt, Settings as SettingsIcon, Target, Users, X } from 'lucide-react'
import { roleMap } from './lib/appConfig.js'
import { appFriendlyError } from './lib/errors.js'
import { driverInitials, staffDisplayName, staffInitials } from './lib/display.js'
import { STAFF_BOTTOM_NAV, staffBottomNavKey, staffMoreItems } from './lib/navigation.js'
import { showNotice } from './lib/notice.js'

export const driverNavItems = [
  ['driver', 'Domů', House],
  ['availability', 'Dostupnost', Clock],
  ['notifications', 'Notifikace', Bell],
  ['driverSettings', 'Nastavení', SettingsIcon],
]

const syncErrorTitles = {
  save: 'Změnu se nepodařilo uložit',
  load: 'Data se nepodařilo načíst',
  push: 'Uloženo, ale upozornění řidičům neodešlo',
}
const syncChipLabels = { save: 'Neuloženo', load: 'Nenačteno', push: 'Upozornění neodešlo' }

// Save state in the top bar, visible on every page and screen size: saving, a short "saved", or the failure with a retry.
export function SyncStatus({ syncState, onRetry, idle = null }) {
  const [openError, setOpenError] = useState('')
  const [expiredSavedAt, setExpiredSavedAt] = useState('')
  const error = syncState?.error || ''
  const kind = error ? (syncState?.errorKind || 'load') : ''
  const savedAt = syncState?.savedAt || ''
  useEffect(() => {
    if (!savedAt) return undefined
    const timer = setTimeout(() => setExpiredSavedAt(savedAt), 2500)
    return () => clearTimeout(timer)
  }, [savedAt])
  useEffect(() => {
    if (kind === 'save') showNotice(`${syncErrorTitles.save}: ${error}`, { tone: 'bad' })
  }, [kind, error])

  if (error) {
    const expanded = openError === error
    return <div className="topbar-menu-wrap sync-status">
      <button type="button" className={`sync-chip ${kind === 'push' ? 'warn' : 'bad'}`} aria-expanded={expanded} onClick={() => setOpenError(expanded ? '' : error)}>{syncChipLabels[kind]}</button>
      {expanded && <div className="topbar-dropdown sync-dropdown" role="alert">
        <b>{syncErrorTitles[kind]}</b>
        <p>{appFriendlyError(error)}</p>
        {kind === 'save' && <p className="muted">Změna se vrátila zpět, udělej ji prosím znovu.</p>}
        {kind !== 'push' && onRetry && <button type="button" className="primary" onClick={() => { setOpenError(''); onRetry() }}>Načíst znovu</button>}
      </div>}
    </div>
  }
  if (syncState?.saving) return <span className="sync-chip" role="status">Ukládám…</span>
  if (savedAt && expiredSavedAt !== savedAt) return <span className="sync-chip good" role="status">Uloženo</span>
  return idle
}

export function DriverAppShell({ currentDriver, onlineMode, page, unreadCount, onPageChange, syncState, onRetrySync, updateToast, children }) {
  const avatarUrl = currentDriver?.avatarUrl || currentDriver?.avatar_url
  const driverName = currentDriver?.name || 'Řidič'

  return <div className="driver-shell-v2">
    <header className="driver-topbar-v2">
      <div className="driver-topbar-brand">
        {avatarUrl ? <img className="driver-avatar-img" src={avatarUrl} alt={driverName} /> : <div className="logo compact-logo">{driverInitials(driverName)}</div>}
        <div><strong>{driverName}</strong><small>Řidič</small></div>
      </div>
      {onlineMode ? <SyncStatus syncState={syncState} onRetry={onRetrySync} idle={<span className="pill good"><span className="status-dot good" aria-hidden="true"></span>Online</span>} /> : <span className="pill warn">Demo</span>}
    </header>
    <main className={`driver-main-v2 ${page === 'driverSettings' ? 'driver-main-settings' : ''}`}>
      {onlineMode && currentDriver?.active === false && <div className="alert warn" role="status"><b>Účet zatím není aktivní</b><br /><span>Dispečink tvůj řidičský účet ještě neschválil nebo ho vyřadil. Jakmile ho schválí nebo obnoví, uvidíš tady směny a zprávy.</span></div>}
      {children}
    </main>
    <nav className="driver-bottom-nav" aria-label="Řidičská navigace">
      {driverNavItems.map(([key, label, Icon]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => onPageChange(key)}>
        <span className="driver-nav-icon"><Icon size={24} strokeWidth={2} />{key === 'notifications' && unreadCount > 0 && <em>{unreadCount}</em>}</span>
        <b>{label}</b>
      </button>)}
    </nav>
    {updateToast}
  </div>
}

export function StaffAppShell({ title, companyName, unreadCount, notifications, profile, currentDriver, role, canOpenSettings, signOut, setPage, page = '', activePage, sidebarSections, onlineMode, syncState, onRetrySync, updateToast, children }) {
  return <div className="app app-with-topbar">
    <AppTopBar
      syncStatus={onlineMode ? <SyncStatus syncState={syncState} onRetry={onRetrySync} /> : null}
      title={title}
      companyName={companyName}
      unreadCount={unreadCount}
      notifications={notifications}
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
          <div className="nav">{items.map(([key, label]) => <button key={key} className={activePage === key ? 'active' : ''} onClick={() => setPage(key)}>{label}</button>)}</div>
        </div>)}
      </nav>
      <div className="sidebar-footer" aria-label="Stav úložiště">
        <div className="sync-line"><span className={onlineMode ? 'status-dot good' : 'status-dot warn'}></span><span>{onlineMode ? 'Supabase online' : 'Demo / localStorage'}</span></div>
        {onlineMode ? <small>{syncState?.saving ? 'Sync: ukládám…' : syncState?.lastSyncAt ? `Sync ${new Date(syncState.lastSyncAt).toLocaleTimeString('cs-CZ')}` : 'Sync aktivní'}</small> : <small>Lokální demo režim</small>}
        {syncState?.error && <small className="danger-mini-text">{appFriendlyError(syncState.error)}</small>}
      </div>
    </aside>
    <main className="main">{children}</main>
    <StaffBottomNav page={page || activePage} role={role} unreadCount={unreadCount} setPage={setPage} profile={profile} currentDriver={currentDriver} signOut={signOut} />
    {updateToast}
  </div>
}

const staffNavIcons = { planner: CalendarDays, dashboard: LayoutDashboard, settlements: Receipt, notifications: Bell, drivers: Users, vehicles: Car, availability: Clock, coverageNorms: Target, shiftTemplates: LayoutTemplate, settings: SettingsIcon }

// Phones: the daily pages in a bottom bar like the driver app, the rest and signing out in the "Více" sheet.
function StaffBottomNav({ page, role, unreadCount, setPage, profile, currentDriver, signOut }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const active = staffBottomNavKey(page)
  const go = (key) => {
    setMoreOpen(false)
    setPage(key)
  }
  useEffect(() => {
    if (!moreOpen) return undefined
    const onKeyDown = (event) => { if (event.key === 'Escape') setMoreOpen(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [moreOpen])
  return <>
    <nav className="staff-bottom-nav" aria-label="Navigace dispečinku">
      {STAFF_BOTTOM_NAV.map(([key, label]) => {
        const Icon = staffNavIcons[key]
        return <button key={key} type="button" className={active === key && !moreOpen ? 'active' : ''} aria-current={active === key ? 'page' : undefined} onClick={() => go(key)}>
          <span className="driver-nav-icon"><Icon size={22} strokeWidth={2} aria-hidden="true" />{key === 'notifications' && unreadCount > 0 && <em>{unreadCount}</em>}</span>
          <b>{label}</b>
        </button>
      })}
      <button type="button" className={active === 'more' || moreOpen ? 'active' : ''} aria-expanded={moreOpen} aria-haspopup="dialog" onClick={() => setMoreOpen((open) => !open)}>
        <span className="driver-nav-icon"><Menu size={22} strokeWidth={2} aria-hidden="true" /></span>
        <b>Více</b>
      </button>
    </nav>
    {moreOpen && <div className="staff-more-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMoreOpen(false) }}>
      <div className="staff-more-sheet" role="dialog" aria-modal="true" aria-label="Další stránky">
        <div className="staff-more-head">
          <span className="staff-more-avatar" aria-hidden="true">{staffInitials(profile, currentDriver, role)}</span>
          <div><b>{staffDisplayName(profile, currentDriver, role)}</b><small>{roleMap[role] || 'Dispečink'}</small></div>
          <button type="button" className="ghost staff-more-close" aria-label="Zavřít" onClick={() => setMoreOpen(false)}><X size={20} strokeWidth={2.2} aria-hidden="true" /></button>
        </div>
        <div className="staff-more-list">
          {staffMoreItems(role).map(([key, label]) => {
            const Icon = staffNavIcons[key]
            return <button key={key} type="button" className={page === key ? 'active' : ''} onClick={() => go(key)}><Icon size={20} strokeWidth={2} aria-hidden="true" /><span>{label}</span></button>
          })}
        </div>
        {signOut && <button type="button" className="ghost staff-more-signout" onClick={() => { setMoreOpen(false); signOut() }}><LogOut size={18} strokeWidth={2.2} aria-hidden="true" />Odhlásit</button>}
      </div>
    </div>}
  </>
}

export function UpdateReadyToast({ applying, onRefresh, onDismiss }) {
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

function AppTopBar({ title, companyName, unreadCount, notifications, profile, currentDriver, role, canOpenSettings, signOut, setPage, syncStatus }) {
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
      {syncStatus}
      <div className="topbar-menu-wrap">
        <button className="topbar-icon-button" aria-label="Notifikace" aria-expanded={notificationsOpen} onClick={openNotifications}><Bell size={20} strokeWidth={2.2} aria-hidden="true" />{unreadCount > 0 && <span>{unreadCount}</span>}</button>
        {notificationsOpen && <div className="topbar-dropdown notification-dropdown">
          <b>Nepřečtené notifikace</b>
          <div className="topbar-dropdown-list">
            {unreadItems.length ? unreadItems.map((notice) => <button key={notice.id} onClick={() => { setPage('notifications'); setNotificationsOpen(false) }}>
              <strong>{notice.title}</strong>
              {notice.body && <small>{notice.body}</small>}
            </button>) : <p className="muted">Žádné nepřečtené notifikace.</p>}
          </div>
          <button className="ghost topbar-dropdown-action" onClick={() => { setPage('notifications'); setNotificationsOpen(false) }}>Zobrazit vše</button>
        </div>}
      </div>
      <div className="topbar-menu-wrap">
        <button className="topbar-user-button" aria-expanded={userMenuOpen} onClick={openUserMenu}><span>{staffInitials(profile, currentDriver, role)}</span><b>{displayName}</b><em><ChevronDown size={15} strokeWidth={2.4} aria-hidden="true" /></em></button>
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
