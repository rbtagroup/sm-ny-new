export function appFriendlyError(message = '') {
  const text = String(message || '')
  if (!text) return ''
  if (/schema cache|relation .* does not exist|function .* does not exist|column .* does not exist|PGRST\d+/i.test(text)) {
    return 'Aplikace a databáze nejsou ve stejné verzi. Obnov aplikaci, případně kontaktuj dispečink.'
  }
  if (/rate limit|too many notifications|too many push recipients|too many recipients|429/i.test(text)) {
    return 'Push notifikace jsou dočasně omezené kvůli většímu počtu požadavků. Chvíli počkej a zkus to znovu.'
  }
  if (/forbidden notification target|forbidden/i.test(text)) {
    return 'Nemáš oprávnění poslat tuto notifikaci vybranému příjemci.'
  }
  if (/^gone$|push subscription.*gone|subscription.*expired|push.*expired|web push.*410|status code.*410|HTTP 410/i.test(text)) {
    return 'Push povolení na zařízení už není platné. Odpoj zařízení a nech řidiče znovu povolit notifikace.'
  }
  if (/missing SUPABASE|missing VAPID|missing .*SERVICE_ROLE|missing .*PRIVATE_KEY|missing-vapid|supabase-not-configured|backend.*config/i.test(text)) {
    return 'Server pro push notifikace není správně nakonfigurovaný. Zkontroluj nastavení ve Vercelu.'
  }
  if (/authentication required|missing-auth-token|401|unauthorized/i.test(text)) {
    return 'Přihlášení vypršelo. Obnov aplikaci a přihlas se znovu.'
  }
  if (/row-level security|violates|permission denied|not authorized|42501|audit_logs|notifications|shifts|profiles|drivers|settlements|swap_requests/i.test(text)) {
    return 'Akci se nepodařilo uložit kvůli oprávnění. Obnov aplikaci a zkus to znovu, případně kontaktuj dispečink.'
  }
  if (/invalid login credentials|email not confirmed|invalid credentials/i.test(text)) {
    return 'Přihlášení se nepodařilo. Zkontroluj e-mail a heslo.'
  }
  if (/user already registered|already registered|already exists/i.test(text)) {
    return 'Účet pro tento e-mail už existuje. Přihlas se původním účtem.'
  }
  if (/password.*characters|weak password|password should/i.test(text)) {
    return 'Heslo je příliš krátké nebo slabé. Zvol alespoň 6 znaků.'
  }
  if (/failed to fetch|network|load failed|timeout|aborted/i.test(text)) {
    return 'Spojení se serverem vypadlo. Zkontroluj internet a zkus akci zopakovat.'
  }
  if (/jwt|token|auth|session|not logged/i.test(text)) {
    return 'Přihlášení vypršelo. Odhlas se a přihlas znovu.'
  }
  if (/duplicate key|unique constraint/i.test(text)) {
    return 'Tahle akce už je uložená. Obnov aplikaci pro aktuální stav.'
  }
  return text
}
