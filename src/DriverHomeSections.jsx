import { ShiftMobileCard } from './DriverWidgets.jsx'
import { formatDate } from './lib/dateTime.js'

export function DriverQuickStrip({ chips }) {
  if (!chips.length) return null

  return <div className="driver-quick-strip" aria-label="Rychlý přehled">
    {chips.map((chip) => <button key={chip.key} type="button" className={`quick-chip ${chip.kind || ''}`} onClick={chip.onClick}>{chip.label}</button>)}
  </div>
}

export function DriverAwaitingSection({ awaiting, focusId, cardProps }) {
  if (!awaiting.length) return null

  const visibleAwaiting = awaiting.filter((shift) => shift.id !== focusId)

  return <details id="driver-awaiting-section" className="card collapse-card driver-open-shifts">
    <summary>
      <span><b>Čeká na potvrzení ({awaiting.length})</b><small>Směny vyžadující reakci</small></span>
      <span className="pill warn">{awaiting.length}</span>
    </summary>
    <div className="collapse-content">
      <div className="stack">
        {visibleAwaiting.map((shift) => <ShiftMobileCard s={shift} key={shift.id} {...cardProps} />)}
        {visibleAwaiting.length === 0 && <div className="empty">Aktuální směna je zobrazená nahoře.</div>}
      </div>
    </div>
  </details>
}

export function DriverOpenShiftsSection({ openShifts, myOpenInterests, helpers, highlighted, onApplyForOpenShift }) {
  if (!openShifts.length) return null

  return <details id="driver-open-shifts-section" className={`card driver-offers collapse-card driver-open-shifts ${highlighted ? 'driver-open-shifts-highlight' : ''}`}>
    <summary>
      <span><b>Zobrazit volné směny ({openShifts.length})</b><small>Nabídky, na které se můžeš přihlásit</small></span>
      <span className="pill warn">{openShifts.length}</span>
    </summary>
    <div className="collapse-content">
      <div className="stack">
        {openShifts.map((shift) => {
          const interested = myOpenInterests.some((request) => request.shiftId === shift.id)

          return <div className="alert warn" key={shift.id}>
            <b>{formatDate(shift.date)} {shift.start}–{shift.end}</b><br />
            {helpers.vehicleName(shift.vehicleId)} · {shift.note || 'Volná směna k obsazení'}<br />
            {shift.instruction && <small>Instrukce: {shift.instruction}</small>}
            <div className="row-actions" style={{ marginTop: 8 }}>
              {interested ? <span className="pill good">Zájem odeslán</span> : <button onClick={() => onApplyForOpenShift(shift)}>Mám zájem</button>}
            </div>
          </div>
        })}
      </div>
    </div>
  </details>
}

export function DriverIncomingSwapsSection({ incomingSwaps, helpers, currentDriverId, onAcceptSwap, onDeclineSwap }) {
  if (!incomingSwaps.length) return null

  return <div id="driver-incoming-swaps-section" className="card driver-offers">
    <div className="section-title">
      <h3>Nabídnuté výměny pro mě</h3>
      <span className="pill warn">{incomingSwaps.length}</span>
    </div>
    <div className="stack">
      {incomingSwaps.map(({ request, shift }) => <div className="alert warn" key={request.id}>
        <b>{formatDate(shift.date)} {shift.start}–{shift.end}</b><br />
        Nabízí: {helpers.driverName(request.driverId)} · {helpers.vehicleName(shift.vehicleId)}<br />
        <small>{request.reason || 'Bez zprávy'}</small>
        <div className="row-actions" style={{ marginTop: 8 }}>
          <button onClick={() => onAcceptSwap(request)}>Chci převzít směnu</button>
          {request.targetMode === 'driver' && request.targetDriverId === currentDriverId && <button className="danger" onClick={() => onDeclineSwap(request)}>Odmítnout</button>}
        </div>
      </div>)}
    </div>
  </div>
}

export function DriverShiftList({ shifts, cardProps }) {
  return <>
    <div className="section-title driver-list-title">
      <h3>Moje další směny</h3>
      <span className="pill">{shifts.length}</span>
    </div>
    <div className="driver-card-list">
      {shifts.map((shift) => <ShiftMobileCard s={shift} key={shift.id} {...cardProps} />)}
      {!shifts.length && <div className="empty">Nemáš další plánované směny.</div>}
    </div>
  </>
}

export function DriverSwapModal({ swapDraft, swapShift, swapColleagues, helpers, ui, onClose, onChange, onSubmit }) {
  const { Field, Modal } = ui
  if (!swapDraft || !swapShift) return null

  return <Modal title="Výměna směny" onClose={onClose} className="driver-swap-modal" backdropClassName="driver-swap-modal-backdrop">
    <form className="stack driver-swap-form" onSubmit={onSubmit}>
      <div className="driver-swap-summary">
        <span>{formatDate(swapShift.date)}</span>
        <b>{swapShift.start}–{swapShift.end}</b>
        <small>{helpers.vehicleName(swapShift.vehicleId)}</small>
      </div>
      <Field label="Komu nabídnout">
        <select value={swapDraft.targetDriverId} onChange={(event) => onChange({ ...swapDraft, targetDriverId: event.target.value })}>
          <option value="">Všem kolegům</option>
          {swapColleagues.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
        </select>
      </Field>
      <Field label="Důvod / poznámka">
        <textarea value={swapDraft.reason} onChange={(event) => onChange({ ...swapDraft, reason: event.target.value })} placeholder="Např. potřebuji volno nebo nabízím výměnu směny." />
      </Field>
      {!swapColleagues.length && <div className="alert warn">Výměna se odešle jen dispečinku, protože není aktivní kolega.</div>}
      <div className="row-actions driver-swap-actions">
        <button className="primary" type="submit">Odeslat výměnu</button>
        <button className="ghost" type="button" onClick={onClose}>Zrušit</button>
      </div>
    </form>
  </Modal>
}
