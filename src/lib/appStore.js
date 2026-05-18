import { addDays, startOfWeek, todayISO } from './dateTime.js'
import { defaultShiftTimes } from './appConfig.js'
import { uid } from './ids.js'

export const STORAGE_KEY = 'rbshift-manager-data-v4'
export const LEGACY_STORAGE_KEYS = ['rbshift-manager-data-v3', 'rbshift-manager-data-v2', 'rbshift-manager-data']
export const AUTOBACKUP_KEY = `${STORAGE_KEY}-autobackup`

export function seed() {
  const t = todayISO()
  const w = startOfWeek(t)
  return {
    drivers: [
      { id: 'drv_roman', name: 'Roman', phone: '+420 600 000 001', email: 'roman@demo.example', active: true, note: 'Stálý řidič' },
      { id: 'drv_lukas', name: 'Lukáš', phone: '+420 600 000 002', email: 'lukas@demo.example', active: true, note: 'Admin / záskok' },
      { id: 'drv_petra', name: 'Petra', phone: '+420 600 000 003', email: 'petra@demo.example', active: true, note: 'Víkendy' },
      { id: 'drv_milan', name: 'Milan', phone: '+420 600 000 004', email: 'milan@demo.example', active: true, note: 'Noční směny' },
    ],
    vehicles: [
      { id: 'car_tesla_1', name: 'Tesla Model 3', plate: 'RB 001', active: true, note: 'Hlavní vůz' },
      { id: 'car_tesla_2', name: 'Tesla Model 3', plate: 'RB 002', active: true, note: 'Noční provoz' },
      { id: 'car_van_1', name: 'VAN 7 míst', plate: 'RB 007', active: true, note: 'Skupiny / letiště' },
    ],
    shifts: [
      { id: 'sh_1', date: w, start: '07:00', end: '19:00', driverId: 'drv_roman', vehicleId: 'car_tesla_1', type: 'day', status: 'confirmed', note: 'Denní Hodonín', declineReason: '' },
      { id: 'sh_2', date: w, start: '14:00', end: '22:00', driverId: 'drv_petra', vehicleId: 'car_tesla_2', type: 'day', status: 'assigned', note: 'Odpolední špička', declineReason: '' },
      { id: 'sh_3', date: w, start: '19:00', end: '07:00', driverId: 'drv_milan', vehicleId: 'car_tesla_1', type: 'night', status: 'assigned', note: 'Noční provoz', declineReason: '' },
      { id: 'sh_4', date: addDays(w, 1), start: '06:00', end: '14:00', driverId: 'drv_lukas', vehicleId: 'car_van_1', type: 'day', status: 'draft', note: 'Záskok / převozy', declineReason: '' },
    ],
    absences: [],
    availability: [
      { id: 'av_roman_1', driverId: 'drv_roman', weekday: 1, start: '06:00', end: '18:00', note: 'Preferuje denní provoz' },
      { id: 'av_roman_2', driverId: 'drv_roman', weekday: 2, start: '06:00', end: '18:00', note: '' },
      { id: 'av_petra_6', driverId: 'drv_petra', weekday: 6, start: '10:00', end: '23:00', note: 'Víkendy' },
      { id: 'av_milan_5', driverId: 'drv_milan', weekday: 5, start: '18:00', end: '06:00', note: 'Noční' },
      { id: 'av_milan_6', driverId: 'drv_milan', weekday: 6, start: '18:00', end: '06:00', note: 'Noční' },
    ],
    serviceBlocks: [],
    settlements: [],
    swapRequests: [],
    notifications: [],
    pushSubscriptions: [],
    audit: [{ id: uid('log'), at: new Date().toISOString(), text: 'Vytvořena demo data aplikace.' }],
    settings: { companyName: 'RBSHIFT', mode: 'demo', lastBackupAt: '', mobileCompact: true, shiftTimes: { ...defaultShiftTimes }, coverageSlots: [
      { id: 'cov_day', name: 'Denní', start: '07:00', end: '19:00', minDrivers: 1 },
      { id: 'cov_night', name: 'Noční', start: '19:00', end: '07:00', minDrivers: 1 },
      { id: 'cov_peak_fri', name: 'Pá/Sobota špička', start: '20:00', end: '03:00', minDrivers: 2 },
      { id: 'cov_event', name: 'Akce / plesy', start: '18:00', end: '02:00', minDrivers: 2 },
    ], deploymentChecklist: [] },
  }
}

export function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean)
    if (!raw) return seed()
    const parsed = JSON.parse(raw)
    const base = seed()
    return {
      ...base,
      ...parsed,
      drivers: parsed.drivers || base.drivers,
      vehicles: parsed.vehicles || base.vehicles,
      shifts: (parsed.shifts || base.shifts).map((s) => ({ declineReason: '', instruction: '', actualStartAt: '', actualEndAt: '', swapRequestStatus: '', ...s })),
      absences: parsed.absences || [],
      availability: (parsed.availability || base.availability || []).map((a) => ({ fromAt: '', toAt: '', ...a })),
      serviceBlocks: parsed.serviceBlocks || [],
      settlements: (parsed.settlements || []).map((s) => ({ inputs: {}, metrics: {}, config: {}, note: '', submittedAt: '', approvedAt: '', approvedBy: '', returnedReason: '', ...s })),
      swapRequests: (parsed.swapRequests || []).map((r) => ({ targetMode: 'all', targetDriverId: '', acceptedByDriverId: '', acceptedAt: '', resolvedAt: '', approvedDriverId: '', rejectedReason: '', cancelledAt: '', history: [], ...r })),
      notifications: (parsed.notifications || []).map((n) => ({ readBy: [], deletedBy: [], ...n })),
      pushSubscriptions: parsed.pushSubscriptions || [],
      audit: parsed.audit || [],
      settings: { ...base.settings, ...(parsed.settings || {}) },
    }
  } catch {
    return seed()
  }
}

export function writeStore(data) {
  // pushSubscriptions obsahují endpoint URL a šifrovací klíče — neukládáme do localStorage.
  // Po reconnectu se načtou znovu ze Supabase.
  const { pushSubscriptions: _omit, ...rest } = data
  const enriched = { ...rest, pushSubscriptions: [], settings: { ...(data.settings || {}), lastSavedAt: new Date().toISOString() } }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enriched))
    localStorage.setItem(AUTOBACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), data: enriched }))
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      // Záloha se nevešla — odstraň ji a zkus uložit alespoň hlavní snapshot
      try { localStorage.removeItem(AUTOBACKUP_KEY) } catch {}
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(enriched)) } catch {}
    }
  }
}
