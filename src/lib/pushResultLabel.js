import { appFriendlyError } from './errors.js'

export function pushResultLabel(result) {
  if (!result) return 'Server nevrátil žádnou odpověď.'
  if (result.skipped) {
    const labels = {
      'no-notifications': 'není co odeslat',
      'supabase-not-configured': 'chybí Supabase konfigurace ve frontendu',
      'missing-vapid-public-key': 'chybí VITE_VAPID_PUBLIC_KEY ve Vercelu',
      'missing-auth-token': 'uživatel není přihlášený k ostrému backendu',
    }
    return `Server push přeskočen: ${labels[result.reason] || result.reason}.`
  }
  if (!result.ok) return `Server push selhal: ${appFriendlyError(result.error || `HTTP ${result.status || '?'}`)}`
  const recipients = (result.deliveries || []).reduce((sum, row) => sum + Number(row.recipients || 0), 0)
  if (!recipients) return 'Server odpověděl OK, ale nenašel žádné aktivní zařízení pro tento účet/roli. Řidič musí nejdřív povolit notifikace na svém zařízení.'
  return `Server push OK: odesláno ${result.sent || 0}, selhalo ${result.failed || 0}, cílová zařízení ${recipients}.`
}
