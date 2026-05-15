export function appFriendlyError(message = '') {
  const text = String(message || '')
  if (!text) return ''
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
