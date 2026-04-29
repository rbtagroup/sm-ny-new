-- RBSHIFT driver-signup-reminder manual test
-- Spusť v Supabase SQL editoru po deployi Edge Function `driver-reminder`.
--
-- Před spuštěním nahraď:
-- - https://PROJECT_REF.supabase.co
-- - CHANGE_ME_LONG_RANDOM_SECRET
--
-- Test akceptačních kritérií:
-- 1) spusť poprvé => vzniknou notifikace pro aktivní řidiče, pokud existují volné směny
-- 2) spusť podruhé ve stejný den => nevzniknou duplicity

alter table public.notifications
add column if not exists payload jsonb not null default '{}'::jsonb;

select net.http_post(
  url := 'https://PROJECT_REF.supabase.co/functions/v1/driver-reminder',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-driver-reminder-secret', 'CHANGE_ME_LONG_RANDOM_SECRET'
  ),
  body := jsonb_build_object(
    'job', 'driver-signup-reminder',
    'source', 'manual-sql-test',
    'time', now()
  )
) as request_id;

-- Odpověď Edge Function:
select *
from net._http_response
order by created desc
limit 10;

-- Kontrola notifikací za dnešek:
select
  id,
  target_driver_id,
  target_role,
  type,
  title,
  body,
  payload,
  created_at
from public.notifications
where type = 'driver-signup-reminder:' || to_char(now() at time zone 'Europe/Prague', 'YYYY-MM-DD')
order by created_at desc;

-- Kontrola audit logu:
select
  id,
  action,
  payload,
  created_at
from public.audit_logs
where action = 'driver-signup-reminder-sent'
order by created_at desc
limit 10;
