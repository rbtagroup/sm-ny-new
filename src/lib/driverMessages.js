export const driverMessageLimits = Object.freeze({ title: 80, body: 240 })

function messageCreatedAt(message) {
  return message?.at || message?.createdAt || ''
}

export function activeDriverPushDeviceCount(data = {}, form = {}) {
  const subscriptions = data.pushSubscriptions || []
  if (form.targetMode === 'driver') {
    return subscriptions.filter((item) => item.active !== false && item.role === 'driver' && item.driverId === form.targetDriverId).length
  }
  return subscriptions.filter((item) => item.active !== false && item.role === 'driver').length
}

export function driverMessageHistory(data = {}) {
  return [...(data.notifications || [])]
    .filter((notice) => notice?.type === 'staff-message')
    .sort((a, b) => new Date(messageCreatedAt(b) || 0).getTime() - new Date(messageCreatedAt(a) || 0).getTime())
}

export function driverMessageReadCount(message = {}) {
  return new Set((message.readBy || []).filter((key) => String(key).startsWith('driver:'))).size
}

export function driverMessageTargetDeviceCount(data = {}, message = {}) {
  return activeDriverPushDeviceCount(data, {
    targetMode: message.targetDriverId ? 'driver' : 'driver_all',
    targetDriverId: message.targetDriverId || '',
  })
}

export function latestDriverMessageDeliveryLog(data = {}, message = {}) {
  return [...(data.pushDeliveryLogs || [])]
    .filter((log) => log.notificationId === message.id)
    .sort((a, b) => new Date((b.createdAt || 0)).getTime() - new Date((a.createdAt || 0)).getTime())[0] || null
}

export function driverMessageDeliveryLabel(data = {}, message = {}) {
  const log = latestDriverMessageDeliveryLog(data, message)
  if (!log) return `${driverMessageTargetDeviceCount(data, message)} zařízení`
  const sent = Number(log.sent || 0)
  const failed = Number(log.failed || 0)
  const recipients = Number(log.recipients || 0)
  if (!recipients) return '0 zařízení'
  if (failed) return `${sent}/${recipients} push · ${failed} chyba`
  return `${sent}/${recipients} push OK`
}

export function createDriverMessageNotice(makeNotice, form = {}) {
  const targetMode = form.targetMode === 'driver' ? 'driver' : 'driver_all'
  const targetDriverId = targetMode === 'driver' ? String(form.targetDriverId || '').trim() : ''
  const title = String(form.title || '').trim()
  const body = String(form.body || '').trim()

  if (!title) return { error: 'Vyplň titulek zprávy.' }
  if (!body) return { error: 'Vyplň text zprávy.' }
  if (title.length > driverMessageLimits.title) return { error: `Titulek může mít maximálně ${driverMessageLimits.title} znaků.` }
  if (body.length > driverMessageLimits.body) return { error: `Zpráva může mít maximálně ${driverMessageLimits.body} znaků.` }
  if (targetMode === 'driver' && !targetDriverId) return { error: 'Vyber řidiče.' }
  if (typeof makeNotice !== 'function') return { error: 'Chybí služba pro vytvoření notifikace.' }

  return {
    notice: makeNotice({
      title,
      body,
      targetDriverId,
      targetRole: targetMode === 'driver' ? 'driver' : 'driver_all',
      type: 'staff-message',
    }),
  }
}
