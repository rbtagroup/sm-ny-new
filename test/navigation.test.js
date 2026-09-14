import test from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN_PAGE_KEYS, navPageFor, overviewTabs, staffNavSections } from '../src/lib/navigation.js'

const labels = (sections) => sections.flatMap(([, items]) => items.map(([, label]) => label))

test('staff menu keeps seven daily items for admins and four for dispatchers', () => {
  assert.deepEqual(labels(staffNavSections('admin')), ['Plán směn', 'Dashboard', 'Výčetky', 'Notifikace', 'Řidiči', 'Vozidla', 'Nastavení'])
  assert.deepEqual(labels(staffNavSections('dispatcher')), ['Plán směn', 'Dashboard', 'Výčetky', 'Notifikace'])
})

test('pages moved out of the menu stay admin-only and highlight where they open from', () => {
  for (const page of ['availability', 'shiftTemplates', 'history', 'drivers', 'vehicles', 'settings']) assert.ok(ADMIN_PAGE_KEYS.has(page), page)
  assert.equal(ADMIN_PAGE_KEYS.has('audit'), false, 'dispatchers keep the weekly audit')
  assert.equal(navPageFor('audit'), 'dashboard')
  assert.equal(navPageFor('history'), 'dashboard')
  assert.equal(navPageFor('shiftTemplates'), 'planner')
  assert.equal(navPageFor('coverageNorms'), 'planner')
  assert.equal(navPageFor('availability'), 'drivers')
  assert.equal(navPageFor('settlements'), 'settlements')
})

test('dashboard tabs show change history to admins only', () => {
  assert.deepEqual(overviewTabs('admin').map(([key]) => key), ['dashboard', 'audit', 'history'])
  assert.deepEqual(overviewTabs('dispatcher').map(([key]) => key), ['dashboard', 'audit'])
})

test('phone bottom bar keeps the daily pages and puts the rest behind "Více"', async () => {
  const { STAFF_BOTTOM_NAV, staffBottomNavKey, staffMoreItems } = await import('../src/lib/navigation.js')
  assert.deepEqual(STAFF_BOTTOM_NAV.map(([key]) => key), ['planner', 'dashboard', 'settlements', 'notifications'])
  assert.deepEqual(staffMoreItems('admin').map(([key]) => key), ['drivers', 'vehicles', 'availability', 'coverageNorms', 'shiftTemplates', 'settings'])
  assert.deepEqual(staffMoreItems('dispatcher').map(([key]) => key), ['coverageNorms'])
  assert.equal(staffBottomNavKey('audit'), 'dashboard')
  assert.equal(staffBottomNavKey('coverageNorms'), 'planner')
  assert.equal(staffBottomNavKey('availability'), 'more')
  assert.equal(staffBottomNavKey('settings'), 'more')
})
