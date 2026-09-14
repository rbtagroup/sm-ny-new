import { useState } from 'react'
import {
  actualDurationMinutes,
  addDays,
  durationLabel,
  formatDate,
  localStamp,
} from './lib/dateTime.js'
import { addNotificationsToData } from './lib/notifications.js'
import { shiftTypeMap, statusMap } from './lib/appConfig.js'
import { time } from './lib/display.js'
import { czechCount } from './lib/drivers.js'
import { settlementForShift } from './lib/settlements.js'
import { staffActionItems, staffNextStep, staffShiftActions, statusAfterCheckIn } from './lib/shiftActions.js'

const tableActions = ['confirm', 'checkIn', 'checkOut', 'complete', 'duplicate', 'decline', 'cancel', 'delete']

// One main button with the next step for the row; the rest of the fitting actions sit behind "Více".
function rowActions(shift, data) {
  const settlement = settlementForShift(data, shift.id)
  const can = staffShiftActions(shift, { hasSettlement: Boolean(settlement) })
  const items = staffActionItems(shift, can, settlement, tableActions)
  const primary = items.find((item) => item.key === staffNextStep(shift, can, settlement))
  return { primary, rest: items.filter((item) => item !== primary) }
}

function StaffShiftMobileCard({ shift: s, data, helpers, compact, runAction, onOpenDetail, ui }) {
  const { StatusPill } = ui
  const conflicts = helpers.conflictMessages(s)
  const { primary, rest } = rowActions(s, data)
  const attendance = `${s.actualStartAt ? new Date(s.actualStartAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—'} → ${s.actualEndAt ? new Date(s.actualEndAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—'}`

  return <div className={`staff-shift-card status-${s.status}`}>
    <div className="staff-shift-card-head">
      <div>
        <b>{formatDate(s.date)}</b>
        <span>{time(s.start)}–{time(s.end)} · {shiftTypeMap[s.type] || s.type}</span>
      </div>
      <StatusPill status={s.status} helpers={helpers} />
    </div>
    <div className="staff-shift-card-grid">
      <span><small>Řidič</small><b>{helpers.driverName(s.driverId)}</b></span>
      <span><small>Vozidlo</small><b>{helpers.vehicleName(s.vehicleId)}</b></span>
      <span><small>Docházka</small><b>{attendance}</b><em>{durationLabel(actualDurationMinutes(s))}</em></span>
      <span><small>Kontrola</small>{conflicts.length ? <b className="bad-text">{czechCount(conflicts.length, 'kolize', 'kolize', 'kolizí')}</b> : <b className="good-text">OK</b>}</span>
    </div>
    {(s.note || s.instruction || s.declineReason || ['pending','accepted'].includes(s.swapRequestStatus)) && <div className="staff-shift-card-notes">
      {['pending','accepted'].includes(s.swapRequestStatus) && <span className="pill warn">výměna</span>}
      {s.note && <small>{s.note}</small>}
      {s.instruction && <small>Instrukce: {s.instruction}</small>}
      {s.declineReason && <small>Důvod: {s.declineReason}</small>}
    </div>}
    {!compact && (primary || onOpenDetail) && <div className="row-actions staff-shift-card-actions">
      {onOpenDetail && <button type="button" onClick={() => onOpenDetail(s)}>Detail</button>}
      {primary && <button type="button" className="primary" onClick={() => runAction(primary.key, s)}>{primary.label}</button>}
    </div>}
    {!compact && rest.length > 0 && <details className="staff-shift-more-actions">
      <summary>Další akce</summary>
      <div className="staff-shift-more-actions-panel">
        {rest.map((item) => <button type="button" key={item.key} className={item.tone === 'danger' ? 'danger-mini' : undefined} onClick={() => runAction(item.key, s)}>{item.label}</button>)}
      </div>
    </details>}
  </div>
}

export function ShiftTable({ shifts, data, helpers, commit, compact = false, ui, services, onOpenDetail = null }) {
  const { ConfirmActionModal, ReasonActionModal, ShiftActionSummary, StatusPill } = ui
  const { uid, isPastLocked, statusNoticeForShift, cancelShiftData, hardDeleteShiftData } = services
  const [actionDialog, setActionDialog] = useState(null)
  const actionShift = actionDialog?.shift?.id ? (data.shifts.find((s) => s.id === actionDialog.shift.id) || actionDialog.shift) : null
  const closeActionDialog = () => setActionDialog(null)
  const commitStatus = (shift, status, reason = '') => commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === shift.id ? { ...s, status, declineReason: reason } : s) }, statusNoticeForShift({ ...shift, status, declineReason: reason }, status, helpers, reason)), `Změněn stav směny na ${statusMap[status]}.`)
  const requestStatus = (shift, status, reason = '') => {
    if (status === 'declined') {
      setActionDialog({ type: 'decline', shift, status, reason: shift.declineReason || reason || '' })
      return
    }
    if (isPastLocked(shift)) {
      setActionDialog({ type: 'status', shift, status, reason })
      return
    }
    commitStatus(shift, status, reason)
  }
  const confirmStatusAction = () => {
    if (!actionShift || !actionDialog?.status) return
    commitStatus(actionShift, actionDialog.status, actionDialog.reason || '')
    closeActionDialog()
  }
  const duplicate = (shift) => commit((prev) => ({ ...prev, shifts: [{ ...shift, id: uid('sh'), date: addDays(shift.date, 1), status: 'draft', declineReason: '', actualStartAt: '', actualEndAt: '', swapRequestStatus: '' }, ...prev.shifts] }), 'Duplikována směna na další den.')
  const requestCancel = (shift) => setActionDialog({ type: 'cancel', shift, reason: 'Zrušeno dispečerem' })
  const confirmCancel = () => {
    if (!actionShift) return
    const reason = actionDialog?.reason?.trim() || 'Zrušeno dispečerem'
    commit((prev) => cancelShiftData(prev, actionShift, helpers, reason), `Zrušena směna ${formatDate(actionShift.date)} ${actionShift.start}–${actionShift.end}.`)
    closeActionDialog()
  }
  const requestHardDelete = (shift) => setActionDialog({ type: 'hardDelete', shift })
  // Dispatch records attendance itself here, so there is nobody to notify.
  const checkIn = (shift) => commit((prev) => ({ ...prev, shifts: prev.shifts.map((item) => item.id === shift.id ? { ...item, actualStartAt: item.actualStartAt || localStamp(), status: statusAfterCheckIn(item.status) } : item) }), 'V tabulce směn zaznamenán nástup.')
  const checkOut = (shift) => commit((prev) => ({ ...prev, shifts: prev.shifts.map((item) => item.id === shift.id ? { ...item, actualEndAt: item.actualEndAt || localStamp(), status: 'completed' } : item) }), 'V tabulce směn zaznamenáno ukončení.')
  const actionHandlers = {
    confirm: (shift) => requestStatus(shift, 'confirmed'),
    checkIn,
    checkOut,
    complete: (shift) => requestStatus(shift, 'completed'),
    duplicate: (shift) => duplicate(shift),
    decline: (shift) => requestStatus(shift, 'declined'),
    cancel: requestCancel,
    delete: requestHardDelete,
  }
  const runAction = (key, shift) => actionHandlers[key]?.(shift)
  const confirmHardDelete = () => {
    if (!actionShift) return
    commit((prev) => hardDeleteShiftData(prev, actionShift), '')
    closeActionDialog()
  }

  if (!shifts.length) return <div className="empty">Žádné směny k zobrazení.</div>

  return <>
    <div className="table-wrap shift-table-desktop"><table className="table"><thead><tr><th>Datum</th><th>Čas</th><th>Řidič</th><th>Vozidlo</th><th>Stav</th><th>Docházka</th><th>Kontrola</th>{!compact && <th>Akce</th>}</tr></thead><tbody>{shifts.map((s) => {
      const conflicts = helpers.conflictMessages(s)
      const { primary, rest } = rowActions(s, data)
      return <tr key={s.id}><td><b>{formatDate(s.date)}</b></td><td>{time(s.start)}–{time(s.end)}<br /><small>{shiftTypeMap[s.type] || s.type}</small></td><td>{helpers.driverName(s.driverId)}<br /><small>{s.note || 'Bez poznámky'}</small>{s.instruction && <><br /><small>Instrukce: {s.instruction}</small></>}{s.declineReason && <><br /><small>Důvod: {s.declineReason}</small></>}</td><td>{helpers.vehicleName(s.vehicleId)}</td><td><StatusPill status={s.status} helpers={helpers} />{['pending','accepted'].includes(s.swapRequestStatus) && <><br /><span className="pill warn">výměna</span></>}</td><td>{s.actualStartAt ? new Date(s.actualStartAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—'} → {s.actualEndAt ? new Date(s.actualEndAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—'}<br /><small>{durationLabel(actualDurationMinutes(s))}</small></td><td>{conflicts.length ? <span className="pill bad">{czechCount(conflicts.length, 'kolize', 'kolize', 'kolizí')}</span> : <span className="pill good">OK</span>}</td>{!compact && <td><div className="row-actions shift-row-actions">{onOpenDetail && <button type="button" onClick={() => onOpenDetail(s)}>Detail</button>}{primary && <button type="button" className="primary" onClick={() => runAction(primary.key, s)}>{primary.shortLabel}</button>}{rest.length > 0 && <details className="row-more"><summary>Více</summary><div className="row-more-panel">{rest.map((item) => <button type="button" key={item.key} className={item.tone === 'danger' ? 'danger-mini' : undefined} onClick={() => runAction(item.key, s)}>{item.label}</button>)}</div></details>}</div></td>}</tr>
    })}</tbody></table></div>
    <div className="staff-shift-mobile-list">
      {shifts.map((s) => <StaffShiftMobileCard key={s.id} shift={s} data={data} helpers={helpers} compact={compact} runAction={runAction} onOpenDetail={onOpenDetail} ui={ui} />)}
    </div>
    {actionDialog?.type === 'decline' && actionShift && <ReasonActionModal
      title="Odmítnout směnu"
      message="Směna se označí jako odmítnutá a důvod zůstane viditelný v detailu."
      warning={isPastLocked(actionShift) ? 'Tahle směna je v minulosti. Změna ovlivní historii směny.' : ''}
      label="Důvod odmítnutí"
      reason={actionDialog.reason}
      placeholder="Např. kolize, nemoc nebo provozní důvod."
      confirmLabel="Odmítnout směnu"
      confirmClass="danger"
      onReasonChange={(reason) => setActionDialog((current) => current ? { ...current, reason } : current)}
      onClose={closeActionDialog}
      onConfirm={confirmStatusAction}
    >
      <ShiftActionSummary shift={actionShift} helpers={helpers} />
    </ReasonActionModal>}
    {actionDialog?.type === 'status' && actionShift && <ConfirmActionModal
      title="Změnit minulou směnu?"
      message={`Stav směny se změní na „${statusMap[actionDialog.status] || actionDialog.status}”.`}
      warning="Tahle směna je v minulosti. Změna může ovlivnit historii, docházku nebo výčetku."
      confirmLabel="Změnit stav"
      onClose={closeActionDialog}
      onConfirm={confirmStatusAction}
    >
      <ShiftActionSummary shift={actionShift} helpers={helpers} />
    </ConfirmActionModal>}
    {actionDialog?.type === 'cancel' && actionShift && <ReasonActionModal
      title="Zrušit směnu"
      message="Směna se označí jako zrušená a řidič dostane notifikaci s důvodem."
      warning={isPastLocked(actionShift) ? 'Tahle směna je v minulosti. Zrušení ovlivní historii směny.' : ''}
      label="Důvod zrušení pro řidiče"
      reason={actionDialog.reason}
      placeholder="Např. nemoc, provozní změna nebo zrušeno dispečerem."
      confirmLabel="Zrušit směnu"
      confirmClass="danger"
      onReasonChange={(reason) => setActionDialog((current) => current ? { ...current, reason } : current)}
      onClose={closeActionDialog}
      onConfirm={confirmCancel}
    >
      <ShiftActionSummary shift={actionShift} helpers={helpers} />
    </ReasonActionModal>}
    {actionDialog?.type === 'hardDelete' && actionShift && <ConfirmActionModal
      title="Trvale odstranit směnu"
      message="Tahle akce odstraní směnu z databáze, řidičské aplikace, související žádosti o výměnu, notifikace a navázané záznamy historie."
      warning="Řidiči se neposílá žádná další notifikace a akce nejde jednoduše vrátit."
      confirmLabel="Trvale odstranit"
      confirmClass="danger"
      onClose={closeActionDialog}
      onConfirm={confirmHardDelete}
    >
      <ShiftActionSummary shift={actionShift} helpers={helpers} />
    </ConfirmActionModal>}
  </>
}
