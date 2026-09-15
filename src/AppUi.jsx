import { Children, cloneElement, isValidElement, useEffect, useId, useState } from 'react'
import { ArrowLeftRight, Ban, CheckCheck, CircleCheck, CircleX, Hourglass, PencilLine, TriangleAlert, Undo2, UserPlus, X } from 'lucide-react'
import { formatDate } from './lib/dateTime.js'
import { NOTICE_EVENT } from './lib/notice.js'
import { money } from './lib/display.js'
import { computeSettlementMetrics } from './lib/settlements.js'
import {
  settlementStatusMap,
  settlementToneMap,
  statusLegend,
  statusMap,
  statusToneMap,
} from './lib/appConfig.js'

export function PageTitle({ title, subtitle, children }) {
  return <div className="topbar"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{children && <div className="actions">{children}</div>}</div>
}

export function Kpi({ label, value, hint, kind = '' }) {
  return <div className="card kpi"><div className="label">{label}</div><div className="value">{value}</div>{hint && <div className={`hint ${kind}`}>{hint}</div>}</div>
}

// The icon that goes with each tone, so a status reads by shape as well as by color.
export const toneIcons = {
  draft: PencilLine,
  pending: Hourglass,
  open: UserPlus,
  confirmed: CircleCheck,
  done: CheckCheck,
  declined: CircleX,
  cancelled: Ban,
  swap: ArrowLeftRight,
  problem: TriangleAlert,
}

export function ToneIcon({ tone, size = 14 }) {
  const Icon = toneIcons[tone]
  return Icon ? <Icon size={size} strokeWidth={2.3} aria-hidden="true" /> : null
}

export function TonePill({ tone, children, className = '' }) {
  return <span className={`pill tone-pill tone-${tone} ${className}`.trim()}><ToneIcon tone={tone} size={13} />{children}</span>
}

export function StatusPill({ status }) {
  return <TonePill tone={statusToneMap[status] || 'pending'}>{statusMap[status] || status}</TonePill>
}

// What the colors and icons of shift statuses mean; `tones` picks the ones a screen can show.
export function StatusLegend({ tones = null, className = '' }) {
  const items = tones ? statusLegend.filter(([tone]) => tones.includes(tone)) : statusLegend
  return <ul className={`status-legend ${className}`.trim()} aria-label="Legenda stavů">
    {items.map(([tone, label]) => <li key={tone} className={`tone-${tone}`}><ToneIcon tone={tone} size={13} />{label}</li>)}
  </ul>
}

const labelableTags = new Set(['input', 'select', 'textarea'])

// Popisek propojí s jediným formulářovým prvkem, aby ho četla čtečka a klepnutí na popisek aktivovalo pole.
export function Field({ label, children, className = '' }) {
  const generatedId = useId()
  const child = Children.count(children) === 1 && isValidElement(children) ? children : null
  const linkable = Boolean(child && (labelableTags.has(child.type) || child.type === Select))
  const controlId = linkable ? (child.props.id || generatedId) : undefined
  return <div className={`field ${className}`}><label htmlFor={controlId}>{label}</label>{linkable ? cloneElement(child, { id: controlId }) : children}</div>
}

export function Select({ id, value, onChange, options }) {
  return <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>{Object.entries(options).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
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

export function ConfirmActionModal({ title, message, warning, children, confirmLabel = 'Potvrdit', confirmClass = 'primary', confirmDisabled = false, onConfirm, onClose }) {
  return <Modal title={title} onClose={onClose} className="action-modal">
    <div className="stack action-modal-body">
      {message && <p className="action-modal-copy">{message}</p>}
      {warning && <div className="alert warn">{warning}</div>}
      {children}
      <div className="row-actions action-modal-actions">
        <button className={confirmClass} type="button" onClick={onConfirm} disabled={confirmDisabled}>{confirmLabel}</button>
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
    // Escape belongs to a dialog opened from the drawer (it would lose e.g. a typed reason), not to the drawer under it.
    const onKeyDown = (event) => { if (event.key === 'Escape' && !document.querySelector('.modal-backdrop')) onClose?.() }
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
  return <div className="stack">{messages?.length ? messages.map((message, index) => <div key={index} className="alert bad">{message}</div>) : <div className="alert good">Bez problémů.</div>}</div>
}

export function SettlementStatusPill({ settlement }) {
  const status = settlement?.status || 'missing'
  return <TonePill tone={settlementToneMap[status] || 'pending'}>{status === 'missing' ? 'Bez výčetky' : settlementStatusMap[status] || status}</TonePill>
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

export function NoticeToast() {
  const [notice, setNotice] = useState(null)
  useEffect(() => {
    const onNotice = (event) => setNotice(event.detail)
    window.addEventListener(NOTICE_EVENT, onNotice)
    return () => window.removeEventListener(NOTICE_EVENT, onNotice)
  }, [])
  useEffect(() => {
    if (!notice) return undefined
    // a change that can be taken back stays on screen long enough to reach "Vrátit zpět"
    const timer = setTimeout(() => setNotice(null), notice.undo ? 9000 : notice.tone === 'good' ? 3200 : 6500)
    return () => clearTimeout(timer)
  }, [notice])
  if (!notice) return null
  const undo = () => {
    setNotice(null)
    notice.undo()
  }
  return <div className={`app-notice ${notice.tone}`} role={notice.tone === 'good' ? 'status' : 'alert'}>
    <span>{notice.message}</span>
    {notice.undo && <button type="button" className="app-notice-undo" onClick={undo}><Undo2 size={16} strokeWidth={2.4} aria-hidden="true" />Vrátit zpět</button>}
    <button type="button" className="app-notice-close" aria-label="Zavřít upozornění" onClick={() => setNotice(null)}><X size={18} strokeWidth={2.4} aria-hidden="true" /></button>
  </div>
}
