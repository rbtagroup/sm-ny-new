-- RBSHIFT Scheduler S1
-- Spusť v Supabase SQL editoru po deployi Edge Function `scheduler`.
--
-- Co dělá:
-- 1) zapne pg_cron, pg_net a vault
-- 2) uloží URL projektu a scheduler secret do Vaultu
-- 3) naplánuje denní kontrolu pokrytí na 07:00 Europe/Prague
--
-- Před spuštěním nahraď:
-- - https://PROJECT_REF.supabase.co
-- - CHANGE_ME_LONG_RANDOM_SECRET
--
-- Stejnou hodnotu CHANGE_ME_LONG_RANDOM_SECRET nastav v Edge Function secrets jako SCHEDULER_SECRET.

create extension if not exists pg_cron with schema cron;
create extension if not exists pg_net with schema net;
create extension if not exists supabase_vault with schema vault;

select vault.create_secret('https://PROJECT_REF.supabase.co', 'project_url')
where not exists (select 1 from vault.decrypted_secrets where name = 'project_url');

select vault.create_secret('CHANGE_ME_LONG_RANDOM_SECRET', 'scheduler_secret')
where not exists (select 1 from vault.decrypted_secrets where name = 'scheduler_secret');

-- Pokud job už existuje, smaž ho a vytvoř znovu.
select cron.unschedule('rbshift-daily-coverage')
where exists (select 1 from cron.job where jobname = 'rbshift-daily-coverage');

select cron.schedule(
  'rbshift-daily-coverage',
  '0 7 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_secret')
    ),
    body := jsonb_build_object(
      'job', 'daily-coverage',
      'source', 'pg_cron',
      'time', now()
    )
  ) as request_id;
  $$
);
