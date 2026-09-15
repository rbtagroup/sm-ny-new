import { PushSetupCard } from './PushSetupCard.jsx'
import { appFriendlyError } from './lib/errors.js'

export function DriverSettings({
  data,
  commit,
  currentDriver,
  profile,
  session,
  onlineMode,
  signOut,
  syncState,
  version,
  ui,
  notificationUi,
  notificationServices,
}) {
  const { PageTitle } = ui

  return <div className="driver-settings-view">
    <PageTitle title="Nastavení" />
    <div className="card"><div className="section-title"><h3>Účet</h3><span className={onlineMode ? 'pill good' : 'pill warn'}>{onlineMode ? 'Online' : 'Demo'}</span></div>
      <div className="driver-account"><b>{currentDriver?.name || profile?.full_name || 'Řidič'}</b><span className="muted">{currentDriver?.email || profile?.email || 'E-mail nezadaný'}</span>{currentDriver?.phone && <span className="muted">{currentDriver.phone}</span>}</div>
    </div>
    <div className="card driver-notification-settings-card"><PushSetupCard data={data} commit={commit} currentDriver={currentDriver} isDriver={true} profile={profile} session={session} ui={notificationUi} services={notificationServices} /></div>
    {syncState?.error && <div className="card"><div className="alert warn">{appFriendlyError(syncState.error)}</div></div>}
    <div className="card"><div className="muted" style={{ fontSize: '0.8em', marginBottom: 8 }}>v{version}</div><button className="ghost" onClick={signOut}>Odhlásit se</button></div>
  </div>
}
