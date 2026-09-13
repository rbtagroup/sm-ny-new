import { normalizeDriverEmail } from './drivers.js'

const DAY_MS = 24 * 60 * 60 * 1000
export const INVITE_AFTER_INACTIVE_DAYS = 14

export function driverInviteText({ driver = {}, appUrl = '', hasLogin = false } = {}) {
  const firstName = String(driver.name || '').trim().split(/\s+/)[0] || ''
  const email = normalizeDriverEmail(driver.email) || 'který máš u dispečinku'
  const url = String(appUrl || '').replace(/\/+$/, '')
  return [
    `Ahoj${firstName ? ` ${firstName}` : ''}, směny teď plánujeme v aplikaci RBSHIFT.`,
    `1. Otevři ${url}`,
    hasLogin
      ? `2. Přihlas se e-mailem ${email}. Když heslo nevíš, napiš dispečinku.`
      : `2. Klepni na „Vytvořit účet“ a zaregistruj se e-mailem ${email}, jinak se nenapojíš na své směny.`,
    '3. Přidej si aplikaci na plochu: iPhone – Safari, Sdílet, Přidat na plochu. Android – Chrome, menu ⋮, Přidat na plochu.',
    '4. V aplikaci otevři Nastavení a klepni na „Povolit na tomto zařízení“, ať ti chodí upozornění na směny.',
  ].join('\n')
}

// wa.me needs the international number without "+" or leading zeros; Czech numbers are often stored without 420.
export function whatsappInviteUrl(phone = '', text = '') {
  let digits = String(phone || '').replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 9) digits = `420${digits}`
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

export function emailInviteUrl(email = '', text = '') {
  return `mailto:${normalizeDriverEmail(email)}?subject=${encodeURIComponent('Pozvánka do aplikace RBSHIFT')}&body=${encodeURIComponent(text)}`
}

const localDayStart = (value) => {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

// activity comes from rb_driver_activity(); without it (offline or older database) only push state is known.
export function driverAppStatus({ driver = {}, activity = null, pushSubscriptions = [], now = new Date() } = {}) {
  const pushEnabled = (pushSubscriptions || []).some((device) => device?.active !== false
    && ((driver.id && device.driverId === driver.id) || (driver.profileId && device.profileId === driver.profileId)))
  if (!activity) return { known: false, hasLogin: Boolean(driver.profileId), pushEnabled, needsInvite: false, label: '' }

  const hasLogin = Boolean(activity.has_login)
  if (!hasLogin) return { known: true, hasLogin, pushEnabled, needsInvite: true, label: 'Bez účtu v aplikaci' }

  const lastActive = new Date(activity.last_active_at || '')
  if (!Number.isFinite(lastActive.getTime())) return { known: true, hasLogin, pushEnabled, needsInvite: true, label: 'Účet zatím nepoužitý' }

  const days = Math.max(0, Math.round((localDayStart(now) - localDayStart(lastActive)) / DAY_MS))
  const label = days === 0
    ? 'Aktivní dnes'
    : days === 1
      ? 'Aktivní včera'
      : days < 7
        ? `Aktivní před ${days} dny`
        : `Naposledy aktivní ${lastActive.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', ...(lastActive.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }) })}`
  return { known: true, hasLogin, pushEnabled, needsInvite: days >= INVITE_AFTER_INACTIVE_DAYS, label }
}
