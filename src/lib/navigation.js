// Staff menu keeps the daily pages; occasional ones open from the page they belong to.
export const DISPATCH_NAV = [
  ['planner', 'Plán směn'],
  ['dashboard', 'Dashboard'],
  ['settlements', 'Výčetky'],
  ['notifications', 'Notifikace'],
]

export const ADMIN_NAV = [
  ['drivers', 'Řidiči'],
  ['vehicles', 'Vozidla'],
  ['settings', 'Nastavení'],
]

export const ADMIN_PAGE_KEYS = new Set(['drivers', 'vehicles', 'availability', 'shiftTemplates', 'history', 'settings'])

const NAV_PARENT = { audit: 'dashboard', history: 'dashboard', shifts: 'planner', shiftTemplates: 'planner', coverageNorms: 'planner', availability: 'drivers' }

export function staffNavSections(role = '') {
  return [['DISPEČINK', DISPATCH_NAV], ...(role === 'admin' ? [['ADMIN', ADMIN_NAV]] : [])]
}

// Pages without their own menu item highlight the item they are opened from.
export function navPageFor(page = '') {
  return NAV_PARENT[page] || page
}

export function overviewTabs(role = '') {
  return [['dashboard', 'Dnes'], ['audit', 'Audit týdne'], ...(role === 'admin' ? [['history', 'Historie změn']] : [])]
}

// Phones get a bottom bar with the four daily pages; everything else sits behind "Více".
export const STAFF_BOTTOM_NAV = [
  ['planner', 'Plán'],
  ['dashboard', 'Dashboard'],
  ['settlements', 'Výčetky'],
  ['notifications', 'Notifikace'],
]

export function staffMoreItems(role = '') {
  const admin = role === 'admin'
  return [
    ...(admin ? [['drivers', 'Řidiči'], ['vehicles', 'Vozidla'], ['availability', 'Dostupnost řidičů']] : []),
    ['coverageNorms', 'Normy pokrytí'],
    ...(admin ? [['shiftTemplates', 'Šablony směn'], ['settings', 'Nastavení']] : []),
  ]
}

// The bottom bar item that stays highlighted for a page; pages without their own item light up "Více".
export function staffBottomNavKey(page = '') {
  const parent = navPageFor(page)
  return STAFF_BOTTOM_NAV.some(([key]) => key === parent) ? parent : 'more'
}
