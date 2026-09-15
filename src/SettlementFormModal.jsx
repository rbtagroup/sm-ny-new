import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDate } from './lib/dateTime.js'
import { addNotificationsToData } from './lib/notifications.js'
import {
  computeSettlementMetrics,
  settlementConfigDefaults,
  settlementDefaultInputs,
  settlementFieldErrors,
  settlementForShift,
} from './lib/settlements.js'
import { money, shiftNoticeBody, shiftTypeName } from './lib/display.js'
import { showNotice } from './lib/notice.js'

const km = (value) => `${Math.round(Number(value) || 0).toLocaleString('cs-CZ')} km`
const signedMoney = (value) => `${value > 0 ? '+' : ''}${money(value)}`
const shiftCodes = [['den', 'Denní'], ['noc', 'Noční'], ['odpo', 'Odpolední'], ['pul', '1/2 směna']]

// The form in the order a driver fills it after a shift; each group shows its own subtotal.
const fieldGroups = [
  { key: 'km', title: 'Kilometry', total: (m) => `najeto ${km(m.kmReal)}`, fields: [['kmStart', 'Tachometr na začátku', 'km', 'decimal'], ['kmEnd', 'Tachometr na konci', 'km', 'decimal']] },
  { key: 'revenue', title: 'Tržba', total: (m) => `čistá tržba ${money(m.netto)}`, fields: [['trzba', 'Tržba celkem', 'Kč', 'decimal'], ['pristavne', 'Přístavné', 'Kč', 'decimal'], ['kartou', 'Z toho kartou', 'Kč', 'decimal'], ['fakturou', 'Z toho na fakturu', 'Kč', 'decimal']] },
  { key: 'costs', title: 'Náklady', total: (m) => `celkem ${money(m.costs)}`, fields: [['palivo', 'Palivo', 'Kč', 'decimal'], ['myti', 'Mytí', 'Kč', 'decimal'], ['jine', 'Jiné náklady', 'Kč', 'decimal']] },
  { key: 'rides', title: 'Počty jízd', total: (m) => `smluvní ${km(m.invoiceKm)}`, fields: [['iacCount', 'Jízdy IAC', 'jízd', 'numeric'], ['shkmCount', 'Jízdy SHKM', 'jízd', 'numeric']] },
  { key: 'cash', title: 'Hotovost', total: (m) => (m.hasCashActual ? `rozdíl ${signedMoney(m.cashDiff)}` : 'nepovinné'), fields: [['cashActual', 'Hotovost u sebe', 'Kč', 'decimal']] },
]

export function SettlementFormModal({ data, helpers, commit, shift, currentDriver = null, isDriver = false, onClose, ui, services }) {
  const { Modal, ReasonActionModal, SettlementStatusPill, ShiftActionSummary } = ui
  const { uid, makeNotice, adminNotice } = services
  const existing = settlementForShift(data, shift?.id)
  const [inputs, setInputs] = useState(() => settlementDefaultInputs(shift, data, helpers, existing?.inputs))
  const [config] = useState(() => ({ ...settlementConfigDefaults, ...(existing?.config || {}) }))
  const [saving, setSaving] = useState(false)
  const [returnDialogOpen, setReturnDialogOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  // Errors appear once the user tries to send or approve, not while the form is still empty.
  const [showErrors, setShowErrors] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const formRef = useRef(null)
  const readOnly = existing?.status === 'approved' || (isDriver && existing?.status === 'submitted')
  const metrics = useMemo(() => computeSettlementMetrics(inputs, config), [inputs, config])
  const fieldErrors = useMemo(() => settlementFieldErrors(inputs, config), [inputs, config])
  const errors = Object.values(fieldErrors)

  useEffect(() => setInputs(settlementDefaultInputs(shift, data, helpers, existing?.inputs)), [shift?.id, existing?.id])

  const setValue = (key, value) => setInputs((prev) => ({ ...prev, [key]: value }))
  // Leads to the first field that needs fixing instead of only naming the problem.
  const pointAtErrors = () => {
    setShowErrors(true)
    const field = formRef.current?.querySelector(`[name="${Object.keys(fieldErrors)[0]}"]`)
    field?.focus({ preventScroll: true })
    field?.scrollIntoView({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  const upsertSettlement = (status, returnedReason = '') => {
    if (!shift?.id) return
    if (['submitted', 'approved'].includes(status) && errors.length) return pointAtErrors()
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
    if (status === 'draft') showNotice('Rozpracovaná výčetka je uložená.', { tone: 'good' })
    if (status !== 'draft') onClose?.()
  }
  const review = () => (errors.length ? pointAtErrors() : setReviewing(true))
  const returnSettlement = () => {
    setReturnReason(existing?.returnedReason || '')
    setReturnDialogOpen(true)
  }
  const driverCanEdit = isDriver && !readOnly
  const staffCanEdit = !isDriver && existing?.status !== 'approved'

  return <>
    <Modal title="Výčetka" onClose={onClose} className="settlement-modal" backdropClassName="settlement-modal-backdrop">
      <div className="settlement-modal-head">
        <div>
          <b>{formatDate(shift.date)} · {shift.start}–{shift.end}</b>
          <span>{inputs.driver || helpers.driverName(shift.driverId)} · {inputs.rz || 'SPZ nezadaná'} · {shiftTypeName(shift)}</span>
        </div>
        <SettlementStatusPill settlement={existing} />
      </div>
      {existing?.returnedReason && <div className="alert warn"><b>Vráceno k opravě:</b><br />{existing.returnedReason}</div>}
      {readOnly && isDriver && existing?.status === 'submitted' && <div className="alert good">Výčetka je odeslaná a čeká na schválení dispečerem.</div>}

      {reviewing ? <div className="settlement-review">
        <h4>Zkontroluj výčetku před odesláním</h4>
        <dl className="settlement-review-list">
          <div><dt>Najeto</dt><dd>{km(metrics.kmReal)}</dd></div>
          <div><dt>Tržba</dt><dd>{money(metrics.trzba)}</dd></div>
          {metrics.pristavne > 0 && <div><dt>Přístavné</dt><dd>{money(metrics.pristavne)}</dd></div>}
          {metrics.nonCash > 0 && <div><dt>Kartou a na fakturu</dt><dd>{money(metrics.nonCash)}</dd></div>}
          {metrics.costs > 0 && <div><dt>Náklady</dt><dd>{money(metrics.costs)}</dd></div>}
          {metrics.invoiceKm > 0 && <div><dt>Smluvní jízdy</dt><dd>{km(metrics.invoiceKm)}</dd></div>}
          <div><dt>Výplata</dt><dd>{money(metrics.vyplata)} <small>{metrics.payoutMode}</small></dd></div>
          {metrics.doplatek > 0 && <div className="is-warn"><dt>Doplatek</dt><dd>{money(metrics.doplatek)}</dd></div>}
          {metrics.hasCashActual && <div><dt>Hotovost rozdíl</dt><dd>{signedMoney(metrics.cashDiff)}</dd></div>}
          {inputs.note && <div><dt>Poznámka</dt><dd>{inputs.note}</dd></div>}
        </dl>
        <div className="settlement-hero-result"><span>K odevzdání</span><b>{money(metrics.settlement)}</b></div>
        <div className="settlement-review-actions">
          <button className="primary" type="button" onClick={() => upsertSettlement('submitted')} disabled={saving}>{saving ? 'Odesílám…' : 'Odeslat ke schválení'}</button>
          <button className="ghost" type="button" onClick={() => setReviewing(false)}>Zpět k úpravám</button>
        </div>
      </div> : <div className="settlement-layout">
        <form ref={formRef} className="settlement-form" onSubmit={(event) => { event.preventDefault(); if (driverCanEdit) review() }}>
          <fieldset className="settlement-group" disabled={readOnly}>
            <legend><span>Směna</span><small>výplata: {metrics.payoutMode}</small></legend>
            <div className="settlement-choice" role="radiogroup" aria-label="Typ směny">
              {shiftCodes.map(([code, label]) => <button type="button" role="radio" key={code} aria-checked={inputs.shift === code} className={inputs.shift === code ? 'active' : ''} onClick={() => setValue('shift', code)}>{label}</button>)}
            </div>
          </fieldset>
          {fieldGroups.map((group) => <fieldset className="settlement-group" key={group.key} disabled={readOnly}>
            <legend><span>{group.title}</span><small>{group.total(metrics)}</small></legend>
            <div className="settlement-fields">
              {group.fields.map(([key, label, unit, inputMode]) => {
                const error = showErrors ? fieldErrors[key] : ''
                return <label className={`settlement-field ${error ? 'has-error' : ''}`.trim()} key={key}>
                  <span>{label}</span>
                  <span className="settlement-input">
                    <input name={key} inputMode={inputMode} enterKeyHint="next" autoComplete="off" value={inputs[key] ?? ''} aria-invalid={Boolean(error)} onChange={(event) => setValue(key, event.target.value)} />
                    <em>{unit}</em>
                  </span>
                  {error && <small className="settlement-field-error">{error}</small>}
                </label>
              })}
            </div>
          </fieldset>)}
          <fieldset className="settlement-group" disabled={readOnly}>
            <legend><span>Poznámka</span></legend>
            <textarea name="note" value={inputs.note || ''} onChange={(event) => setValue('note', event.target.value)} placeholder="Např. dlouhé čekání, porucha nebo výjimka v platbě" aria-label="Poznámka" />
          </fieldset>
        </form>
        <aside className="settlement-result">
          <div className="settlement-hero-result"><span>K odevzdání</span><b>{money(metrics.settlement)}</b><small>{metrics.payoutMode}</small></div>
          <div className="settlement-result-grid">
            <div><span>Výplata</span><b>{money(metrics.vyplata)}</b></div>
            <div><span>Doplatek</span><b className={metrics.doplatek > 0 ? 'is-bad' : ''}>{money(metrics.doplatek)}</b></div>
            <div><span>Čistá tržba</span><b>{money(metrics.netto)}</b></div>
            <div><span>Najeto</span><b>{km(metrics.kmReal)}</b></div>
            <div><span>Smluvní</span><b>{km(metrics.invoiceKm)}</b></div>
            <div><span>Hotovost rozdíl</span><b className={metrics.hasCashActual ? (metrics.cashDiff > 0 ? 'is-good' : metrics.cashDiff < 0 ? 'is-bad' : '') : ''}>{metrics.hasCashActual ? signedMoney(metrics.cashDiff) : '—'}</b></div>
          </div>
          {showErrors && errors.length > 0 && <div className="alert warn" role="alert">{errors[0]}</div>}
        </aside>
      </div>}

      {!reviewing && <div className="settlement-bar">
        <div className="settlement-bar-total"><span>K odevzdání</span><b>{money(metrics.settlement)}</b></div>
        {(driverCanEdit || staffCanEdit) && <div className="settlement-bar-actions">
          {driverCanEdit && <>
            <button className="ghost" type="button" onClick={() => upsertSettlement('draft')} disabled={saving}>Uložit rozpracované</button>
            <button className="primary" type="button" onClick={review} disabled={saving}>Zkontrolovat a odeslat</button>
          </>}
          {staffCanEdit && <>
            <button className="ghost" type="button" onClick={() => upsertSettlement(existing?.status || 'draft')} disabled={saving}>{saving ? 'Ukládám…' : 'Uložit'}</button>
            {existing && <button className="ghost" type="button" onClick={returnSettlement} disabled={saving}>Vrátit k opravě</button>}
            <button className="primary" type="button" onClick={() => upsertSettlement('approved')} disabled={saving}>{saving ? 'Schvaluji…' : 'Schválit'}</button>
          </>}
        </div>}
      </div>}
    </Modal>
    {returnDialogOpen && <ReasonActionModal
      title="Vrátit výčetku k opravě"
      message="Řidič dostane upozornění s důvodem, co má ve výčetce opravit."
      label="Důvod pro řidiče"
      reason={returnReason}
      placeholder="Např. doplň hotovost, oprav kilometry nebo přidej poznámku."
      confirmLabel="Vrátit k opravě"
      confirmClass="primary"
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
