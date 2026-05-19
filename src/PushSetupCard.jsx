import { useEffect, useState } from 'react'
import { Bell, Check, Trash2 } from 'lucide-react'
import { formatDateTime } from './lib/dateTime.js'
import { appFriendlyError } from './lib/errors.js'
import { addNotificationsToData } from './lib/notifications.js'
import { showBrowserNotification, subscribeDeviceForPush } from './lib/pushClient.js'
import { pushResultLabel } from './lib/pushResultLabel.js'
import { deviceLabelFromUserAgent } from './lib/display.js'

export function PushSetupCard({ data, commit, currentDriver, isDriver, profile, session, ui, services }) {
  const { Kpi, Modal } = ui
  const { uid, makeNotice } = services
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'))
  const [status, setStatus] = useState('')
  const [isStandalone, setIsStandalone] = useState(() => Boolean(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone === true))
  const [currentEndpoint, setCurrentEndpoint] = useState(null)
  const [deviceToRemove, setDeviceToRemove] = useState('')
  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setCurrentEndpoint(''); return }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setCurrentEndpoint(sub?.endpoint || ''))
      .catch(() => setCurrentEndpoint(''))
  }, [permission])

  useEffect(() => {
    const media = window.matchMedia?.('(display-mode: standalone)')
    if (!media) return undefined
    const update = () => setIsStandalone(Boolean(media.matches || window.navigator?.standalone === true))
    update()
    if (media.addEventListener) {
      media.addEventListener('change', update)
      return () => media.removeEventListener('change', update)
    }
    media.addListener?.(update)
    return () => media.removeListener?.(update)
  }, [])

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
      setStatus(appFriendlyError(err?.message || 'Notifikace se nepodařilo povolit.'))
    }
  }

  const test = async () => {
    try {
      const ok = await showBrowserNotification('RBSHIFT test', 'Takhle bude vypadat upozornění na směnu nebo změnu.')
      setPermission('Notification' in window ? Notification.permission : 'unsupported')
      setStatus(ok ? 'Testovací lokální notifikace odeslána.' : 'Notifikace nejsou povolené.')
    } catch (err) { setStatus(appFriendlyError(err?.message || 'Test notifikace selhal.')) }
  }

  const serverTest = async () => {
    const notice = makeNotice({
      title: 'RBSHIFT server push test',
      body: 'Toto je ostrý test přes Vercel backend a uložené zařízení.',
      targetDriverId: isDriver ? currentDriver?.id || '' : '',
      targetRole: isDriver ? 'driver' : (profile?.role || 'admin'),
      type: 'push-test',
    })
    setStatus('Odesílám server push test…')
    commit((prev) => addNotificationsToData(prev, notice), 'Odeslán test serverové push notifikace.', {
      onPushResult: (result) => setStatus(pushResultLabel(result)),
      onSuccess: () => setStatus((current) => current === 'Odesílám server push test…' ? 'Server push test uložen.' : current),
      onError: (err) => setStatus(appFriendlyError(err?.message || String(err))),
    })
    if (!session?.access_token) setStatus(pushResultLabel({ skipped: true, reason: 'missing-auth-token' }))
  }

  const supported = 'serviceWorker' in navigator && 'Notification' in window
  const pushSupported = 'PushManager' in window
  const myDevices = isDriver
    ? (data.pushSubscriptions || []).filter((p) => p.driverId === currentDriver?.id && currentEndpoint !== null && p.endpoint === currentEndpoint)
    : (data.pushSubscriptions || []).filter((p) => p.profileId === profile?.id || p.role === profile?.role)
  const activeDevices = myDevices.filter((p) => p.active !== false)
  const lastPushAt = activeDevices.map((p) => p.lastDeliveryAt).filter(Boolean).sort().at(-1) || ''
  const permissionLabel = ({ granted: 'povoleno', denied: 'blokováno', default: 'čeká na povolení', unsupported: 'nepodporováno' })[permission] || permission
  const driverPushState = !supported
    ? ['Nepodporováno', 'warn']
    : permission === 'denied'
      ? ['Blokováno', 'warn']
      : activeDevices.length
        ? ['Aktivní', 'good']
        : ['Vypnuto', 'warn']
  const isIosLike = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const showIosGuide = (!isDriver || isIosLike) && !isStandalone && activeDevices.length === 0
  const removalDevice = myDevices.find((d) => d.id === deviceToRemove)

  const confirmDeactivateDevice = () => {
    if (!deviceToRemove) return
    commit((prev) => ({ ...prev, pushSubscriptions: (prev.pushSubscriptions || []).map((p) => p.id === deviceToRemove ? { ...p, active: false } : p) }), 'Zařízení bylo odebráno z push notifikací.')
    setDeviceToRemove('')
    setStatus('Zařízení bylo odebráno z push notifikací.')
  }

  return <div className={isDriver ? 'driver-push-panel' : 'card'}>
    <div className={`section-title ${isDriver ? 'driver-push-title' : ''}`.trim()}>
      <div><h3>{isDriver ? 'Upozornění na směny' : 'Push notifikace zařízení'}</h3>{isDriver && <p className="muted">Připomenutí směn, změn a nabídek kolegů na tomto zařízení.</p>}</div>
      <span className={isDriver ? `pill ${driverPushState[1]}` : (permission === 'granted' ? 'pill good' : 'pill warn')}>{isDriver ? driverPushState[0] : permissionLabel}</span>
    </div>
    {!isDriver && <p className="muted">Android podporuje PWA notifikace přímo v Chrome. Na iPhonu musí být aplikace přidaná na plochu a musí běžet jako PWA, jinak iOS běžně nepovolí web push pro stránku otevřenou jen v Safari.</p>}
    {isDriver && <div className="driver-push-status-grid">
      <div><span>Prohlížeč</span><b>{supported && pushSupported ? 'Připravený' : 'Nepodporuje'}</b></div>
      <div><span>Zařízení</span><b>{activeDevices.length ? 'Připojené' : 'Nepřipojené'}</b></div>
      <div><span>Povolení</span><b>{permissionLabel}</b></div>
      <div><span>Poslední push</span><b>{lastPushAt ? formatDateTime(lastPushAt) : '—'}</b></div>
    </div>}
    {!isDriver && <div className="grid three" style={{ margin: '12px 0' }}>
      <Kpi label="Service Worker" value={supported ? 'OK' : 'Ne'} hint="základ PWA" kind={supported ? 'good' : 'bad'} />
      <Kpi label="PushManager" value={pushSupported ? 'OK' : 'Ne'} hint="remote push" kind={pushSupported ? 'good' : 'warn'} />
      <Kpi label="VAPID klíč" value={vapidPublicKey ? 'vyplněn' : 'chybí'} hint="browser subscription" kind={vapidPublicKey ? 'good' : 'warn'} />
    </div>}
    <div className={isDriver ? 'driver-push-actions' : 'actions'} style={isDriver ? undefined : { justifyContent: 'flex-start' }}>
      <button className="primary" onClick={subscribe}>{isDriver && <Bell size={18} strokeWidth={2.3} aria-hidden="true" />}Povolit na tomto zařízení</button>
      <button className="ghost" onClick={test}>{isDriver && <Check size={18} strokeWidth={2.4} aria-hidden="true" />}Otestovat</button>
      {!isDriver && <button className="ghost" onClick={serverTest}>Server push test</button>}
    </div>
    {status && <div className="alert warn" style={{ marginTop: 12 }}>{status}</div>}
    {isDriver && permission === 'denied' && <div className="driver-push-note">Notifikace jsou v prohlížeči blokované. Povol je v nastavení webu a vrať se sem znovu.</div>}
    {showIosGuide && <div className="ios-guide"><b>iPhone postup</b><ol><li>Otevři aplikaci v Safari.</li><li>Dej Sdílet → Přidat na plochu.</li><li>Spusť RBSHIFT z plochy.</li><li>Potom povol notifikace.</li></ol></div>}
    <div className={`device-list ${isDriver ? 'driver-device-list' : ''}`.trim()}>
      <div className="section-title"><h3>{isDriver ? 'Zařízení' : 'Moje zařízení'}</h3><span className={activeDevices.length ? 'pill good' : 'pill warn'}>{activeDevices.length} aktivní</span></div>
      {myDevices.map((d) => <div className="device-row" key={d.id}><div><b>{deviceLabelFromUserAgent(d.platform)}</b><br /><small className="muted">{d.active === false ? 'Vypnuté zařízení' : (d.lastError ? `Chyba: ${d.lastError}` : 'Aktivní push zařízení')}</small>{d.lastDeliveryAt && <><br /><small className="muted">Poslední push: {formatDateTime(d.lastDeliveryAt)}</small></>}</div>{d.active !== false && (isDriver ? <button className="driver-notification-icon-button danger-icon" type="button" onClick={() => setDeviceToRemove(d.id)} aria-label="Odebrat zařízení" title="Odebrat"><Trash2 size={18} strokeWidth={2.2} aria-hidden="true" /></button> : <button className="danger" onClick={() => setDeviceToRemove(d.id)}>Odebrat</button>)}</div>)}
      {!myDevices.length && <div className={`empty ${isDriver ? 'driver-empty-inbox' : ''}`.trim()}>{isDriver ? 'Toto zařízení zatím není připojené.' : 'Na tomto účtu zatím není uložené žádné zařízení.'}</div>}
    </div>
    <p className="hintline">{isDriver ? 'Upozornění chodí jen na zařízení, kde je aplikace povolená.' : 'Notifikace dostanete na všechna zařízení, kde je app aktivní.'}</p>
    {deviceToRemove && <Modal title="Odebrat zařízení" onClose={() => setDeviceToRemove('')} className="driver-swap-modal driver-action-modal" backdropClassName="driver-swap-modal-backdrop">
      <div className="stack driver-swap-form">
        <p className="driver-action-copy">Toto zařízení přestane dostávat push notifikace pro tento účet.</p>
        {removalDevice && <div className="driver-swap-summary"><span>Zařízení</span><b>{deviceLabelFromUserAgent(removalDevice.platform)}</b><small>{removalDevice.endpoint ? 'Push endpoint uložený' : 'Bez endpointu'}</small></div>}
        <div className="row-actions driver-swap-actions">
          <button className="danger" type="button" onClick={confirmDeactivateDevice}>Odebrat zařízení</button>
          <button className="ghost" type="button" onClick={() => setDeviceToRemove('')}>Zpět</button>
        </div>
      </div>
    </Modal>}
  </div>
}
