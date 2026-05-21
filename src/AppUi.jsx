import { useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import { formatDate } from './lib/dateTime.js'
import { money } from './lib/display.js'
import { computeSettlementMetrics } from './lib/settlements.js'
import {
  settlementStatusMap,
  settlementToneMap,
  statusMap,
} from './lib/appConfig.js'

export function PageTitle({ title, subtitle, children }) {
  return <div className="topbar"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{children && <div className="actions">{children}</div>}</div>
}

export function Kpi({ label, value, hint, kind = '' }) {
  return <div className="card kpi"><div className="label">{label}</div><div className="value">{value}</div>{hint && <div className={`hint ${kind}`}>{hint}</div>}</div>
}

export function StatusPill({ status, helpers }) {
  return <span className={`pill ${helpers.statusClass(status)}`}>{statusMap[status] || status}</span>
}

export function Field({ label, children, className = '' }) {
  return <div className={`field ${className}`}><label>{label}</label>{children}</div>
}

export function Select({ value, onChange, options }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)}>{Object.entries(options).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
}

export function DeleteIconButton({ label = 'Odstranit', onClick, className = '' }) {
  return <button className={`danger-mini icon-only ${className}`.trim()} type="button" onClick={onClick} aria-label={label} title={label}><Trash2 size={16} strokeWidth={2.2} aria-hidden="true" /></button>
}

export function Modal({ title, children, onClose, className = '', backdropClassName = '' }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previousHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
      document.documentElement.style.overflow = previousHtmlOverflow
    }
  }, [])
  return <div className={`modal-backdrop ${backdropClassName}`.trim()} role="dialog" aria-modal="true"><div className={`modal-card card ${className}`.trim()}><div className="section-title"><h3>{title}</h3><button className="ghost" onClick={onClose}>Zavřít</button></div>{children}</div></div>
}

export function ActionSummary({ eyebrow, title, meta }) {
  return <div className="action-summary">
    {eyebrow && <span>{eyebrow}</span>}
    {title && <b>{title}</b>}
    {meta && <small>{meta}</small>}
  </div>
}

export function ShiftActionSummary({ shift, helpers }) {
  if (!shift) return null
  return <ActionSummary
    eyebrow="Směna"
    title={`${formatDate(shift.date)} ${shift.start}–${shift.end}`}
    meta={`${helpers.driverName(shift.driverId)} · ${helpers.vehicleName(shift.vehicleId)}`}
  />
}

export function ConfirmActionModal({ title, message, warning, children, confirmLabel = 'Potvrdit', confirmClass = 'primary', onConfirm, onClose }) {
  return <Modal title={title} onClose={onClose} className="action-modal">
    <div className="stack action-modal-body">
      {message && <p className="action-modal-copy">{message}</p>}
      {warning && <div className="alert warn">{warning}</div>}
      {children}
      <div className="row-actions action-modal-actions">
        <button className={confirmClass} type="button" onClick={onConfirm}>{confirmLabel}</button>
        <button className="ghost" type="button" onClick={onClose}>Zpět</button>
      </div>
    </div>
  </Modal>
}

export function ReasonActionModal({ title, message, warning, children, label = 'Důvod', reason, placeholder = '', confirmLabel = 'Potvrdit', confirmClass = 'primary', onReasonChange, onConfirm, onClose }) {
  return <Modal title={title} onClose={onClose} className="action-modal">
    <form className="stack action-modal-body" onSubmit={(event) => { event.preventDefault(); onConfirm?.() }}>
      {message && <p className="action-modal-copy">{message}</p>}
      {warning && <div className="alert warn">{warning}</div>}
      {children}
      <Field label={label}>
        <textarea value={reason || ''} onChange={(event) => onReasonChange?.(event.target.value)} placeholder={placeholder} autoFocus />
      </Field>
      <div className="row-actions action-modal-actions">
        <button className={confirmClass} type="submit">{confirmLabel}</button>
        <button className="ghost" type="button" onClick={onClose}>Zpět</button>
      </div>
    </form>
  </Modal>
}

export function SideDrawer({ title, open, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])
  if (!open) return null
  return <div className="shift-drawer-backdrop" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}>
    <aside className="shift-drawer" onMouseDown={(event) => event.stopPropagation()}>
      <div className="shift-drawer-head"><h3>{title}</h3><button className="ghost" type="button" onClick={onClose}>Zavřít</button></div>
      <div className="shift-drawer-body">{children}</div>
    </aside>
  </div>
}

export function ConflictBox({ messages }) {
  return <div className="stack">{messages?.length ? messages.map((message, index) => <div key={index} className="alert bad">{message}</div>) : <div className="alert good">Bez kolize.</div>}</div>
}

export function SettlementStatusPill({ settlement }) {
  const status = settlement?.status || 'missing'
  if (status === 'missing') return <span className="pill warn">Bez výčetky</span>
  return <span className={`pill ${settlementToneMap[status] || 'warn'}`}>{settlementStatusMap[status] || status}</span>
}

export function SettlementSummary({ settlement }) {
  if (!settlement) return <div className="settlement-summary muted">Výčetka zatím není založená.</div>
  const metrics = settlement.metrics || computeSettlementMetrics(settlement.inputs || {}, settlement.config || {})
  return <div className="settlement-summary">
    <div><span>K odevzdání</span><b>{money(metrics.settlement)}</b></div>
    <div><span>Výplata</span><b>{money(metrics.vyplata)}</b></div>
    <div><span>Km</span><b>{Math.round(metrics.kmReal || 0).toLocaleString('cs-CZ')}</b></div>
  </div>
}

export function SettlementMobileSummary({ settlement }) {
  if (!settlement) return <span className="settlement-list-amount muted">Výčetka chybí</span>
  const metrics = settlement.metrics || computeSettlementMetrics(settlement.inputs || {}, settlement.config || {})
  return <span className="settlement-list-amount">
    <small>K odevzdání</small>
    <b>{money(metrics.settlement)}</b>
    <em>Hotovost {money(metrics.cashDiff)}</em>
  </span>
}
