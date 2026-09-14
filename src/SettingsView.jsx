import { useEffect, useMemo, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { formatDateTime } from './lib/dateTime.js'
import {
  buildWeeklyCron,
  cronTimeValue,
  defaultDriverReminderCron,
  humanDriverReminderCron,
  isValidSimpleWeeklyCron,
  parseDriverReminderCron,
  weekdayCronMap,
  weekdayCronOrder,
} from './lib/driverReminderSchedule.js'
import { roleMap } from './lib/appConfig.js'
import { deviceLabelFromUserAgent } from './lib/display.js'
import { appFriendlyError } from './lib/errors.js'
import { showNotice } from './lib/notice.js'
import { backup, exportCSV } from './lib/shiftExports.js'

const operationalNotificationRules = [
  ['Nová směna', 'řidič dostane upozornění po vytvoření nebo přiřazení směny'],
  ['Změna směny', 'řidič dostane upozornění při změně času, auta, instrukcí nebo stavu'],
  ['Výměny směn', 'dispečink vidí žádosti a schvaluje převzetí směny'],
  ['Nástup a konec směny', 'změna se propíše do historie a upozornění dispečinku'],
]

const formFromSettings = (settings = {}) => {
  const cron = settings.driverReminderSchedule || defaultDriverReminderCron
  return {
    companyName: settings.companyName || 'RBSHIFT',
    companyContact: settings.companyContact || '',
    reminderWeekday: String(parseDriverReminderCron(cron).weekday),
    reminderTime: cronTimeValue(cron),
  }
}

export function SettingsView({ title = 'Nastavení', data, helpers, commit, supabase, onlineMode, reloadOnline, profile, version, ui, onOpenTemplates, onOpenNorms }) {
  const { Field, Kpi, PageTitle } = ui
  const storedCron = data.settings?.driverReminderSchedule || defaultDriverReminderCron
  const savedKey = JSON.stringify(formFromSettings(data.settings))
  const [form, setForm] = useState(() => JSON.parse(savedKey))
  const [status, setStatus] = useState('')
  const [pushCleanupStatus, setPushCleanupStatus] = useState('')
  const dirty = JSON.stringify(form) !== savedKey
  // Changes saved elsewhere refresh the form, unless someone is editing it right now.
  const lastSavedKey = useRef(savedKey)
  useEffect(() => {
    if (lastSavedKey.current === savedKey) return
    const previous = lastSavedKey.current
    lastSavedKey.current = savedKey
    setForm((current) => (JSON.stringify(current) === previous ? JSON.parse(savedKey) : current))
  }, [savedKey])

  const pushDiagnostics = useMemo(() => {
    const devices = data.pushSubscriptions || []
    const active = devices.filter((device) => device.active !== false)
    const failed = active.filter((device) => device.lastError || Number(device.deliveryFailures || 0) > 0)
    return {
      total: devices.length,
      active: active.length,
      inactive: devices.length - active.length,
      failed: failed.length,
      lastSeenAt: devices.map((device) => device.lastSeenAt).filter(Boolean).sort().at(-1) || '',
      lastDeliveryAt: devices.map((device) => device.lastDeliveryAt).filter(Boolean).sort().at(-1) || '',
      recentErrors: failed.slice(0, 3),
    }
  }, [data.pushSubscriptions])
  const update = (patch) => {
    setStatus('')
    setForm((current) => ({ ...current, ...patch }))
  }
  const plannedCron = buildWeeklyCron(form.reminderWeekday, form.reminderTime)

  const save = () => {
    const companyName = form.companyName.trim()
    if (!companyName) return showNotice('Vyplňte jméno firmy.')
    if (!form.reminderTime) return showNotice('Vyplňte čas připomínky.')
    const reminderChanged = plannedCron !== storedCron
    const settings = { companyName, companyContact: form.companyContact.trim(), driverReminderSchedule: plannedCron }
    setStatus(onlineMode ? 'Ukládám…' : 'Uloženo.')
    commit((prev) => ({ ...prev, settings: { ...prev.settings, ...settings } }), 'Upraveno nastavení aplikace.', {
      // the reminder job reads the saved settings, so it is rescheduled only after they reach the database
      onSuccess: async () => {
        if (!reminderChanged || !supabase?.rpc) return setStatus('Uloženo.')
        const { error } = await supabase.rpc('refresh_driver_reminder_cron')
        setStatus(error ? `Uloženo, ale připomínku se nepodařilo přeplánovat: ${appFriendlyError(error.message)}` : 'Uloženo. Připomínka poběží v novém čase.')
      },
      onError: (error) => setStatus(`Nepodařilo se uložit: ${appFriendlyError(error?.message || String(error))}`),
    })
  }

  const cleanupInvalidPushSubscriptions = async () => {
    if (!pushDiagnostics.failed) return
    setPushCleanupStatus('Odpojuji zařízení s chybou…')
    if (onlineMode && supabase?.rpc) {
      const { data: result, error } = await supabase.rpc('rb_cleanup_invalid_push_subscriptions', { p_min_failures: 1 })
      if (error) return setPushCleanupStatus(`Zařízení se nepodařilo odpojit: ${appFriendlyError(error.message)}`)
      await reloadOnline?.(true)
      return setPushCleanupStatus(`Odpojeno zařízení: ${Number(result?.deactivated || 0)}.`)
    }
    commit((prev) => ({ ...prev, pushSubscriptions: (prev.pushSubscriptions || []).map((device) => (
      device.active !== false && (device.lastError || Number(device.deliveryFailures || 0) > 0)
        ? { ...device, active: false, lastSeenAt: new Date().toISOString() }
        : device
    )) }), 'Zařízení s chybou doručení byla odpojena.')
    setPushCleanupStatus(`Odpojeno zařízení: ${pushDiagnostics.failed}.`)
  }

  return <>
    <PageTitle title={title} subtitle="Firma, připomínky řidičům a zálohy dat." />
    <div className="settings-grid">
      <section className="card">
        <div className="section-title"><h3>Firma</h3></div>
        <div className="form two-col">
          <Field label="Jméno firmy"><input value={form.companyName} onChange={(event) => update({ companyName: event.target.value })} /></Field>
          <Field label="Kontakt na dispečink"><input value={form.companyContact} onChange={(event) => update({ companyContact: event.target.value })} placeholder="+420 600 000 000" /></Field>
        </div>
      </section>
      <section className="card">
        <div className="section-title"><h3>Připomínka volných směn</h3><span className="pill">{humanDriverReminderCron(plannedCron)}</span></div>
        <p className="muted settings-copy">Aktivní řidiči dostanou upozornění na volné směny v příštích 14 dnech.</p>
        <div className="form two-col">
          <Field label="Den v týdnu"><select value={form.reminderWeekday} onChange={(event) => update({ reminderWeekday: event.target.value })}>{weekdayCronOrder.map((key) => <option key={key} value={key}>{weekdayCronMap[key]}</option>)}</select></Field>
          <Field label="Čas"><input type="time" value={form.reminderTime} onChange={(event) => update({ reminderTime: event.target.value })} /></Field>
        </div>
        {!isValidSimpleWeeklyCron(storedCron) && <div className="alert warn settings-copy">Připomínka má zvláštní nastavení, které tady nejde zobrazit. Uložením ji nastavíte na vybraný den a čas.</div>}
      </section>
      <section className="card">
        <div className="section-title"><h3>Směny</h3></div>
        <p className="muted settings-copy">Časy a názvy směn i počty potřebných řidičů se nastavují na jednom místě.</p>
        <div className="row-actions settings-links">
          {onOpenTemplates && <button type="button" className="ghost" onClick={onOpenTemplates}>Šablony směn</button>}
          {onOpenNorms && <button type="button" className="ghost" onClick={onOpenNorms}>Normy pokrytí</button>}
        </div>
      </section>
      <section className="card">
        <div className="section-title"><h3>Záloha a export</h3></div>
        <div className="settings-exports">
          <button type="button" className="ghost" onClick={() => backup(data)}><Download size={18} strokeWidth={2.2} aria-hidden="true" /><span><b>Stáhnout zálohu dat</b><small>všechna data aplikace v jednom souboru</small></span></button>
          <button type="button" className="ghost" onClick={() => exportCSV(data, helpers)}><Download size={18} strokeWidth={2.2} aria-hidden="true" /><span><b>Export směn do tabulky</b><small>soubor CSV pro Excel</small></span></button>
        </div>
      </section>
      <section className="card settings-wide">
        <div className="section-title"><h3>Upozornění řidičům a dispečinku</h3></div>
        <div className="settings-rules">
          {operationalNotificationRules.map(([rule, description]) => <div className="log" key={rule}><b>{rule}</b><br /><span className="muted">{description}</span></div>)}
        </div>
      </section>
    </div>

    <div className={`settings-savebar ${dirty ? 'is-dirty' : ''}`.trim()} role="status">
      <span>{dirty ? 'Máte neuložené změny.' : (status || 'Všechno je uložené.')}</span>
      {dirty && <button type="button" className="ghost" onClick={() => { setForm(JSON.parse(savedKey)); setStatus('') }}>Zahodit</button>}
      <button type="button" className="primary" onClick={save} disabled={!dirty}>Uložit změny</button>
    </div>

    <details className="card collapse-card settings-diagnostics">
      <summary><span><b>Diagnostika</b><small>technické údaje pro řešení potíží</small></span></summary>
      <div className="collapse-content stack">
        <div className="quick-list about-list">
          <div className="quick-item"><span>Verze</span><strong>v{version}</strong></div>
          <div className="quick-item"><span>Prostředí</span><strong>{onlineMode ? 'Online (Supabase)' : 'Lokální demo'}</strong></div>
          <div className="quick-item"><span>Role</span><strong>{roleMap[profile?.role] || profile?.role || 'Admin'}</strong></div>
          <div className="quick-item"><span>Supabase URL</span><strong className="settings-mono">{import.meta.env.VITE_SUPABASE_URL || (supabase ? 'připojeno' : 'není nastaveno')}</strong></div>
          <div className="quick-item"><span>Cron připomínky</span><strong className="settings-mono">{storedCron}</strong></div>
        </div>
        <div className="grid four">
          <Kpi label="Push zařízení" value={pushDiagnostics.active} hint={`${pushDiagnostics.total} celkem`} kind={pushDiagnostics.active ? 'good' : 'warn'} />
          <Kpi label="Odpojená" value={pushDiagnostics.inactive} hint="neaktivní" kind={pushDiagnostics.inactive ? 'warn' : 'good'} />
          <Kpi label="S chybou" value={pushDiagnostics.failed} hint="aktivní zařízení" kind={pushDiagnostics.failed ? 'bad' : 'good'} />
          <Kpi label="Poslední push" value={pushDiagnostics.lastDeliveryAt ? formatDateTime(pushDiagnostics.lastDeliveryAt) : '—'} hint={pushDiagnostics.lastSeenAt ? `zařízení viděno ${formatDateTime(pushDiagnostics.lastSeenAt)}` : 'bez záznamu'} />
        </div>
        {pushDiagnostics.recentErrors.map((device) => <div className="log" key={device.id}><b>{deviceLabelFromUserAgent(device.platform)}</b><br /><span className="muted">{device.lastError}</span></div>)}
        <div className="row-actions">
          <button className="ghost" type="button" onClick={cleanupInvalidPushSubscriptions} disabled={!pushDiagnostics.failed}>Odpojit zařízení s chybou</button>
        </div>
        {pushCleanupStatus && <div className="alert warn">{pushCleanupStatus}</div>}
      </div>
    </details>
  </>
}
