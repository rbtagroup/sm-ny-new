import { intervalForShift } from './dateTime.js'
import { canOpenSettlement } from './settlements.js'

// Attendance can be recorded from an hour before the shift starts until two hours after its planned end,
// so a driver who forgot to check in can still close the shift and hand in the settlement.
export const CHECK_IN_LEAD_MINUTES = 60
export const CHECK_IN_GRACE_MINUTES = 120

const CLOSED_STATUSES = new Set(['declined', 'cancelled', 'completed'])
export const AWAITING_DRIVER_STATUSES = new Set(['assigned', 'draft', 'pending'])

const leadMs = CHECK_IN_LEAD_MINUTES * 60 * 1000
const graceMs = CHECK_IN_GRACE_MINUTES * 60 * 1000

// Which actions make sense for a driver on their own shift right now.
export function driverShiftActions(shift, { now = Date.now(), hasSettlement = false } = {}) {
  const [startAt, endAt] = intervalForShift(shift)
  const started = Boolean(shift.actualStartAt)
  const closed = CLOSED_STATUSES.has(shift.status)
  const swapActive = ['pending', 'accepted'].includes(shift.swapRequestStatus)
  const beforeCheckIn = !closed && !started && now < startAt - leadMs
  return {
    confirm: AWAITING_DRIVER_STATUSES.has(shift.status) && !started && now <= endAt,
    checkIn: !closed && !started && now >= startAt - leadMs && now <= endAt + graceMs,
    checkInOpensAt: beforeCheckIn ? startAt - leadMs : null,
    checkOut: started && !shift.actualEndAt,
    decline: !closed && !started && now <= endAt,
    swap: !closed && !started && !swapActive && now < startAt,
    cancelSwap: swapActive,
    settlement: canOpenSettlement(shift) || hasSettlement,
  }
}

// Which actions make sense for dispatch on a shift right now.
export function staffShiftActions(shift, { now = Date.now(), hasSettlement = false } = {}) {
  const [startAt, endAt] = intervalForShift(shift)
  const hasDriver = Boolean(shift.driverId)
  const started = Boolean(shift.actualStartAt)
  const closed = CLOSED_STATUSES.has(shift.status)
  return {
    confirm: hasDriver && AWAITING_DRIVER_STATUSES.has(shift.status),
    checkIn: hasDriver && !closed && !started && now >= startAt - leadMs && now <= endAt + graceMs,
    checkOut: started && !shift.actualEndAt,
    complete: hasDriver && !closed && (started || now >= endAt),
    decline: hasDriver && !closed && !started,
    cancel: !['cancelled', 'completed'].includes(shift.status),
    settlement: canOpenSettlement(shift) || hasSettlement,
    messageDriver: hasDriver,
    ended: now >= endAt,
  }
}

// Status a shift gets once attendance starts; waiting shifts are confirmed by showing up.
export const statusAfterCheckIn = (status) => (AWAITING_DRIVER_STATUSES.has(status) ? 'confirmed' : status)

// The one step dispatch most likely wants next. An open shift first needs a driver; after the planned end an
// unstarted shift is usually marked done rather than checked in late.
export function staffNextStep(shift, can, settlement = null) {
  if (!shift.driverId && shift.status === 'open') return 'assign'
  if (shift.status === 'declined') return 'reassign'
  if (can.checkOut) return 'checkOut'
  if (can.checkIn && !can.ended) return 'checkIn'
  if (can.confirm) return 'confirm'
  if (can.settlement && (!settlement || settlement.status === 'submitted')) return 'settlement'
  if (can.complete) return 'complete'
  if (can.checkIn) return 'checkIn'
  return ''
}

const staffActionLabels = {
  assign: ['Přiřadit řidiče', 'Přiřadit'],
  reassign: ['Najít náhradu', 'Náhrada'],
  confirm: ['Potvrdit směnu', 'Potvrdit'],
  checkIn: ['Zaznamenat nástup', 'Nástup'],
  checkOut: ['Zaznamenat konec', 'Konec'],
  complete: ['Označit jako dokončenou', 'Dokončit'],
  decline: ['Odmítnout směnu', 'Odmítnout'],
  cancel: ['Zrušit směnu', 'Zrušit'],
  edit: ['Upravit', 'Upravit'],
  message: ['Kopírovat text pro řidiče', 'Text pro řidiče'],
  duplicate: ['Duplikovat na další den', 'Duplikovat'],
  delete: ['Trvale odstranit', 'Odstranit'],
}

// Every action that fits the shift, in the order it is offered. `available` lists the extra actions a screen supports.
export function staffActionItems(shift, can, settlement = null, available = []) {
  const settlementLabel = settlement ? 'Otevřít výčetku' : 'Založit výčetku'
  const items = [
    !shift.driverId && shift.status === 'open' ? 'assign' : null,
    shift.status === 'declined' ? 'reassign' : null,
    can.confirm ? 'confirm' : null,
    can.checkIn ? 'checkIn' : null,
    can.checkOut ? 'checkOut' : null,
    can.settlement ? 'settlement' : null,
    can.complete ? 'complete' : null,
    'edit',
    can.messageDriver ? 'message' : null,
    'duplicate',
    can.decline ? 'decline' : null,
    can.cancel ? 'cancel' : null,
    'delete',
  ].filter((key) => key && available.includes(key))
  return items.map((key) => ({
    key,
    label: key === 'settlement' ? settlementLabel : staffActionLabels[key][0],
    shortLabel: key === 'settlement' ? 'Výčetka' : staffActionLabels[key][1],
    tone: ['decline', 'cancel', 'delete'].includes(key) ? 'danger' : 'ghost',
  }))
}

const progressSteps = [
  { key: 'assigned', label: 'Obsazeno' },
  { key: 'confirmed', label: 'Potvrzeno' },
  { key: 'started', label: 'Nástup' },
  { key: 'ended', label: 'Konec' },
  { key: 'settlement', label: 'Výčetka' },
]

// Where the shift is in its life: assigned → confirmed → checked in → finished → settlement approved.
export function shiftProgress(shift, settlement = null) {
  if (['declined', 'cancelled'].includes(shift.status)) return { closed: shift.status, steps: [] }
  const completed = shift.status === 'completed'
  const done = {
    assigned: Boolean(shift.driverId),
    confirmed: Boolean(shift.driverId) && (['confirmed', 'completed'].includes(shift.status) || Boolean(shift.actualStartAt)),
    started: Boolean(shift.actualStartAt) || completed,
    ended: Boolean(shift.actualEndAt) || completed,
    settlement: settlement?.status === 'approved',
  }
  let current = false
  const steps = progressSteps.map((step) => {
    const label = step.key === 'settlement' && settlement?.status === 'submitted' ? 'Ke schválení' : step.key === 'settlement' && settlement?.status === 'returned' ? 'Vrácena' : step.label
    if (done[step.key]) return { ...step, label, state: 'done' }
    if (!current) { current = true; return { ...step, label, state: 'current' } }
    return { ...step, label, state: 'todo' }
  })
  return { closed: null, steps }
}
