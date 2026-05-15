export const statusMap = { open: 'Volná směna', draft: 'Návrh', assigned: 'Čeká na potvrzení', confirmed: 'Potvrzeno', declined: 'Odmítnuto', completed: 'Dokončeno', cancelled: 'Zrušeno' }
export const statusToneMap = { open: 'warn', draft: 'waiting', assigned: 'waiting', pending: 'waiting', confirmed: 'good', in_progress: 'good', declined: 'bad', completed: 'good', cancelled: 'bad' }
export const roleMap = { admin: 'Admin', dispatcher: 'Dispečer', driver: 'Řidič' }
export const shiftTypeMap = { day: 'Denní', night: 'Noční', backup: 'Záloha', transfer: 'Převoz', custom: 'Vlastní' }
export const settlementStatusMap = { draft: 'Rozpracováno', submitted: 'Čeká na schválení', approved: 'Schváleno', returned: 'Vráceno k opravě' }
export const settlementToneMap = { draft: 'warn', submitted: 'waiting', approved: 'good', returned: 'bad' }
export const repeatMap = { none: 'Neopakovat', daily7: '7 dnů za sebou', workweek: 'Po–Pá', weekend: 'So–Ne' }
export const weekdayMap = { 1: 'Po', 2: 'Út', 3: 'St', 4: 'Čt', 5: 'Pá', 6: 'So', 0: 'Ne' }
export const defaultShiftTimes = { dayStart: '07:00', dayEnd: '19:00', nightStart: '19:00', nightEnd: '07:00', eventStart: '18:00', eventEnd: '03:00' }
export const defaultShiftTemplates = [
  { id: 'tpl_day', name: 'Denní', start: '07:00', end: '19:00', active: true, type: 'day' },
  { id: 'tpl_night', name: 'Noční', start: '19:00', end: '07:00', active: true, type: 'night' },
]
