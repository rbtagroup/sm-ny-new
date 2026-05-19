import { useState } from 'react'
import { Bell, Clock, House, Settings as SettingsIcon } from 'lucide-react'
import { appFriendlyError } from './lib/errors.js'
import { driverInitials, staffDisplayName, staffInitials } from './lib/display.js'

export const driverNavItems = [
  ['driver', 'Domů', House],
  ['availability', 'Dostupnost', Clock],
  ['notifications', 'Notifikace', Bell],
  ['driverSettings', 'Nastavení', SettingsIcon],
]

export function DriverAppShell({ currentDriver, onlineMode, page, unreadCount, onPageChange, updateToast, children }) {
  const avatarUrl = currentDriver?.avatarUrl || currentDriver?.avatar_url
  const driverName = currentDriver?.name || 'Řidič'

  return <div className="driver-shell-v2">
    <header className="driver-topbar-v2">
      <div className="driver-topbar-brand">
        {avatarUrl ? <img className="driver-avatar-img" src={avatarUrl} alt={driverName} /> : <div className="logo compact-logo">{driverInitials(driverName)}</div>}
        <div><strong>{driverName}</strong><small>Řidič</small></div>
      </div>
      <span className={onlineMode ? 'pill good' : 'pill warn'}>{onlineMode ? 'Online ●' : 'Demo'}</span>
    </header>
    <main className={`driver-main-v2 ${page === 'driverSettings' ? 'driver-main-settings' : ''}`}>{children}</main>
    <nav className="driver-bottom-nav" aria-label="Řidičská navigace">
      {driverNavItems.map(([key, label, Icon]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => onPageChange(key)}>
        <span className="driver-nav-icon"><Icon size={24} strokeWidth={2} />{key === 'notifications' && unreadCount > 0 && <em>{unreadCount}</em>}</span>
        <b>{label}</b>
      </button>)}
    </nav>
    {updateToast}
  </div>
}

export function StaffAppShell({ title, companyName, unreadCount, notifications, profile, currentDriver, role, canOpenSettings, signOut, setPage, activePage, sidebarSections, onlineMode, syncState, updateToast, children }) {
  return <div className="app app-with-topbar">
    <AppTopBar
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
    {updateToast}
  </div>
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
            {unreadItems.length ? unreadItems.map((notice) => <button key={notice.id} onClick={() => { setPage('notifications'); setNotificationsOpen(false) }}>
              <strong>{notice.title}</strong>
              {notice.body && <small>{notice.body}</small>}
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
