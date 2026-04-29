-- RBSHIFT driver reminder UI helper
-- Spusť v Supabase SQL editoru, pokud UI po uložení hlásí, že nemůže zavolat refresh_driver_reminder_cron().
--
-- Funkce refresh_driver_reminder_cron vzniká v supabase/driver-reminder-cron.sql.
-- Tady jen povolíme její volání přihlášeným uživatelům aplikace.

grant execute on function public.refresh_driver_reminder_cron() to authenticated;
