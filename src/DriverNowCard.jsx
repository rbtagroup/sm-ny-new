import { useState } from 'react'
import { Bell, CarFront, Clock } from 'lucide-react'
import { formatDate, localDateISO } from './lib/dateTime.js'
import { driverDayLabel, endsInLabel, startsInLabel } from './lib/driverHome.js'
import { driverShiftActions } from './lib/shiftActions.js'
import { usePushDevice } from './usePushDevice.js'

const kickers = { running: 'Směna běží', settlement: 'Zbývá výčetka', checkIn: 'Nástup', confirm: 'Potvrď směnu', next: 'Další směna' }
const clock = (timestamp) => new Date(timestamp).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })

// The top of the driver home: the time, car and countdown of the shift that matters now, with one button for the next step.
export function DriverNowCard({ now, nowTs, today, helpers, actions }) {
  const { kind, shift, settlement } = now
  if (kind === 'idle') return <section className="driver-now kind-idle" aria-label="Co teď">
    <span className="driver-now-kicker">Teď nic nečeká</span>
    <p className="driver-now-copy">Nemáš naplánovanou další směnu. Volné směny a nabídky kolegů najdeš níž.</p>
  </section>

  const vehicle = helpers.vehicle(shift.vehicleId)
  const can = driverShiftActions(shift, { now: nowTs, hasSettlement: Boolean(settlement) })
  const when = kind === 'running' ? endsInLabel(shift, nowTs) : kind === 'settlement' ? 'Směna skončila, zbývá vyplnit výčetku.' : startsInLabel(shift, nowTs, today)
  const primary = {
    running: ['Ukončit směnu', () => actions.requestCheckOut(shift)],
    settlement: [settlement?.status === 'returned' ? 'Opravit výčetku' : settlement ? 'Dokončit výčetku' : 'Vyplnit výčetku', () => actions.setSettlementShiftId(shift.id)],
    checkIn: ['Nastoupil jsem', () => actions.checkIn(shift.id)],
    confirm: ['Potvrdit směnu', () => actions.setStatus(shift.id, 'confirmed')],
  }[kind]
  // 'zítra od 06:00' when check-in opens on another day than today
  const opensDayLabel = (timestamp) => {
    const day = localDateISO(new Date(timestamp))
    if (day === today) return ''
    return day === localDateISO(new Date(nowTs + 86400000)) ? 'zítra ' : `${formatDate(day)} `
  }

  return <section className={`driver-now kind-${kind}`} aria-label="Co teď">
    <span className="driver-now-kicker">{kickers[kind]}</span>
    <div className="driver-now-when">
      <span>{driverDayLabel(shift.date, today)}</span>
      <strong>{shift.start}–{shift.end}</strong>
    </div>
    <p className="driver-now-line is-countdown"><Clock size={17} strokeWidth={2.2} aria-hidden="true" />{when}</p>
    <p className="driver-now-line"><CarFront size={17} strokeWidth={2.2} aria-hidden="true" />{vehicle ? `${vehicle.name} · ${vehicle.plate || 'SPZ nezadaná'}` : 'Vůz přidělí dispečink před nástupem'}</p>
    {shift.note && <p className="driver-now-note">{shift.note}</p>}
    {shift.instruction && <div className="driver-instruction"><b>Instrukce:</b> {shift.instruction}</div>}
    {kind === 'settlement' && settlement?.status === 'returned' && <div className="alert warn">Vráceno k opravě{settlement.returnedReason ? `: ${settlement.returnedReason}` : '.'}</div>}
    {['pending', 'accepted'].includes(shift.swapRequestStatus) && <div className="alert warn">Žádost o výměnu čeká na dispečink.</div>}
    {primary && <button type="button" className={`primary driver-now-action ${kind === 'checkIn' ? 'is-go' : ''}`.trim()} onClick={primary[1]}>{primary[0]}</button>}
    {kind === 'next' && can.checkInOpensAt && <p className="driver-now-hint">Nástup potvrdíš {opensDayLabel(can.checkInOpensAt)}od {clock(can.checkInOpensAt)}.</p>}
    {(can.decline || can.swap || can.cancelSwap) && kind !== 'running' && <div className="driver-now-secondary">
      {can.decline && ['confirm', 'checkIn', 'next'].includes(kind) && <button type="button" className="ghost" onClick={() => actions.decline(shift)}>Nemůžu jet</button>}
      {can.swap && kind === 'next' && <button type="button" className="ghost" onClick={() => actions.requestSwap(shift)}>Nabídnout výměnu</button>}
      {can.cancelSwap && <button type="button" className="ghost" onClick={() => actions.cancelSwap(shift)}>Zrušit výměnu</button>}
    </div>}
  </section>
}

const PROMPT_KEY = 'rbshift-push-prompt-hidden-until'
const PROMPT_PAUSE_MS = 3 * 24 * 60 * 60 * 1000

// Until this device receives notifications, the home offers to switch them on (or explains what stands in the way).
export function DriverPushPrompt({ data, commit, currentDriver, profile, services }) {
  const push = usePushDevice({ data, commit, currentDriver, isDriver: true, profile, services })
  const [hiddenUntil, setHiddenUntil] = useState(() => {
    try { return Number(localStorage.getItem(PROMPT_KEY) || 0) }
    catch { return 0 }
  })
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  if (!push.supported || push.currentEndpoint === null || push.activeDevices.length || Date.now() < hiddenUntil) return null

  const hide = () => {
    const until = Date.now() + PROMPT_PAUSE_MS
    try { localStorage.setItem(PROMPT_KEY, String(until)) }
    catch { /* private mode: the prompt comes back next time */ }
    setHiddenUntil(until)
  }
  const enable = async () => {
    setBusy(true)
    const result = await push.enable()
    setBusy(false)
    if (!result.ok) setStatus(result.message)
  }
  const blocked = push.permission === 'denied'
  const needsHomeScreen = push.isIosLike && !push.isStandalone
  const copy = blocked
    ? 'Upozornění jsou v prohlížeči zakázaná. Povol je v nastavení webu pro tuto aplikaci.'
    : needsHomeScreen
      ? 'Na iPhonu nejdřív přidej aplikaci na plochu (Sdílet → Přidat na plochu) a otevři ji odtamtud.'
      : 'Hned se dozvíš o nové směně, změně času nebo nabídce od kolegy.'

  return <section className="driver-push-prompt" aria-label="Upozornění na směny">
    <span className="driver-push-prompt-icon" aria-hidden="true"><Bell size={22} strokeWidth={2.2} /></span>
    <div className="driver-push-prompt-copy">
      <b>Zapni si upozornění na směny</b>
      <p>{copy}</p>
      {status && <small role="status">{status}</small>}
    </div>
    <div className="driver-push-prompt-actions">
      {!blocked && !needsHomeScreen && <button type="button" className="primary" onClick={enable} disabled={busy}>{busy ? 'Zapínám…' : 'Zapnout'}</button>}
      <button type="button" className="ghost" onClick={hide}>Teď ne</button>
    </div>
  </section>
}
