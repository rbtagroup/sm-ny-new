export const ONLINE_TABLES = [
  'drivers', 'vehicles', 'shifts', 'settlements', 'absences', 'availability', 'serviceBlocks', 'swapRequests', 'notifications', 'pushSubscriptions', 'audit'
]

export const tableName = (key) => ({
  serviceBlocks: 'service_blocks',
  swapRequests: 'swap_requests',
  pushSubscriptions: 'push_subscriptions',
  settlements: 'shift_settlements',
  audit: 'audit_logs',
}[key] || key)

export const stripUndefined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))

export function createSupabaseMappers({ uid, timePart }) {
  const normalizeId = (id, prefix = 'id') => id || uid(prefix)

  const toDb = {
    drivers: (d) => stripUndefined({ id: normalizeId(d.id, 'drv'), profile_id: d.profileId || d.profile_id || null, name: d.name || '', phone: d.phone || null, email: d.email || null, active: d.active !== false, note: d.note || null }),
    vehicles: (v) => stripUndefined({ id: normalizeId(v.id, 'car'), name: v.name || '', plate: v.plate || '', active: v.active !== false, note: v.note || null }),
    shifts: (s) => stripUndefined({ id: normalizeId(s.id, 'sh'), shift_date: s.date, start_time: s.start || '00:00', end_time: s.end || '00:00', driver_id: s.driverId || null, vehicle_id: s.vehicleId || null, type: s.type || 'day', status: s.status || 'assigned', note: s.note || null, instruction: s.instruction || null, decline_reason: s.declineReason || null, actual_start_at: s.actualStartAt || null, actual_end_at: s.actualEndAt || null, swap_request_status: s.swapRequestStatus || null }),
    settlements: (s) => stripUndefined({ id: normalizeId(s.id, 'set'), shift_id: s.shiftId, driver_id: s.driverId || null, vehicle_id: s.vehicleId || null, status: s.status || 'draft', inputs: s.inputs || {}, metrics: s.metrics || {}, config: s.config || {}, note: s.note || null, submitted_at: s.submittedAt || null, approved_at: s.approvedAt || null, approved_by: s.approvedBy || null, returned_reason: s.returnedReason || null, created_at: s.createdAt || new Date().toISOString(), updated_at: s.updatedAt || new Date().toISOString() }),
    absences: (a) => stripUndefined({ id: normalizeId(a.id, 'abs'), driver_id: a.driverId, from_date: a.from, to_date: a.to, reason: a.reason || null }),
    availability: (a) => stripUndefined({ id: normalizeId(a.id, 'av'), driver_id: a.driverId, weekday: a.fromAt ? null : (a.date ? null : Number(a.weekday || 0)), avail_date: a.fromAt ? null : (a.date || null), from_at: a.fromAt || null, to_at: a.toAt || null, start_time: a.start || timePart(a.fromAt) || '00:00', end_time: a.end || timePart(a.toAt) || '23:59', note: a.note || null }),
    serviceBlocks: (b) => stripUndefined({ id: normalizeId(b.id, 'srv'), vehicle_id: b.vehicleId, from_date: b.from, to_date: b.to, reason: b.reason || null }),
    swapRequests: (r) => stripUndefined({ id: normalizeId(r.id, 'swap'), shift_id: r.shiftId, driver_id: r.driverId, target_mode: r.targetMode || 'all', target_driver_id: r.targetDriverId || null, accepted_by_driver_id: r.acceptedByDriverId || null, approved_driver_id: r.approvedDriverId || null, status: r.status || 'pending', reason: r.reason || null, rejected_reason: r.rejectedReason || null, history: r.history || [], created_at: r.createdAt || new Date().toISOString(), accepted_at: r.acceptedAt || null, resolved_at: r.resolvedAt || null, cancelled_at: r.cancelledAt || null }),
    notifications: (n) => stripUndefined({ id: normalizeId(n.id, 'ntf'), target_driver_id: n.targetDriverId || null, target_role: n.targetDriverId ? 'driver' : (n.targetRole || 'admin'), type: n.type || 'info', shift_id: n.shiftId || null, title: n.title || '', body: n.body || null, read_by: n.readBy || [], deleted_by: n.deletedBy || [], created_at: n.at || n.createdAt || new Date().toISOString() }),
    pushSubscriptions: (p) => stripUndefined({ id: normalizeId(p.id, 'push'), profile_id: p.profileId || null, driver_id: p.driverId || null, role: p.role || 'driver', endpoint: p.endpoint || '', subscription: p.subscription || p, platform: p.platform || null, active: p.active !== false, last_seen_at: new Date().toISOString(), last_delivery_at: p.lastDeliveryAt || null, last_error: p.lastError || null, delivery_failures: Number(p.deliveryFailures || 0) }),
    audit: (a) => stripUndefined({ id: normalizeId(a.id, 'log'), actor_id: a.actorId || null, action: a.text || a.action || '', payload: a.payload || {}, created_at: a.at || a.createdAt || new Date().toISOString() }),
  }

  const fromDb = {
    drivers: (d) => ({ id: d.id, profileId: d.profile_id || '', name: d.name || '', phone: d.phone || '', email: d.email || '', active: d.active !== false, note: d.note || '' }),
    vehicles: (v) => ({ id: v.id, name: v.name || '', plate: v.plate || '', active: v.active !== false, note: v.note || '' }),
    shifts: (s) => ({ id: s.id, date: s.shift_date, start: String(s.start_time || '').slice(0, 5), end: String(s.end_time || '').slice(0, 5), driverId: s.driver_id || '', vehicleId: s.vehicle_id || '', type: s.type || 'day', status: s.status || 'assigned', note: s.note || '', instruction: s.instruction || '', declineReason: s.decline_reason || '', actualStartAt: s.actual_start_at || '', actualEndAt: s.actual_end_at || '', swapRequestStatus: s.swap_request_status || '' }),
    settlements: (s) => ({ id: s.id, shiftId: s.shift_id || '', driverId: s.driver_id || '', vehicleId: s.vehicle_id || '', status: s.status || 'draft', inputs: s.inputs || {}, metrics: s.metrics || {}, config: s.config || {}, note: s.note || '', submittedAt: s.submitted_at || '', approvedAt: s.approved_at || '', approvedBy: s.approved_by || '', returnedReason: s.returned_reason || '', createdAt: s.created_at || '', updatedAt: s.updated_at || '' }),
    absences: (a) => ({ id: a.id, driverId: a.driver_id, from: a.from_date, to: a.to_date, reason: a.reason || '' }),
    availability: (a) => ({ id: a.id, driverId: a.driver_id, weekday: a.weekday === null || a.weekday === undefined ? '' : Number(a.weekday), date: a.avail_date || '', fromAt: a.from_at ? String(a.from_at).slice(0, 16) : '', toAt: a.to_at ? String(a.to_at).slice(0, 16) : '', start: String(a.start_time || '').slice(0, 5), end: String(a.end_time || '').slice(0, 5), note: a.note || '' }),
    serviceBlocks: (b) => ({ id: b.id, vehicleId: b.vehicle_id, from: b.from_date, to: b.to_date, reason: b.reason || '' }),
    swapRequests: (r) => ({ id: r.id, shiftId: r.shift_id, driverId: r.driver_id, targetMode: r.target_mode || 'all', targetDriverId: r.target_driver_id || '', acceptedByDriverId: r.accepted_by_driver_id || '', approvedDriverId: r.approved_driver_id || '', status: r.status || 'pending', reason: r.reason || '', rejectedReason: r.rejected_reason || '', history: r.history || [], createdAt: r.created_at, acceptedAt: r.accepted_at || '', resolvedAt: r.resolved_at || '', cancelledAt: r.cancelled_at || '' }),
    notifications: (n) => ({ id: n.id, at: n.created_at, title: n.title || '', body: n.body || '', targetDriverId: n.target_driver_id || '', targetRole: n.target_driver_id ? 'driver' : (n.target_role || 'admin'), type: n.type || 'info', shiftId: n.shift_id || '', readBy: n.read_by || [], deletedBy: n.deleted_by || [] }),
    pushSubscriptions: (p) => ({ id: p.id, profileId: p.profile_id || '', driverId: p.driver_id || '', role: p.role || 'driver', endpoint: p.endpoint || '', subscription: p.subscription || {}, platform: p.platform || '', active: p.active !== false, lastSeenAt: p.last_seen_at || '', lastDeliveryAt: p.last_delivery_at || '', lastError: p.last_error || '', deliveryFailures: Number(p.delivery_failures || 0) }),
    audit: (a) => ({ id: a.id, at: a.created_at, text: a.action || '', actorId: a.actor_id || '' }),
  }

  return { toDb, fromDb }
}
