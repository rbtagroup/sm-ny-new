export const statusMap = { open: 'Volná směna', draft: 'Návrh', assigned: 'Čeká na potvrzení', confirmed: 'Potvrzeno', declined: 'Odmítnuto', completed: 'Dokončeno', cancelled: 'Zrušeno' }
// Every status has one tone (color and icon) used by pills, calendar cards and legends alike; tokens live in styles/tokens.css.
export const statusToneMap = { open: 'open', draft: 'draft', assigned: 'pending', pending: 'pending', confirmed: 'confirmed', in_progress: 'confirmed', declined: 'declined', completed: 'done', cancelled: 'cancelled' }
// The order statuses are explained in legends, followed by the marks a shift card can carry on top of its status.
export const statusLegend = [
  ['draft', 'Návrh'],
  ['pending', 'Čeká na potvrzení'],
  ['open', 'Volná směna / chybí řidič'],
  ['confirmed', 'Potvrzeno'],
  ['done', 'Dokončeno'],
  ['declined', 'Odmítnuto'],
  ['cancelled', 'Zrušeno'],
  ['swap', 'Výměna čeká'],
  ['problem', 'Problém ve směně'],
]
export const roleMap = { admin: 'Admin', dispatcher: 'Dispečer', driver: 'Řidič' }
export const shiftTypeMap = { day: 'Denní', night: 'Noční', backup: 'Záloha', transfer: 'Převoz', custom: 'Vlastní' }
export const settlementStatusMap = { draft: 'Rozpracováno', submitted: 'Čeká na schválení', approved: 'Schváleno', returned: 'Vráceno k opravě' }
export const settlementToneMap = { missing: 'pending', draft: 'draft', submitted: 'pending', approved: 'confirmed', returned: 'declined' }
export const repeatMap = { none: 'Neopakovat', daily7: '7 dnů za sebou', workweek: 'Po–Pá', weekend: 'So–Ne' }
export const weekdayMap = { 1: 'Po', 2: 'Út', 3: 'St', 4: 'Čt', 5: 'Pá', 6: 'So', 0: 'Ne' }
export const defaultShiftTimes = { dayStart: '07:00', dayEnd: '19:00', nightStart: '19:00', nightEnd: '07:00', eventStart: '18:00', eventEnd: '03:00' }
export const defaultShiftTemplates = [
  { id: 'tpl_day', name: 'Denní', start: '07:00', end: '19:00', active: true, type: 'day' },
  { id: 'tpl_night', name: 'Noční', start: '19:00', end: '07:00', active: true, type: 'night' },
]
