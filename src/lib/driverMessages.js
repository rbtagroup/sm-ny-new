export const driverMessageLimits = Object.freeze({ title: 80, body: 240 })

export function activeDriverPushDeviceCount(data = {}, form = {}) {
  const subscriptions = data.pushSubscriptions || []
  if (form.targetMode === 'driver') {
    return subscriptions.filter((item) => item.active !== false && item.role === 'driver' && item.driverId === form.targetDriverId).length
  }
  return subscriptions.filter((item) => item.active !== false && item.role === 'driver').length
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
