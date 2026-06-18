import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { activeDriverPushDeviceCount, createDriverMessageNotice, driverMessageLimits } from './lib/driverMessages.js'
import { appFriendlyError } from './lib/errors.js'
import { addNotificationsToData } from './lib/notifications.js'
import { pushResultLabel } from './lib/pushResultLabel.js'

export function StaffMessageComposer({ data, commit, session, ui, services }) {
  const { Field } = ui
  const { makeNotice } = services
  const activeDrivers = (data.drivers || []).filter((driver) => driver.active !== false)
  const firstActiveDriverId = activeDrivers[0]?.id || ''
  const [form, setForm] = useState({ targetMode: 'driver_all', targetDriverId: firstActiveDriverId, title: '', body: '' })
  const [status, setStatus] = useState('')
  const [sending, setSending] = useState(false)
  const targetDevices = activeDriverPushDeviceCount(data, form)
  const selectedDriver = activeDrivers.find((driver) => driver.id === form.targetDriverId)
  const targetLabel = form.targetMode === 'driver'
    ? `${selectedDriver?.name || 'Vybraný řidič'} · ${targetDevices} zařízení`
    : `${activeDrivers.length} řidičů · ${targetDevices} zařízení`

  useEffect(() => {
    if (form.targetMode === 'driver' && !form.targetDriverId && firstActiveDriverId) {
      setForm((current) => ({ ...current, targetDriverId: firstActiveDriverId }))
    }
  }, [firstActiveDriverId, form.targetDriverId, form.targetMode])

  const update = (patch) => setForm((current) => ({ ...current, ...patch }))
  const clearMessage = () => setForm((current) => ({ ...current, title: '', body: '' }))
  const submit = (event) => {
    event.preventDefault()
    const { notice, error } = createDriverMessageNotice(makeNotice, form)
    if (error) { setStatus(error); return }

    let receivedPushResult = false
    setSending(true)
    setStatus(session?.access_token ? 'Odesílám zprávu…' : 'Zpráva uložená lokálně. Push notifikace se odesílají v ostrém online režimu.')
    commit((prev) => addNotificationsToData(prev, notice), 'Odeslána zpráva řidičům.', {
      onPushResult: (result) => {
        receivedPushResult = true
        setStatus(pushResultLabel(result))
      },
      onSuccess: () => {
        if (!receivedPushResult) setStatus('Zpráva uložena.')
        clearMessage()
        setSending(false)
      },
      onError: (err) => {
        setStatus(appFriendlyError(err?.message || String(err)))
        setSending(false)
      },
    })
    if (!session?.access_token) {
      clearMessage()
      setSending(false)
    }
  }

  return <div className="card staff-message-composer">
    <div className="section-title">
      <h3>Poslat zprávu řidičům</h3>
      <span className={targetDevices ? 'pill good' : 'pill warn'}>{targetLabel}</span>
    </div>
    <form className="form two-col" onSubmit={submit}>
      <Field label="Příjemce">
        <select value={form.targetMode} onChange={(event) => update({ targetMode: event.target.value })}>
          <option value="driver_all">Všichni řidiči</option>
          <option value="driver">Konkrétní řidič</option>
        </select>
      </Field>
      {form.targetMode === 'driver' && <Field label="Řidič">
        <select value={form.targetDriverId} onChange={(event) => update({ targetDriverId: event.target.value })}>
          <option value="">Vyber řidiče</option>
          {activeDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
        </select>
      </Field>}
      <Field label="Titulek" className="span2">
        <input value={form.title} maxLength={driverMessageLimits.title} onChange={(event) => update({ title: event.target.value })} placeholder="Např. Provozní zpráva" />
      </Field>
      <Field label="Zpráva" className="span2">
        <textarea value={form.body} maxLength={driverMessageLimits.body} onChange={(event) => update({ body: event.target.value })} placeholder="Text, který přijde řidiči do aplikace a jako push notifikace." />
      </Field>
      <div className="field span2 staff-message-actions">
        <button className="primary" type="submit" disabled={sending || !activeDrivers.length}><Bell size={18} strokeWidth={2.3} aria-hidden="true" />{sending ? 'Odesílám…' : 'Odeslat zprávu'}</button>
        <span className="muted">{form.body.length}/{driverMessageLimits.body}</span>
      </div>
    </form>
    {status && <div className="alert warn staff-message-status">{status}</div>}
  </div>
}
