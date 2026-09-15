import { formatDate, intervalForShift, startOfWeek } from './dateTime.js'
import { coverageGaps } from './opsMetrics.js'
import { shiftNoticeBody, sortByDateTime } from './display.js'
import { swapApprovalDriverId } from './swapRequests.js'

export const CONFIRM_REMINDER_TYPE = 'shift-confirm-reminder'
// Shifts starting this soon without the driver's confirmation are worth a reminder.
const CONFIRM_WINDOW_MS = 48 * 60 * 60 * 1000
// After a reminder the task waits this long before offering another one.
export const REMINDER_PAUSE_MS = 6 * 60 * 60 * 1000

const AWAITING_DRIVER = new Set(['assigned', 'draft', 'pending'])
const taskOrder = { conflict: 0, declined: 1, swap: 2, gap: 3, confirm: 4 }

export function lastConfirmReminderAt(data = {}, shiftId = '') {
  return (data.notifications || [])
    .filter((notice) => notice.type === CONFIRM_REMINDER_TYPE && notice.shiftId === shiftId)
    .map((notice) => notice.at || notice.createdAt || '')
    .filter(Boolean)
    .sort()
    .at(-1) || ''
}

export function confirmReminderNotice(shift, helpers, makeNotice) {
  return makeNotice({ title: 'Potvrď prosím směnu', body: shiftNoticeBody(shift, helpers, 'čeká na tvé potvrzení'), targetDriverId: shift.driverId, type: CONFIRM_REMINDER_TYPE, shiftId: shift.id })
}

const shiftWhen = (shift) => `${formatDate(shift.date)} ${shift.start}–${shift.end}`

export function dashboardOperationalIssues(data = {}, helpers = {}, today = '', now = Date.now()) {
  const shifts = data.shifts || []
  const futureShifts = shifts.filter((shift) => shift.date >= today)
  const activeShifts = futureShifts.filter((shift) => !['cancelled', 'declined'].includes(shift.status))
  const conflicts = activeShifts.flatMap((shift) =>
    (helpers.conflictMessages?.(shift) || []).map((message) => ({ shift, message })),
  )
  const declined = sortByDateTime(futureShifts.filter((shift) => shift.status === 'declined'))
  const shiftById = new Map(shifts.map((shift) => [shift.id, shift]))
  const pendingSwaps = (data.swapRequests || []).filter((request) => {
    if (!['pending', 'accepted'].includes(request.status)) return false
    const shift = shiftById.get(request.shiftId)
    return !shift || shift.date >= today
  })
  const gaps = coverageGaps(data, startOfWeek(today)).filter((gap) => gap.day >= today)
  const awaitingSoon = sortByDateTime(activeShifts.filter((shift) => {
    if (!shift.driverId || !AWAITING_DRIVER.has(shift.status) || shift.actualStartAt) return false
    const [startAt] = intervalForShift(shift)
    return startAt > now && startAt - now <= CONFIRM_WINDOW_MS
  }))

  const conflictsByShift = new Map()
  for (const { shift, message } of conflicts) conflictsByShift.set(shift.id, { shift, messages: [...(conflictsByShift.get(shift.id)?.messages || []), message] })
  const name = (id) => helpers.driverName?.(id) || 'Neobsazeno'

  // Everything dispatch should act on, soonest first, each with what it needs for its action.
  const tasks = [
    ...[...conflictsByShift.values()].map(({ shift, messages }) => ({ key: `conflict-${shift.id}`, kind: 'conflict', tone: 'problem', sortAt: `${shift.date} ${shift.start}`, title: 'Problém ve směně', when: shiftWhen(shift), detail: messages.join(' '), shift })),
    ...declined.map((shift) => ({ key: `declined-${shift.id}`, kind: 'declined', tone: 'declined', sortAt: `${shift.date} ${shift.start}`, title: 'Řidič směnu odmítl', when: shiftWhen(shift), detail: `${name(shift.driverId)} · ${shift.declineReason || 'bez důvodu'}`, shift })),
    ...pendingSwaps.map((request) => {
      const shift = shiftById.get(request.shiftId)
      const newDriverId = swapApprovalDriverId(request)
      const detail = request.targetMode === 'open'
        ? `${name(newDriverId)} se hlásí na volnou směnu`
        : newDriverId ? `${name(request.driverId)} předává směnu: ${name(newDriverId)}` : `${name(request.driverId)} nabízí směnu, zatím ji nikdo nepřevzal`
      return { key: `swap-${request.id}`, kind: 'swap', tone: 'swap', sortAt: shift ? `${shift.date} ${shift.start}` : '', title: request.targetMode === 'open' ? 'Zájem o volnou směnu' : 'Žádost o výměnu', when: shift ? shiftWhen(shift) : 'směna už neexistuje', detail, request, shift, approvable: Boolean(shift && newDriverId) }
    }),
    ...gaps.map((gap) => ({ key: `gap-${gap.day}-${gap.id}`, kind: 'gap', tone: 'open', sortAt: `${gap.day} ${gap.start}`, title: `Chybí obsazení · ${gap.name}`, when: `${formatDate(gap.day)} ${gap.start}–${gap.end}`, detail: gap.need > 1 ? `chybí ${gap.missing} z ${gap.need}` : `chybí ${gap.missing}`, gap })),
    ...awaitingSoon.map((shift) => {
      const remindedAt = lastConfirmReminderAt(data, shift.id)
      const remindedRecently = Boolean(remindedAt) && now - new Date(remindedAt).getTime() < REMINDER_PAUSE_MS
      return { key: `confirm-${shift.id}`, kind: 'confirm', tone: 'pending', sortAt: `${shift.date} ${shift.start}`, title: 'Nepotvrzená směna', when: shiftWhen(shift), detail: `${name(shift.driverId)} · čeká na potvrzení`, shift, remindedAt, remindedRecently }
    }),
  ].sort((a, b) => a.sortAt.localeCompare(b.sortAt) || taskOrder[a.kind] - taskOrder[b.kind])

  return {
    conflicts,
    declined,
    pendingSwaps,
    gaps,
    awaitingSoon,
    tasks,
    count: tasks.length,
  }
}
