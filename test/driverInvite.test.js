import test from 'node:test'
import assert from 'node:assert/strict'
import { driverAppStatus, driverInviteText, emailInviteUrl, whatsappInviteUrl } from '../src/lib/driverInvite.js'

test('invite text leads a new driver to sign up with the registered e-mail', () => {
  const text = driverInviteText({ driver: { name: 'Petra Nová', email: ' Petra@Example.cz ' }, appUrl: 'https://sm-ny-new.vercel.app/' })

  assert.match(text, /^Ahoj Petra, /)
  assert.match(text, /Otevři https:\/\/sm-ny-new\.vercel\.app\n/)
  assert.match(text, /„Vytvořit účet“ a zaregistruj se e-mailem petra@example\.cz/)
  assert.match(text, /Přidat na plochu/)
  assert.match(text, /„Povolit na tomto zařízení“/)
  assert.match(driverInviteText({ driver: { name: 'Petra' }, appUrl: 'https://x.cz', hasLogin: true }), /Přihlas se e-mailem který máš u dispečinku\. Když heslo nevíš, napiš dispečinku\./)
})

test('WhatsApp and e-mail invite links carry the number, address and text', () => {
  assert.equal(whatsappInviteUrl('+420 600 000 001', 'Ahoj'), 'https://wa.me/420600000001?text=Ahoj')
  assert.equal(whatsappInviteUrl('600 000 001', 'a b'), 'https://wa.me/420600000001?text=a%20b')
  assert.equal(whatsappInviteUrl('00421 900 123 456', 'x'), 'https://wa.me/421900123456?text=x')
  assert.equal(whatsappInviteUrl('', 'x'), 'https://wa.me/?text=x')
  assert.equal(emailInviteUrl('Petra@Example.cz', 'Řádek 1\nŘádek 2'), 'mailto:petra@example.cz?subject=Pozv%C3%A1nka%20do%20aplikace%20RBSHIFT&body=%C5%98%C3%A1dek%201%0A%C5%98%C3%A1dek%202')
})

test('driver app status reflects login, recent activity and push devices', () => {
  const now = new Date(2026, 8, 13, 20, 0)
  const driver = { id: 'drv_a', profileId: 'uid_a' }
  const devices = [{ driverId: 'drv_other', active: true }, { profileId: 'uid_a', active: true }]

  assert.deepEqual(driverAppStatus({ driver, now }), { known: false, hasLogin: true, pushEnabled: false, needsInvite: false, label: '' })
  assert.deepEqual(driverAppStatus({ driver, activity: { has_login: false }, now }), { known: true, hasLogin: false, pushEnabled: false, needsInvite: true, label: 'Bez účtu v aplikaci' })

  const today = driverAppStatus({ driver, activity: { has_login: true, last_active_at: new Date(2026, 8, 13, 6, 30).toISOString() }, pushSubscriptions: devices, now })
  assert.equal(today.label, 'Aktivní dnes')
  assert.equal(today.pushEnabled, true)
  assert.equal(today.needsInvite, false)

  assert.equal(driverAppStatus({ driver, activity: { has_login: true, last_active_at: new Date(2026, 8, 12, 23, 50).toISOString() }, now }).label, 'Aktivní včera')
  assert.equal(driverAppStatus({ driver, activity: { has_login: true, last_active_at: new Date(2026, 8, 9, 12).toISOString() }, now }).label, 'Aktivní před 4 dny')

  const stale = driverAppStatus({ driver, activity: { has_login: true, last_active_at: new Date(2026, 4, 22, 9).toISOString() }, pushSubscriptions: [{ profileId: 'uid_a', active: false }], now })
  assert.equal(stale.label, 'Naposledy aktivní 22. 5.')
  assert.equal(stale.needsInvite, true)
  assert.equal(stale.pushEnabled, false)
  assert.equal(driverAppStatus({ driver, activity: { has_login: true, last_active_at: null }, now }).label, 'Účet zatím nepoužitý')
})
