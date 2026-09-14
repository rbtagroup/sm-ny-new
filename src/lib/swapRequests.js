import { shiftNoticeBody } from './display.js'
import { addNotificationsToData } from './notifications.js'

export const swapStatusMap = { pending: 'Nabídnuto', accepted: 'Přijato kolegou', approved: 'Schváleno', rejected: 'Zamítnuto', cancelled: 'Zrušeno řidičem' }

// Who gets the shift when dispatch approves: the colleague who took the offer or was asked, or '' while an offer to everyone waits.
export const swapApprovalDriverId = (request = {}) => request.acceptedByDriverId || request.targetDriverId || ''

const withHistory = (request, text, at) => ({ ...request, history: [...(request.history || []), { at, text }] })

// Plan after dispatch approves or rejects a swap request or an interest in an open shift, with notices for the drivers involved.
export function resolveSwapRequest(data, { requestId, status, helpers, makeNotice, now = new Date().toISOString() }) {
  const request = (data.swapRequests || []).find((item) => item.id === requestId)
  const shift = (data.shifts || []).find((item) => item.id === request?.shiftId)
  if (!request || !shift) return { data, error: 'Žádost o výměnu už neexistuje.' }

  if (status === 'approved') {
    const newDriverId = swapApprovalDriverId(request)
    if (!newDriverId) return { data, error: 'U nabídky všem musí nejdřív některý kolega kliknout „Chci převzít směnu“.' }
    const notices = request.targetMode === 'open'
      ? [makeNotice({ title: 'Volná směna schválena a potvrzena', body: shiftNoticeBody(shift, helpers, 'směna je rovnou potvrzená'), targetDriverId: newDriverId, type: 'open-shift-approved', shiftId: shift.id })]
      : [
        makeNotice({ title: 'Výměna směny schválena', body: `${shiftNoticeBody(shift, helpers)} · převedeno na ${helpers.driverName(newDriverId)}`, targetDriverId: request.driverId, type: 'swap-approved', shiftId: shift.id }),
        makeNotice({ title: 'Převzal jsi směnu – potvrzeno', body: shiftNoticeBody(shift, helpers, 'směna je rovnou potvrzená'), targetDriverId: newDriverId, type: 'swap-approved', shiftId: shift.id }),
      ]
    return {
      data: addNotificationsToData({
        ...data,
        swapRequests: data.swapRequests.map((item) => item.id === requestId
          ? withHistory({ ...item, status, resolvedAt: now, approvedDriverId: newDriverId }, `Admin schválil převzetí pro ${helpers.driverName(newDriverId)}. Směna byla automaticky potvrzena.`, now)
          : item),
        shifts: data.shifts.map((item) => item.id === shift.id ? { ...item, driverId: newDriverId, status: 'confirmed', declineReason: '', swapRequestStatus: 'approved' } : item),
      }, notices),
      message: `${request.targetMode === 'open' ? 'Volná směna byla přidělena a potvrzena' : 'Výměna schválena, směna převedena a potvrzena pro'} ${helpers.driverName(newDriverId)}.`,
    }
  }

  const notices = [makeNotice({ title: 'Výměna směny zamítnuta', body: shiftNoticeBody(shift, helpers), targetDriverId: request.driverId, type: 'swap-rejected', shiftId: shift.id })]
  if (request.acceptedByDriverId) notices.push(makeNotice({ title: 'Výměna nebyla schválena', body: shiftNoticeBody(shift, helpers), targetDriverId: request.acceptedByDriverId, type: 'swap-rejected', shiftId: shift.id }))
  return {
    data: addNotificationsToData({
      ...data,
      swapRequests: data.swapRequests.map((item) => item.id === requestId
        ? withHistory({ ...item, status, resolvedAt: now, rejectedReason: status === 'rejected' ? 'Zamítnuto adminem' : '' }, status === 'rejected' ? 'Admin zamítl výměnu.' : `Stav výměny změněn na ${swapStatusMap[status]}.`, now)
        : item),
      shifts: data.shifts.map((item) => item.id === shift.id ? { ...item, swapRequestStatus: status } : item),
    }, notices),
    message: `Žádost o výměnu směny: ${swapStatusMap[status]}.`,
  }
}
