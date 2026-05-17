import { useRef, useState } from 'react'
import { DriverActionModal, DriverTwoWeekCalendar, ShiftMobileCard } from './DriverWidgets.jsx'
import { addDays, formatDate, intervalForShift, localStamp, todayISO } from './lib/dateTime.js'
import { statusMap } from './lib/appConfig.js'
import { appFriendlyError } from './lib/errors.js'
import { addNotificationsToData } from './lib/notifications.js'
import { notificationInboxState } from './lib/notificationInbox.js'
import {
  canOpenSettlement,
  settlementForShift,
  settlementIsClosed,
  shiftIsInStartWindow,
  shiftNeedsSettlementAction,
} from './lib/settlements.js'
import { shiftNoticeBody, sortByDateTime } from './lib/display.js'

export function DriverHome({ data, helpers, commit, currentDriver, syncState, ui, services }) {
  const { Field, Modal, SettlementFormModal } = ui
  const { uid, makeNotice, adminNotice, appendSwapHistory } = services
  const [expandedShiftId, setExpandedShiftId] = useState('')
  const [settlementShiftId, setSettlementShiftId] = useState('')
  const [swapDraft, setSwapDraft] = useState(null)
  const [actionDialog, setActionDialog] = useState(null)
  const [driverToast, setDriverToast] = useState('')
  const driverToastTimer = useRef(null)
  const hiddenDriverStatuses = new Set(['cancelled', 'declined', 'rejected'])
  const settlementActionCutoff = new Date(`${addDays(todayISO(), -1)}T00:00:00`).getTime()
  const showDriverToast = (message) => {
    setDriverToast(message)
    window.clearTimeout(driverToastTimer.current)
    driverToastTimer.current = window.setTimeout(() => setDriverToast(''), 2600)
  }
  const nowTs = Date.now()
  const driverShiftIsDashboardVisible = (shift) => {
    if (shift.driverId !== currentDriver?.id || hiddenDriverStatuses.has(shift.status)) return false
    const settlement = settlementForShift(data, shift.id)
    if (canOpenSettlement(shift) && settlementIsClosed(settlement)) return false
    const [, endAt] = intervalForShift(shift)
    if (shiftNeedsSettlementAction(shift, settlement)) {
      const actualEndAt = shift.actualEndAt ? new Date(shift.actualEndAt).getTime() : 0
      return Math.max(endAt, actualEndAt) >= settlementActionCutoff
    }
    return shift.date >= todayISO() || endAt >= nowTs
  }
  const shifts = sortByDateTime(data.shifts.filter(driverShiftIsDashboardVisible)).slice(0, 30)
  const openShifts = sortByDateTime((data.shifts || []).filter((s) => s.status === 'open' && !s.driverId && s.date >= todayISO())).slice(0, 30)
  const myOpenInterests = (data.swapRequests || []).filter((r) => r.targetMode === 'open' && r.driverId === currentDriver?.id && ['pending','accepted'].includes(r.status))
  const { visible: visibleNotices, unread: unreadNotices } = notificationInboxState(data, { currentDriver, isDriver: true })
  const swapShift = swapDraft ? data.shifts.find((s) => s.id === swapDraft.shiftId) : null
  const swapColleagues = (data.drivers || []).filter((d) => d.active !== false && d.id !== currentDriver?.id)
  const actionRequest = actionDialog?.requestId ? (data.swapRequests || []).find((r) => r.id === actionDialog.requestId) : null
  const actionShift = actionDialog?.shiftId ? data.shifts.find((s) => s.id === actionDialog.shiftId) : (actionRequest ? data.shifts.find((s) => s.id === actionRequest.shiftId) : null)
  const awaiting = shifts.filter((s) => s.status === 'assigned' || s.status === 'draft' || s.status === 'pending')
  const running = shifts.find((s) => (s.actualStartAt && !s.actualEndAt) || s.status === 'in_progress')
  const settlementActionShift = shifts.find((s) => shiftNeedsSettlementAction(s, settlementForShift(data, s.id)))
  const todayAwaiting = awaiting.find((s) => s.date === todayISO())
  const startWindowShift = shifts.find((s) => shiftIsInStartWindow(s, nowTs))
  const focus = running || settlementActionShift || todayAwaiting || startWindowShift
  const setStatus = (id, status, reason = '', options = {}) => {
    const shift = data.shifts.find((s) => s.id === id)
    const notices = shift ? [adminNotice(`Řidič změnil stav: ${statusMap[status]}`, `${currentDriver?.name || 'Řidič'} · ${shiftNoticeBody(shift, helpers, reason ? `důvod: ${reason}` : '')}`, `driver-${status}`, id)] : []
    commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === id ? { ...s, status, declineReason: reason } : s) }, notices), `${currentDriver?.name || 'Řidič'} změnil stav směny na ${statusMap[status]}.`, options)
  }
  const checkIn = (id) => {
    const shift = data.shifts.find((s) => s.id === id)
    commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === id ? { ...s, actualStartAt: s.actualStartAt || localStamp(), status: s.status === 'assigned' ? 'confirmed' : s.status } : s) }, shift ? adminNotice('Řidič nastoupil na směnu', `${currentDriver?.name || 'Řidič'} · ${shiftNoticeBody(shift, helpers)}`, 'attendance-start', id) : null), `${currentDriver?.name || 'Řidič'} nastoupil na směnu.`)
  }
  const checkOut = (id) => {
    const shift = data.shifts.find((s) => s.id === id)
    commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((s) => s.id === id ? { ...s, actualEndAt: s.actualEndAt || localStamp(), status: 'completed' } : s) }, shift ? adminNotice('Řidič ukončil směnu', `${currentDriver?.name || 'Řidič'} · ${shiftNoticeBody(shift, helpers)}`, 'attendance-end', id) : null), `${currentDriver?.name || 'Řidič'} ukončil směnu.`)
    if (shift) setSettlementShiftId(id)
  }
  const requestSwap = (shift) => {
    setSwapDraft({ shiftId: shift.id, targetDriverId: '', reason: '' })
  }
  const closeSwapModal = () => setSwapDraft(null)
  const submitSwap = (event) => {
    event.preventDefault()
    const shift = data.shifts.find((s) => s.id === swapDraft?.shiftId)
    if (!shift || !currentDriver?.id) {
      closeSwapModal()
      showDriverToast('Směnu se nepodařilo načíst.')
      return
    }
    const colleagues = (data.drivers || []).filter((d) => d.active !== false && d.id !== currentDriver.id)
    const targetDriver = swapDraft?.targetDriverId ? colleagues.find((d) => d.id === swapDraft.targetDriverId) : null
    if (swapDraft?.targetDriverId && !targetDriver) {
      showDriverToast('Vybraný kolega už není dostupný.')
      return
    }
    const reason = String(swapDraft?.reason || '').trim()
    const request = { id: uid('swap'), shiftId: shift.id, driverId: currentDriver?.id, reason, status: 'pending', targetMode: targetDriver ? 'driver' : 'all', targetDriverId: targetDriver?.id || '', acceptedByDriverId: '', acceptedAt: '', createdAt: new Date().toISOString(), history: [{ at: new Date().toISOString(), text: targetDriver ? `Nabídnuto kolegovi ${targetDriver.name}.` : 'Nabídnuto všem kolegům.' }] }
    const targetIds = targetDriver ? [targetDriver.id] : colleagues.map((d) => d.id)
    const notices = targetIds.map((id) => makeNotice({ title: 'Nabídka výměny směny', body: `${currentDriver?.name || 'Kolega'} nabízí: ${shiftNoticeBody(shift, helpers, reason ? `Důvod: ${reason}` : '')}`, targetDriverId: id, type: 'swap-offer', shiftId: shift.id }))
    notices.push(adminNotice('Nová žádost o výměnu směny', `${currentDriver?.name || 'Řidič'} · ${shiftNoticeBody(shift, helpers)}`, 'swap-request', shift.id))
    commit((prev) => addNotificationsToData({ ...prev, swapRequests: [request, ...(prev.swapRequests || [])], shifts: prev.shifts.map((s) => s.id === shift.id ? { ...s, swapRequestStatus: 'pending' } : s) }, notices), `${currentDriver?.name || 'Řidič'} požádal o výměnu směny.`)
    closeSwapModal()
    showDriverToast('Žádost o výměnu odeslána.')
  }
  const cancelSwap = (shift) => {
    const activeReq = (data.swapRequests || []).find((r) => r.shiftId === shift.id && r.driverId === currentDriver?.id && ['pending','accepted'].includes(r.status))
    if (!activeReq) { showDriverToast('Žádost o výměnu už není aktivní.'); return }
    setActionDialog({ type: 'cancelSwap', shiftId: shift.id, requestId: activeReq.id })
  }
  const closeActionDialog = () => setActionDialog(null)
  const confirmCancelSwap = () => {
    const activeReq = (data.swapRequests || []).find((r) => r.id === actionDialog?.requestId && ['pending','accepted'].includes(r.status))
    const shift = data.shifts.find((s) => s.id === actionDialog?.shiftId)
    if (!activeReq || !shift) {
      closeActionDialog()
      showDriverToast('Žádost o výměnu už není aktivní.')
      return
    }
    const notices = [adminNotice('Řidič zrušil žádost o výměnu', `${currentDriver?.name || 'Řidič'} · ${shiftNoticeBody(shift, helpers)}`, 'swap-cancelled', shift.id)]
    commit((prev) => addNotificationsToData({ ...prev, swapRequests: (prev.swapRequests || []).map((r) => r.id === activeReq.id ? appendSwapHistory({ ...r, status: 'cancelled', cancelledAt: new Date().toISOString() }, 'Řidič žádost zrušil.') : r), shifts: prev.shifts.map((s) => s.id === shift.id ? { ...s, swapRequestStatus: 'cancelled' } : s) }, notices), `${currentDriver?.name || 'Řidič'} zrušil žádost o výměnu.`)
    closeActionDialog()
    showDriverToast('Žádost o výměnu zrušena.')
  }
  const incomingSwaps = (data.swapRequests || []).filter((r) => r.status === 'pending' && r.driverId !== currentDriver?.id && (r.targetMode === 'all' || r.targetDriverId === currentDriver?.id))
    .map((r) => ({ request: r, shift: data.shifts.find((s) => s.id === r.shiftId) }))
    .filter((x) => x.shift && x.shift.date >= todayISO())
  const acceptSwap = (request) => {
    const shift = data.shifts.find((s) => s.id === request.shiftId)
    if (!shift) { showDriverToast('Směna už neexistuje.'); return }
    setActionDialog({ type: 'acceptSwap', requestId: request.id })
  }
  const declineSwap = (request) => {
    if (request.targetMode !== 'driver' || request.targetDriverId !== currentDriver?.id) {
      showDriverToast('Tuhle nabídku můžeš buď převzít, nebo ignorovat.')
      return
    }
    const shift = data.shifts.find((s) => s.id === request.shiftId)
    if (!shift) { showDriverToast('Směna už neexistuje.'); return }
    setActionDialog({ type: 'declineSwap', requestId: request.id })
  }
  const confirmAcceptSwap = () => {
    const request = (data.swapRequests || []).find((r) => r.id === actionDialog?.requestId && r.status === 'pending')
    const shift = request ? data.shifts.find((s) => s.id === request.shiftId) : null
    if (!request || !shift) {
      closeActionDialog()
      showDriverToast('Nabídka výměny už není aktivní.')
      return
    }
    const notices = [
      makeNotice({ title: 'Kolega přijal výměnu', body: `${currentDriver?.name || 'Kolega'} přijal: ${shiftNoticeBody(shift, helpers)}`, targetRole: 'admin', type: 'swap-accepted', shiftId: shift.id }),
      makeNotice({ title: 'Kolega přijal tvoji nabídku', body: `${currentDriver?.name || 'Kolega'} chce převzít: ${shiftNoticeBody(shift, helpers)}`, targetDriverId: request.driverId, type: 'swap-accepted', shiftId: shift.id }),
    ]
    commit((prev) => addNotificationsToData({ ...prev, swapRequests: (prev.swapRequests || []).map((r) => r.id === request.id ? appendSwapHistory({ ...r, status: 'accepted', acceptedByDriverId: currentDriver?.id, acceptedAt: new Date().toISOString() }, `${currentDriver?.name || 'Kolega'} chce směnu převzít.`) : r), shifts: prev.shifts.map((s) => s.id === request.shiftId ? { ...s, swapRequestStatus: 'accepted' } : s) }, notices), `${currentDriver?.name || 'Řidič'} přijal nabídku výměny směny.`)
    closeActionDialog()
    showDriverToast('Nabídka přijata, čeká na dispečink.')
  }
  const confirmDeclineSwap = () => {
    const request = (data.swapRequests || []).find((r) => r.id === actionDialog?.requestId && r.status === 'pending' && r.targetMode === 'driver' && r.targetDriverId === currentDriver?.id)
    const shift = request ? data.shifts.find((s) => s.id === request.shiftId) : null
    if (!request || !shift) {
      closeActionDialog()
      showDriverToast('Nabídka výměny už není aktivní.')
      return
    }
    const now = new Date().toISOString()
    const reason = 'Odmítnuto řidičem'
    const notices = [
      makeNotice({ title: 'Kolega odmítl výměnu', body: `${currentDriver?.name || 'Kolega'} odmítl: ${shiftNoticeBody(shift, helpers)}`, targetDriverId: request.driverId, targetRole: 'driver', type: 'swap-rejected', shiftId: shift.id }),
      makeNotice({ title: 'Nabídka výměny odmítnuta', body: `${currentDriver?.name || 'Řidič'} odmítl nabídku od ${helpers.driverName(request.driverId)} · ${shiftNoticeBody(shift, helpers)}`, targetRole: 'admin', type: 'swap-rejected', shiftId: shift.id }),
    ]
    commit((prev) => addNotificationsToData({
      ...prev,
      swapRequests: (prev.swapRequests || []).map((r) => r.id === request.id ? appendSwapHistory({ ...r, status: 'rejected', rejectedReason: reason, resolvedAt: now }, `${currentDriver?.name || 'Kolega'} odmítl nabídku výměny.`) : r),
      shifts: prev.shifts.map((s) => s.id === request.shiftId ? { ...s, swapRequestStatus: 'rejected' } : s),
    }, notices), `${currentDriver?.name || 'Řidič'} odmítl nabídku výměny směny.`, {
      rollbackOnError: true,
      onError: () => showDriverToast('Nepodařilo se odmítnout, zkus to znovu.'),
    })
    closeActionDialog()
    showDriverToast('Nabídka odmítnuta.')
  }
  const applyForOpenShift = (shift) => {
    if (!currentDriver?.id) { showDriverToast('Řidičský profil není propojený.'); return }
    const already = (data.swapRequests || []).find((r) => r.shiftId === shift.id && r.driverId === currentDriver.id && r.targetMode === 'open' && ['pending','accepted'].includes(r.status))
    if (already) { showDriverToast('O tuto volnou směnu už máš projevený zájem.'); return }
    const messages = helpers.conflictMessages({ ...shift, driverId: currentDriver.id, status: 'assigned' })
    setActionDialog({ type: 'openShift', shiftId: shift.id, conflictMessages: messages })
  }
  const confirmOpenShift = () => {
    const shift = data.shifts.find((s) => s.id === actionDialog?.shiftId)
    if (!shift || !currentDriver?.id) {
      closeActionDialog()
      showDriverToast('Volná směna už není dostupná.')
      return
    }
    const already = (data.swapRequests || []).find((r) => r.shiftId === shift.id && r.driverId === currentDriver.id && r.targetMode === 'open' && ['pending','accepted'].includes(r.status))
    if (already) {
      closeActionDialog()
      showDriverToast('O tuto volnou směnu už máš projevený zájem.')
      return
    }
    const request = { id: uid('swap'), shiftId: shift.id, driverId: currentDriver.id, reason: 'Zájem o volnou směnu', status: 'pending', targetMode: 'open', targetDriverId: '', acceptedByDriverId: currentDriver.id, acceptedAt: new Date().toISOString(), createdAt: new Date().toISOString(), history: [{ at: new Date().toISOString(), text: `${currentDriver.name} projevil zájem o volnou směnu.` }] }
    const notices = [
      makeNotice({ title: 'Zájem o volnou směnu', body: `${currentDriver.name} se hlásí na: ${shiftNoticeBody(shift, helpers)}`, targetRole: 'admin', type: 'open-shift-interest', shiftId: shift.id }),
      makeNotice({ title: 'Zájem odeslán', body: `${shiftNoticeBody(shift, helpers)} · čeká na schválení dispečerem`, targetDriverId: currentDriver.id, type: 'open-shift-interest-sent', shiftId: shift.id }),
    ]
    commit((prev) => addNotificationsToData({ ...prev, swapRequests: [request, ...(prev.swapRequests || [])], shifts: prev.shifts.map((s) => s.id === shift.id ? { ...s, swapRequestStatus: 'pending' } : s) }, notices), `${currentDriver.name} projevil zájem o volnou směnu.`)
    closeActionDialog()
    showDriverToast('Zájem o volnou směnu odeslán.')
  }
  const decline = (shift) => {
    setActionDialog({ type: 'decline', shiftId: shift.id, reason: shift.declineReason || '' })
  }
  const submitDecline = (event) => {
    event.preventDefault()
    const shift = data.shifts.find((s) => s.id === actionDialog?.shiftId)
    if (!shift) {
      closeActionDialog()
      showDriverToast('Směna už není dostupná.')
      return
    }
    const reason = String(actionDialog?.reason || '').trim()
    showDriverToast('Směna odmítnuta.')
    closeActionDialog()
    setStatus(shift.id, 'declined', reason || '', {
      rollbackOnError: true,
      onError: () => showDriverToast('Nepodařilo se odmítnout, zkus to znovu.'),
    })
  }
  const scrollToDriverSection = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const quickChips = [
    awaiting.length > 0 ? { key: 'awaiting', label: `⏳ ${awaiting.length} čeká`, kind: 'warn', onClick: () => scrollToDriverSection('driver-awaiting-section') } : null,
    incomingSwaps.length > 0 ? { key: 'swaps', label: `↔ ${incomingSwaps.length} výměny`, kind: 'warn', onClick: () => scrollToDriverSection('driver-incoming-swaps-section') } : null,
  ].filter(Boolean)
  const actions = { setStatus, checkIn, checkOut, setSettlementShiftId, requestSwap, cancelSwap, decline }
  const cardProps = { data, helpers, expandedShiftId, onExpand: setExpandedShiftId, actions, ui }
  const otherShifts = shifts.filter((s) => s.id !== focus?.id)
  const highlightOpenShifts = openShifts.length >= 4
  const settlementShift = data.shifts.find((s) => s.id === settlementShiftId)
  return <div className="driver-view driver-mobile-view driver-priority-view">
    {driverToast && <div className="planner-toast" role="status">{driverToast}</div>}
    {syncState?.saving && <div className="driver-sync-banner saving" role="status">Ukládám změny…</div>}
    {!syncState?.saving && syncState?.error && <div className="driver-sync-banner warn" role="status">{appFriendlyError(syncState.error)}</div>}
    {focus && <div className="driver-section-kicker">Aktuální směna</div>}
    {focus ? <ShiftMobileCard s={focus} focusCard {...cardProps} /> : <div className="empty driver-empty-focus"><b>Teď není potřeba žádná akce</b><br /><span className="muted">Další plánované směny najdeš níže. Aktuální směna se objeví až ve startovacím okně nebo po ukončení bez odeslané výčetky.</span></div>}
    {quickChips.length > 0 && <div className="driver-quick-strip" aria-label="Rychlý přehled">{quickChips.map((chip) => <button key={chip.key} type="button" className={`quick-chip ${chip.kind || ''}`} onClick={chip.onClick}>{chip.label}</button>)}</div>}
    {awaiting.length > 0 && <details id="driver-awaiting-section" className="card collapse-card driver-open-shifts"><summary><span><b>Čeká na potvrzení ({awaiting.length})</b><small>Směny vyžadující reakci</small></span><span className="pill warn">{awaiting.length}</span></summary><div className="collapse-content"><div className="stack">{awaiting.filter((s) => s.id !== focus?.id).map((s) => <ShiftMobileCard s={s} key={s.id} {...cardProps} />)}{awaiting.filter((s) => s.id !== focus?.id).length === 0 && <div className="empty">Aktuální směna je zobrazená nahoře.</div>}</div></div></details>}
    {openShifts.length > 0 && <details id="driver-open-shifts-section" className={`card driver-offers collapse-card driver-open-shifts ${highlightOpenShifts ? 'driver-open-shifts-highlight' : ''}`}><summary><span><b>Zobrazit volné směny ({openShifts.length})</b><small>Nabídky, na které se můžeš přihlásit</small></span><span className="pill warn">{openShifts.length}</span></summary><div className="collapse-content"><div className="stack">{openShifts.map((shift) => { const interested = myOpenInterests.some((r) => r.shiftId === shift.id); return <div className="alert warn" key={shift.id}><b>{formatDate(shift.date)} {shift.start}–{shift.end}</b><br />{helpers.vehicleName(shift.vehicleId)} · {shift.note || 'Volná směna k obsazení'}<br />{shift.instruction && <small>Instrukce: {shift.instruction}</small>}<div className="row-actions" style={{ marginTop: 8 }}>{interested ? <span className="pill good">Zájem odeslán</span> : <button onClick={() => applyForOpenShift(shift)}>Mám zájem</button>}</div></div> })}</div></div></details>}
    {incomingSwaps.length > 0 && <div id="driver-incoming-swaps-section" className="card driver-offers"><div className="section-title"><h3>Nabídnuté výměny pro mě</h3><span className="pill warn">{incomingSwaps.length}</span></div><div className="stack">{incomingSwaps.map(({ request, shift }) => <div className="alert warn" key={request.id}><b>{formatDate(shift.date)} {shift.start}–{shift.end}</b><br />Nabízí: {helpers.driverName(request.driverId)} · {helpers.vehicleName(shift.vehicleId)}<br /><small>{request.reason || 'Bez zprávy'}</small><div className="row-actions" style={{ marginTop: 8 }}><button onClick={() => acceptSwap(request)}>Chci převzít směnu</button>{request.targetMode === 'driver' && request.targetDriverId === currentDriver?.id && <button className="danger" onClick={() => declineSwap(request)}>Odmítnout</button>}</div></div>)}</div></div>}
    <div className="section-title driver-list-title"><h3>Moje další směny</h3><span className="pill">{otherShifts.length}</span></div>
    <div className="driver-card-list">{otherShifts.map((s) => <ShiftMobileCard s={s} key={s.id} {...cardProps} />)}{!otherShifts.length && <div className="empty">Nemáš další plánované směny.</div>}</div>
    <DriverTwoWeekCalendar shifts={shifts} openShifts={openShifts} helpers={helpers} />
    {swapDraft && swapShift && <Modal title="Výměna směny" onClose={closeSwapModal} className="driver-swap-modal" backdropClassName="driver-swap-modal-backdrop">
      <form className="stack driver-swap-form" onSubmit={submitSwap}>
        <div className="driver-swap-summary">
          <span>{formatDate(swapShift.date)}</span>
          <b>{swapShift.start}–{swapShift.end}</b>
          <small>{helpers.vehicleName(swapShift.vehicleId)}</small>
        </div>
        <Field label="Komu nabídnout">
          <select value={swapDraft.targetDriverId} onChange={(event) => setSwapDraft({ ...swapDraft, targetDriverId: event.target.value })}>
            <option value="">Všem kolegům</option>
            {swapColleagues.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
          </select>
        </Field>
        <Field label="Důvod / poznámka">
          <textarea value={swapDraft.reason} onChange={(event) => setSwapDraft({ ...swapDraft, reason: event.target.value })} placeholder="Např. potřebuji volno nebo nabízím výměnu směny." />
        </Field>
        {!swapColleagues.length && <div className="alert warn">Výměna se odešle jen dispečinku, protože není aktivní kolega.</div>}
        <div className="row-actions driver-swap-actions">
          <button className="primary" type="submit">Odeslat výměnu</button>
          <button className="ghost" type="button" onClick={closeSwapModal}>Zrušit</button>
        </div>
      </form>
    </Modal>}
    <DriverActionModal
      dialog={actionDialog}
      shift={actionShift}
      request={actionRequest}
      helpers={helpers}
      onClose={closeActionDialog}
      onDeclineReasonChange={(reason) => setActionDialog((current) => current ? { ...current, reason } : current)}
      onSubmitDecline={submitDecline}
      onConfirmCancelSwap={confirmCancelSwap}
      onConfirmAcceptSwap={confirmAcceptSwap}
      onConfirmDeclineSwap={confirmDeclineSwap}
      onConfirmOpenShift={confirmOpenShift}
      ui={ui}
    />
    {settlementShift && <SettlementFormModal data={data} helpers={helpers} commit={commit} shift={settlementShift} currentDriver={currentDriver} isDriver onClose={() => setSettlementShiftId('')} />}
  </div>
}
