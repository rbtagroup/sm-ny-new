import { useEffect, useMemo, useState } from 'react'
import { formatDateTime } from './lib/dateTime.js'
import {
  buildWeeklyCron,
  cronTimeValue,
  defaultDriverReminderCron,
  humanDriverReminderCron,
  isValidSimpleWeeklyCron,
  parseDriverReminderCron,
  weekdayCronMap,
} from './lib/driverReminderSchedule.js'
import { deviceLabelFromUserAgent } from './lib/display.js'
import { appFriendlyError } from './lib/errors.js'
import { configuredShiftTimes } from './lib/shiftTemplates.js'

export function SettingsView({ title = 'Nastavení', data, commit, supabase, onlineMode, reloadOnline, profile, version, ui }) {
  const { Field, Kpi, PageTitle } = ui
  const [name, setName] = useState(data.settings?.companyName || 'RBSHIFT')
  const [contact, setContact] = useState(data.settings?.companyContact || '')
  const [logoUrl, setLogoUrl] = useState(data.settings?.logoUrl || '')
  const [times, setTimes] = useState(configuredShiftTimes(data.settings))
  const currentDriverReminderCron = data.settings?.driverReminderSchedule || defaultDriverReminderCron
  const [driverReminderCron, setDriverReminderCron] = useState(currentDriverReminderCron)
  const [driverReminderWeekday, setDriverReminderWeekday] = useState(parseDriverReminderCron(currentDriverReminderCron).weekday)
  const [driverReminderTime, setDriverReminderTime] = useState(cronTimeValue(currentDriverReminderCron))
  const [driverReminderStatus, setDriverReminderStatus] = useState('')
  const [pushCleanupStatus, setPushCleanupStatus] = useState('')
  const [notificationConfig, setNotificationConfig] = useState(() => ({
    push: data.settings?.notifications?.push !== false,
    email: data.settings?.notifications?.email === true,
    whatsapp: data.settings?.notifications?.whatsapp === true,
  }))
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
  const whatsappConfigured = Boolean(data.settings?.integrations?.whatsappConfigured || import.meta.env.VITE_WHATSAPP_API_URL || import.meta.env.VITE_WHATSAPP_API_KEY)
  const pushDiagnostics = useMemo(() => {
    const devices = data.pushSubscriptions || []
    const active = devices.filter((device) => device.active !== false)
    const failed = active.filter((device) => device.lastError || Number(device.deliveryFailures || 0) > 0)
    const lastSeenAt = devices.map((device) => device.lastSeenAt).filter(Boolean).sort().at(-1) || ''
    const lastDeliveryAt = devices.map((device) => device.lastDeliveryAt).filter(Boolean).sort().at(-1) || ''
    return {
      total: devices.length,
      active: active.length,
      inactive: devices.length - active.length,
      failed: failed.length,
      lastSeenAt,
      lastDeliveryAt,
      recentErrors: failed.slice(0, 3),
    }
  }, [data.pushSubscriptions])
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
        setDriverReminderStatus(`Uloženo, ale cron se nepodařilo obnovit automaticky: ${appFriendlyError(error.message)}`)
        return
      }
      setDriverReminderStatus('Uloženo a cron job byl obnoven.')
      return
    }
    setDriverReminderStatus('Uloženo lokálně. Cron obnov v Supabase SQL: select public.refresh_driver_reminder_cron();')
  }
  const requestWhatsappReset = () => commit((prev) => ({ ...prev, settings: { ...prev.settings, integrations: { ...(prev.settings?.integrations || {}), whatsappConfigured: false, whatsappKeyResetRequestedAt: new Date().toISOString() } } }), 'Vyžádán reset WhatsApp integrace.')
  const cleanupInvalidPushSubscriptions = async () => {
    if (!pushDiagnostics.failed) return
    setPushCleanupStatus('Odpojuji chybová push zařízení…')
    if (onlineMode && supabase?.rpc) {
      const { data: result, error } = await supabase.rpc('rb_cleanup_invalid_push_subscriptions', { p_min_failures: 1 })
      if (error) {
        setPushCleanupStatus(`Nepodařilo se odpojit chybová zařízení: ${appFriendlyError(error.message)}`)
        return
      }
      await reloadOnline?.(true)
      setPushCleanupStatus(`Odpojeno ${Number(result?.deactivated || 0)} chybových zařízení.`)
      return
    }
    commit((prev) => ({ ...prev, pushSubscriptions: (prev.pushSubscriptions || []).map((device) => (
      device.active !== false && (device.lastError || Number(device.deliveryFailures || 0) > 0)
        ? { ...device, active: false, lastSeenAt: new Date().toISOString() }
        : device
    )) }), 'Chybová push zařízení byla odpojena.')
    setPushCleanupStatus(`Odpojeno ${pushDiagnostics.failed} chybových zařízení lokálně.`)
  }
  return <><PageTitle title={title} />
    <div className="grid two">
      <div className="card">
        <div className="section-title"><h3>Obecné</h3></div>
        <div className="form two-col">
          <Field label="Jméno firmy"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Kontakt"><input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="+420 600 000 000" /></Field>
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
        <div className="grid four" style={{ marginTop: 14 }}>
          <Kpi label="Zařízení" value={pushDiagnostics.active} hint={`${pushDiagnostics.total} celkem`} kind={pushDiagnostics.active ? 'good' : 'warn'} />
          <Kpi label="Neaktivní" value={pushDiagnostics.inactive} hint="odpojená" kind={pushDiagnostics.inactive ? 'warn' : 'good'} />
          <Kpi label="Chyby" value={pushDiagnostics.failed} hint="aktivní zařízení" kind={pushDiagnostics.failed ? 'bad' : 'good'} />
          <Kpi label="Poslední push" value={pushDiagnostics.lastDeliveryAt ? formatDateTime(pushDiagnostics.lastDeliveryAt) : '—'} hint={pushDiagnostics.lastSeenAt ? `seen ${formatDateTime(pushDiagnostics.lastSeenAt)}` : 'bez záznamu'} />
        </div>
        {pushDiagnostics.recentErrors.length > 0 && <div className="stack" style={{ marginTop: 12 }}>
          {pushDiagnostics.recentErrors.map((device) => <div className="log" key={device.id}><b>{deviceLabelFromUserAgent(device.platform)}</b><br /><span className="muted">{device.lastError}</span></div>)}
        </div>}
        <div className="actions" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
          <button className="ghost" type="button" onClick={cleanupInvalidPushSubscriptions} disabled={!pushDiagnostics.failed}>Odpojit chybová zařízení</button>
        </div>
        {pushCleanupStatus && <div className="alert warn" style={{ marginTop: 12 }}>{pushCleanupStatus}</div>}
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
        <div className="section-title"><h3>O aplikaci</h3><span className="pill">v{version}</span></div>
        <div className="grid four">
          <Kpi label="Verze" value={`v${version}`} hint="aktuální build" />
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
