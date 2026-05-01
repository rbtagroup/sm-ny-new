-- RBSHIFT driver-signup-reminder
-- Spusť v Supabase SQL editoru po deployi Edge Function `driver-reminder`.
--
-- Job:
-- - driver-signup-reminder
-- - default cron: každou středu v 18:00 => 0 18 * * 3
-- - cron expression se ukládá do app_settings.payload.driverReminderSchedule
--
-- Poznámka k timezone:
-- pg_cron běží v UTC. Pro výchozí středu 18:00 Europe/Prague se job
-- plánuje na oba možné UTC časy (zimní/letní čas) a Edge Function sama
-- pustí práci jen ve středu v 18:xx pražského času.
--
-- Před spuštěním nahraď:
-- - https://PROJECT_REF.supabase.co
-- - CHANGE_ME_LONG_RANDOM_SECRET
--
-- Stejnou hodnotu CHANGE_ME_LONG_RANDOM_SECRET nastav v Edge Function secrets:
-- npx supabase secrets set DRIVER_REMINDER_SECRET="CHANGE_ME_LONG_RANDOM_SECRET"

create extension if not exists pg_cron with schema cron;
create extension if not exists pg_net with schema net;
create extension if not exists supabase_vault with schema vault;

-- Aktuální notifications schema v projektu nemá payload.
-- Tento job ho potřebuje pro metadata notifikace, proto přidáváme kompatibilní jsonb sloupec.
alter table public.notifications
add column if not exists payload jsonb not null default '{}'::jsonb;

insert into public.app_settings (id, payload)
values ('default', jsonb_build_object('driverReminderSchedule', '0 18 * * 3'))
on conflict (id) do update
set
  payload = public.app_settings.payload || jsonb_build_object('driverReminderSchedule', '0 18 * * 3'),
  updated_at = now();

select vault.create_secret('https://PROJECT_REF.supabase.co', 'project_url')
where not exists (select 1 from vault.decrypted_secrets where name = 'project_url');

select vault.create_secret('CHANGE_ME_LONG_RANDOM_SECRET', 'driver_reminder_secret')
where not exists (select 1 from vault.decrypted_secrets where name = 'driver_reminder_secret');

-- Helper: kdykoliv se změní app_settings.payload.driverReminderSchedule,
-- stačí znovu zavolat select public.refresh_driver_reminder_cron();
create or replace function public.refresh_driver_reminder_cron()
returns text
language plpgsql
security definer
as $$
declare
  cron_expr text;
  cron_schedule text;
begin
  select coalesce(payload->>'driverReminderSchedule', '0 18 * * 3')
  into cron_expr
  from public.app_settings
  where id = 'default';

  cron_expr := coalesce(nullif(trim(cron_expr), ''), '0 18 * * 3');
  cron_schedule := case
    when cron_expr = '0 18 * * 3' then '0 16,17 * * 3'
    else cron_expr
  end;

  if exists (select 1 from cron.job where jobname = 'rbshift-driver-signup-reminder') then
    perform cron.unschedule('rbshift-driver-signup-reminder');
  end if;

  perform cron.schedule(
    'rbshift-driver-signup-reminder',
    cron_schedule,
    $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/driver-reminder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-driver-reminder-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'driver_reminder_secret')
      ),
      body := jsonb_build_object(
        'job', 'driver-signup-reminder',
        'source', 'pg_cron',
        'expectedLocalHour', 18,
        'expectedLocalWeekday', 'Wed',
        'time', now()
      )
    ) as request_id;
    $job$
  );

  return cron_expr;
end;
$$;

select public.refresh_driver_reminder_cron();
