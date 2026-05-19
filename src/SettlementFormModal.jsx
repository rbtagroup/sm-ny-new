import { useEffect, useMemo, useState } from 'react'
import { formatDate } from './lib/dateTime.js'
import { addNotificationsToData } from './lib/notifications.js'
import {
  computeSettlementMetrics,
  settlementConfigDefaults,
  settlementDefaultInputs,
  settlementForShift,
  validateSettlementInputs,
} from './lib/settlements.js'
import { money, shiftNoticeBody, shiftTypeName } from './lib/display.js'

export function SettlementFormModal({ data, helpers, commit, shift, currentDriver = null, isDriver = false, onClose, ui, services }) {
  const { Field, Modal, ReasonActionModal, SettlementStatusPill, ShiftActionSummary } = ui
  const { uid, makeNotice, adminNotice } = services
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
      settlements: [nextSettlement, ...(prev.settlements || []).filter((item) => item.id !== nextSettlement.id && item.shiftId !== nextSettlement.shiftId)],
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
        <form className="form two-col settlement-form" onSubmit={(event) => event.preventDefault()}>
          <Field label="Řidič"><input value={inputs.driver} onChange={(event) => setValue('driver', event.target.value)} {...fieldProps} /></Field>
          <Field label="Směna"><select value={inputs.shift} onChange={(event) => setValue('shift', event.target.value)} disabled={readOnly}>{Object.entries({ den: 'Denní', noc: 'Noční', odpo: 'Odpolední', pul: '1/2 směna' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
          <Field label="RZ"><input value={inputs.rz} onChange={(event) => setValue('rz', event.target.value)} {...fieldProps} /></Field>
          <Field label="Počáteční km"><input inputMode="decimal" value={inputs.kmStart} onChange={(event) => setValue('kmStart', event.target.value)} {...fieldProps} /></Field>
          <Field label="Konečné km"><input inputMode="decimal" value={inputs.kmEnd} onChange={(event) => setValue('kmEnd', event.target.value)} {...fieldProps} /></Field>
          <Field label="Tržba"><input inputMode="decimal" value={inputs.trzba} onChange={(event) => setValue('trzba', event.target.value)} {...fieldProps} /></Field>
          <Field label="Přístavné"><input inputMode="decimal" value={inputs.pristavne} onChange={(event) => setValue('pristavne', event.target.value)} {...fieldProps} /></Field>
          <Field label="Palivo"><input inputMode="decimal" value={inputs.palivo} onChange={(event) => setValue('palivo', event.target.value)} {...fieldProps} /></Field>
          <Field label="Mytí"><input inputMode="decimal" value={inputs.myti} onChange={(event) => setValue('myti', event.target.value)} {...fieldProps} /></Field>
          <Field label="Kartou"><input inputMode="decimal" value={inputs.kartou} onChange={(event) => setValue('kartou', event.target.value)} {...fieldProps} /></Field>
          <Field label="Fakturou"><input inputMode="decimal" value={inputs.fakturou} onChange={(event) => setValue('fakturou', event.target.value)} {...fieldProps} /></Field>
          <Field label="Jiné náklady"><input inputMode="decimal" value={inputs.jine} onChange={(event) => setValue('jine', event.target.value)} {...fieldProps} /></Field>
          <Field label="Hotovost u sebe"><input inputMode="decimal" value={inputs.cashActual} onChange={(event) => setValue('cashActual', event.target.value)} {...fieldProps} /></Field>
          <Field label="IAC počet"><input inputMode="numeric" value={inputs.iacCount} onChange={(event) => setValue('iacCount', event.target.value)} {...fieldProps} /></Field>
          <Field label="SHKM počet"><input inputMode="numeric" value={inputs.shkmCount} onChange={(event) => setValue('shkmCount', event.target.value)} {...fieldProps} /></Field>
          <Field label="Poznámka" className="span2"><textarea value={inputs.note || ''} onChange={(event) => setValue('note', event.target.value)} {...fieldProps} /></Field>
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
