import { useEffect, useState } from 'react'
import {
  actualDurationMinutes,
  addDays,
  durationLabel,
  formatDate,
  intervalForShift,
  startOfWeek,
  todayISO,
} from './lib/dateTime.js'
import { canOpenSettlement, settlementForShift } from './lib/settlements.js'
import { formatNoticeDate, shiftTypeName } from './lib/display.js'
import { statusMap, weekdayMap } from './lib/appConfig.js'

export function DriverActions({ shift, compact = false, data, actions }) {
  const canConfirm = !['confirmed','completed','cancelled'].includes(shift.status)
  const canDecline = !['declined','completed','cancelled'].includes(shift.status) && !shift.actualStartAt
  const canCheckIn = !shift.actualStartAt && !['declined','cancelled','completed'].includes(shift.status)
  const canCheckOut = Boolean(shift.actualStartAt && !shift.actualEndAt)
  const canSwap = !['cancelled','completed'].includes(shift.status) && !['pending','accepted'].includes(shift.swapRequestStatus)
  const settlement = settlementForShift(data, shift.id)
  const canSettlement = canOpenSettlement(shift) || settlement
  const primaryKind = canCheckOut ? 'checkout' : canCheckIn ? 'checkin' : canSettlement ? 'settlement' : canConfirm ? 'confirm' : ''
  const primaryAction = primaryKind === 'checkout'
    ? <button className="primary driver-primary-action" onClick={() => actions.checkOut(shift.id)}>Ukončit směnu</button>
    : primaryKind === 'checkin'
      ? <button className="primary soft-primary driver-primary-action" onClick={() => actions.checkIn(shift.id)}>Nastoupil jsem</button>
      : primaryKind === 'settlement'
        ? <button className="primary soft-primary driver-primary-action" onClick={() => actions.setSettlementShiftId(shift.id)}>{settlement ? 'Otevřít výčetku' : 'Vyplnit výčetku'}</button>
        : primaryKind === 'confirm'
          ? <button className="primary driver-primary-action" onClick={() => actions.setStatus(shift.id, 'confirmed')}>Potvrdit</button>
          : null
  const secondaryActions = [
    canConfirm && primaryKind !== 'confirm' ? <button className="ghost" onClick={() => actions.setStatus(shift.id, 'confirmed')} key="confirm">Potvrdit</button> : null,
    canSettlement && primaryKind !== 'settlement' ? <button className="ghost" onClick={() => actions.setSettlementShiftId(shift.id)} key="settlement">{settlement ? 'Výčetka' : 'Vyplnit výčetku'}</button> : null,
    canSwap ? <button className="ghost" onClick={() => actions.requestSwap(shift)} key="swap">Nabídnout výměnu</button> : null,
    ['pending','accepted'].includes(shift.swapRequestStatus) ? <button className="danger" onClick={() => actions.cancelSwap(shift)} key="cancelSwap">Zrušit výměnu</button> : null,
    canDecline ? <button className="danger" onClick={() => actions.decline(shift)} key="decline">Odmítnout směnu</button> : null,
  ].filter(Boolean)
  return <div className={compact ? 'driver-actions driver-actions-compact' : 'driver-actions'}>
    {primaryAction}
    {secondaryActions.length > 0 && <details className="driver-more-actions">
      <summary>Další akce</summary>
      <div>{secondaryActions}</div>
    </details>}
  </div>
}

export function ShiftMobileCard({ s, focusCard = false, data, helpers, expandedShiftId, onExpand, actions, ui }) {
  const { ConflictBox, Kpi, SettlementStatusPill, SettlementSummary, StatusPill } = ui
  const isPendingAction = ['assigned', 'draft', 'pending'].includes(s.status)
  const isInProgress = Boolean(s.actualStartAt && !s.actualEndAt) || s.status === 'in_progress'
  const [startAt, endAt] = intervalForShift(s)
  const now = Date.now()
  const isStartWindow = startAt - now <= 60 * 60 * 1000 && endAt >= now
  const showStartPrompt = s.status === 'confirmed' && !s.actualStartAt && now >= startAt - 60 * 60 * 1000 && now <= startAt + 30 * 60 * 1000
  const shouldDefaultFull = focusCard || isPendingAction || isInProgress || isStartWindow || s.status !== 'confirmed'
  const isExpanded = expandedShiftId === s.id
  const compactCard = !shouldDefaultFull && !isExpanded
  const duration = actualDurationMinutes(s)
  const vehicle = helpers.vehicle(s.vehicleId)
  const conflictMessages = helpers.conflictMessages(s).filter((message) => !(message === 'Není vybrané vozidlo.' && !vehicle))
  const settlement = settlementForShift(data, s.id)
  if (compactCard) {
    return <button type="button" className="card driver-shift-card driver-shift-compact-card" onClick={() => onExpand(s.id)}>
      <div className="driver-compact-main">
        <div>
          <span className="driver-compact-title">{formatDate(s.date)} · {shiftTypeName(s)}</span>
          <p className="muted">{vehicle?.name ? `${vehicle.name} · ${vehicle.plate || 'SPZ nezadaná'}` : 'Vozidlo přiřadí dispečer před nástupem.'}</p>
        </div>
        <div className="driver-shift-status-row"><StatusPill status={s.status} helpers={helpers} /><span className="driver-card-toggle" aria-hidden="true">▾</span></div>
      </div>
    </button>
  }
  const canCollapse = !shouldDefaultFull
  return <div className={focusCard ? 'card driver-hero' : 'card driver-shift-card'}>
    <div className="driver-shift-head" style={canCollapse ? { cursor: 'pointer' } : undefined} onClick={canCollapse ? () => onExpand('') : undefined} role={canCollapse ? 'button' : undefined} aria-label={canCollapse ? 'Sbalit směnu' : undefined}><div><span className="driver-date">{formatDate(s.date)}{!conflictMessages.length && <em className="driver-ok-mini">· bez kolize</em>}</span><h3>{s.start}–{s.end}</h3><p className="muted">{vehicle?.name ? `${vehicle.name} · ${vehicle.plate || 'SPZ nezadaná'}` : 'Vozidlo přiřadí dispečer před nástupem.'}</p></div><div className="driver-shift-status-row"><StatusPill status={s.status} helpers={helpers} />{canCollapse && <span className="driver-card-toggle" aria-hidden="true">▴</span>}</div></div>
    {s.instruction && <div className="driver-instruction"><b>Instrukce:</b><br />{s.instruction}</div>}
    {s.note && <p className="muted driver-note">{s.note}</p>}
    {(s.actualStartAt || s.actualEndAt) && <div className="driver-mini-grid">{s.actualStartAt && <Kpi label="Nástup" value={new Date(s.actualStartAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })} hint="zaznamenáno" />}{s.actualEndAt && <Kpi label="Konec" value={new Date(s.actualEndAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })} hint="hotovo" />}{duration != null && <Kpi label="Reál" value={durationLabel(duration)} hint="docházka" />}</div>}
    {showStartPrompt && <div className="driver-info-line">Začněte směnu kliknutím na „Nastoupil jsem".</div>}
    {settlement && <div className="settlement-driver-strip"><SettlementStatusPill settlement={settlement} /><SettlementSummary settlement={settlement} /></div>}
    {conflictMessages.length > 0 && <ConflictBox messages={conflictMessages} />}
    {['pending','accepted'].includes(s.swapRequestStatus) && <div className="alert warn">Žádost o výměnu je odeslaná a čeká na admina.</div>}
    {s.declineReason && <p className="muted">Důvod odmítnutí: {s.declineReason}</p>}
    <DriverActions shift={s} compact={!focusCard} data={data} actions={actions} />
  </div>
}

export function DriverActionModal({ dialog, shift, request, helpers, onClose, onDeclineReasonChange, onSubmitDecline, onConfirmCancelSwap, onConfirmAcceptSwap, onConfirmDeclineSwap, onConfirmOpenShift, ui }) {
  const { Field, Modal } = ui
  if (!dialog || !shift) return null
  const summary = <div className="driver-swap-summary">
    <span>{formatDate(shift.date)}</span>
    <b>{shift.start}–{shift.end}</b>
    <small>{helpers.vehicleName(shift.vehicleId)}</small>
  </div>
  if (dialog.type === 'decline') {
    return <Modal title="Odmítnout směnu" onClose={onClose} className="driver-swap-modal driver-action-modal" backdropClassName="driver-swap-modal-backdrop">
      <form className="stack driver-swap-form" onSubmit={onSubmitDecline}>
        {summary}
        <Field label="Důvod odmítnutí">
          <textarea value={dialog.reason || ''} onChange={(event) => onDeclineReasonChange(event.target.value)} placeholder="Např. kolize, nemoc nebo osobní důvod." />
        </Field>
        <div className="row-actions driver-swap-actions">
          <button className="danger" type="submit">Odmítnout směnu</button>
          <button className="ghost" type="button" onClick={onClose}>Zrušit</button>
        </div>
      </form>
    </Modal>
  }
  const configs = {
    cancelSwap: {
      title: 'Zrušit výměnu',
      body: 'Žádost o výměnu se označí jako zrušená a dispečink dostane upozornění.',
      confirmLabel: 'Zrušit výměnu',
      confirmClass: 'danger',
      onConfirm: onConfirmCancelSwap,
    },
    acceptSwap: {
      title: 'Převzít směnu?',
      body: `Nabízí: ${helpers.driverName(request?.driverId)}. Po potvrzení musí převzetí ještě schválit dispečink.`,
      confirmLabel: 'Chci převzít směnu',
      confirmClass: 'primary',
      onConfirm: onConfirmAcceptSwap,
    },
    declineSwap: {
      title: 'Odmítnout výměnu?',
      body: `Nabízí: ${helpers.driverName(request?.driverId)}. Nabídka se označí jako odmítnutá a kolega i dispečink dostanou upozornění.`,
      confirmLabel: 'Odmítnout',
      confirmClass: 'danger',
      onConfirm: onConfirmDeclineSwap,
    },
    openShift: {
      title: 'Přihlásit se na volnou směnu?',
      body: 'Zájem se odešle dispečinku. Směna bude tvoje až po schválení.',
      confirmLabel: 'Mám zájem',
      confirmClass: 'primary',
      onConfirm: onConfirmOpenShift,
    },
  }
  const config = configs[dialog.type]
  if (!config) return null
  return <Modal title={config.title} onClose={onClose} className="driver-swap-modal driver-action-modal" backdropClassName="driver-swap-modal-backdrop">
    <div className="stack driver-swap-form">
      {summary}
      <p className="driver-action-copy">{config.body}</p>
      {dialog.conflictMessages?.length > 0 && <div className="alert warn"><b>Pozor na kolizi</b><br />{dialog.conflictMessages.map((message, index) => <span key={index}>{message}<br /></span>)}</div>}
      <div className="row-actions driver-swap-actions">
        <button className={config.confirmClass} type="button" onClick={config.onConfirm}>{config.confirmLabel}</button>
        <button className="ghost" type="button" onClick={onClose}>Zpět</button>
      </div>
    </div>
  </Modal>
}

export function DriverTwoWeekCalendar({ shifts, openShifts, helpers }) {
  const [selectedDay, setSelectedDay] = useState('')
  const [calendarOpen, setCalendarOpen] = useState(false)
  const weekStart = startOfWeek(todayISO())
  const dayRows = [0, 7].map((offset) => Array.from({ length: 7 }, (_, i) => addDays(weekStart, offset + i)))
  const modalRows = [0, 7, 14, 21].map((offset) => Array.from({ length: 7 }, (_, i) => addDays(weekStart, offset + i)))
  useEffect(() => {
    if (!calendarOpen) return undefined
    const onKey = (event) => { if (event.key === 'Escape') setCalendarOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [calendarOpen])
  const dotPriority = { conflict: 0, waiting: 1, open: 2, confirmed: 3 }
  const isWaitingShift = (status) => ['assigned', 'draft', 'pending'].includes(status)
  const shiftHasConflict = (shift) => Boolean(shift.has_conflict || shift.hasConflict || helpers.conflictMessages(shift).length)
  const dotTypeForShift = (shift) => {
    if (shiftHasConflict(shift)) return 'conflict'
    if (isWaitingShift(shift.status)) return 'waiting'
    if (['confirmed', 'in_progress', 'completed'].includes(shift.status)) return 'confirmed'
    return null
  }
  const dayItems = (day) => [
    ...shifts.filter((s) => s.date === day).map((s) => {
      const type = dotTypeForShift(s)
      return type ? { type, label: `${shiftTypeName(s)} · ${s.start}–${s.end} · ${helpers.vehicleName(s.vehicleId)} · ${statusMap[s.status] || s.status}` } : null
    }).filter(Boolean),
    ...openShifts.filter((s) => s.date === day).map((s) => ({ type: 'open', label: `${shiftTypeName(s)} · ${s.start}–${s.end} · ${helpers.vehicleName(s.vehicleId)} · volná směna` })),
  ].sort((a, b) => dotPriority[a.type] - dotPriority[b.type])
  const weekLabel = (index) => index === 0 ? 'Tento týden' : (index === 1 ? 'Příští týden' : `Týden ${index + 1}`)
  const Dot = ({ type }) => <span className={`driver-cal-dot ${type}`} aria-hidden="true"></span>
  const DotList = ({ items }) => {
    const visible = items.slice(0, 3)
    const extra = items.length - visible.length
    return <small>{visible.map((item, index) => <Dot key={`${item.type}-${index}`} type={item.type} />)}{extra > 0 && <span className="driver-cal-more">+{extra}</span>}</small>
  }
  const viewHasConflict = (rows) => rows.some((days) => days.some((day) => dayItems(day).some((x) => x.type === 'conflict')))
  const CalendarLegend = ({ showConflict }) => <div className="driver-calendar-legend">
    <span><Dot type="confirmed" />potvrzená</span><span><Dot type="open" />volná</span><span><Dot type="waiting" />čeká</span>{showConflict && <span><Dot type="conflict" />kolize</span>}
  </div>
  const WeekRow = ({ days, index, interactive = true }) => <div className="driver-week-block">
    <div className="driver-week-title">{weekLabel(index)} <span>{formatDate(days[0])} – {formatDate(days[6])}</span></div>
    <div className="driver-week-grid">{days.map((day) => {
      const items = dayItems(day)
      const className = day === todayISO() ? 'driver-day today' : 'driver-day'
      const content = <><b>{weekdayMap[new Date(day).getDay()]?.slice(0,2)}</b><strong>{Number(day.slice(8,10))}</strong><DotList items={items} /></>
      return interactive
        ? <button key={day} className={className} onClick={() => setSelectedDay(selectedDay === day ? '' : day)}>{content}</button>
        : <div key={day} className={className}>{content}</div>
    })}</div>
  </div>
  return <div className="card driver-calendar-card">
    <div className="section-title"><h3>Kalendář 2 týdny</h3><button type="button" className="pill" onClick={() => setCalendarOpen(true)}>Zobrazit</button></div>
    {dayRows.map((days, rowIndex) => <WeekRow key={rowIndex} days={days} index={rowIndex} />)}
    <CalendarLegend showConflict={viewHasConflict(dayRows)} />
    {selectedDay && <div className="alert good"><b>{formatNoticeDate(selectedDay)}</b><br />{dayItems(selectedDay).length ? dayItems(selectedDay).map((x, i) => <div key={i}>{x.label}</div>) : <span>Bez směn.</span>}</div>}
    {calendarOpen && <div className="modal-backdrop driver-calendar-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCalendarOpen(false) }}>
      <div className="modal-card card driver-calendar-modal" role="dialog" aria-modal="true" aria-label="Kalendář">
        <div className="section-title"><h3>Kalendář</h3><button className="ghost driver-calendar-modal-close" onClick={() => setCalendarOpen(false)} aria-label="Zavřít kalendář">✕</button></div>
        <div className="driver-calendar-modal-body">{modalRows.map((days, rowIndex) => <WeekRow key={rowIndex} days={days} index={rowIndex} interactive={false} />)}</div>
        <CalendarLegend showConflict={viewHasConflict(modalRows)} />
      </div>
    </div>}
  </div>
}
