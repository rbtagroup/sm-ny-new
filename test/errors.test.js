import test from 'node:test'
import assert from 'node:assert/strict'
import { appFriendlyError } from '../src/lib/errors.js'

test('appFriendlyError hides RLS and table internals from users', () => {
  const message = appFriendlyError('notifications: new row violates row-level security policy for table "audit_logs"')

  assert.equal(message, 'Akci se nepodařilo uložit kvůli oprávnění. Obnov aplikaci a zkus to znovu, případně kontaktuj dispečink.')
  assert.doesNotMatch(message, /row-level|audit_logs|notifications/i)
})

test('appFriendlyError explains schema and migration mismatches without raw SQL names', () => {
  const message = appFriendlyError('Could not find the table public.push_delivery_logs in the schema cache')

  assert.equal(message, 'Aplikace a databáze nejsou ve stejné verzi. Obnov aplikaci, případně kontaktuj dispečink.')
  assert.doesNotMatch(message, /schema cache|push_delivery_logs/i)
})

test('appFriendlyError translates push endpoint authorization and rate limits', () => {
  assert.equal(
    appFriendlyError('Forbidden notification target'),
    'Nemáš oprávnění poslat tuto notifikaci vybranému příjemci.',
  )
  assert.equal(
    appFriendlyError('Push global delivery rate limit exceeded'),
    'Push notifikace jsou dočasně omezené kvůli většímu počtu požadavků. Chvíli počkej a zkus to znovu.',
  )
})

test('appFriendlyError translates expired push subscriptions', () => {
  assert.equal(
    appFriendlyError('Gone'),
    'Push povolení na zařízení už není platné. Odpoj zařízení a nech řidiče znovu povolit notifikace.',
  )
})
