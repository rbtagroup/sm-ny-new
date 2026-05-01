-- RBSHIFT notification security + Prague-local cron fix
-- Spustit v Supabase SQL editoru po nasazení nové verze:
-- - api/send-push.js na Vercel
-- - Edge Functions scheduler a driver-reminder
--
-- Řeší:
-- 1) řidič nemůže posílat libovolné notifikace jiným řidičům
-- 2) řidič nemůže upravovat globální notifikace
-- 3) daily-coverage běží v 07:00 Europe/Prague
-- 4) driver-reminder běží ve středu v 18:00 Europe/Prague

create extension if not exists pg_cron with schema cron;
create extension if not exists pg_net with schema net;
create extension if not exists supabase_vault with schema vault;

create or replace function public.rb_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and trim(lower(p.role)) in ('admin', 'dispatcher')
  )
$$;

create or replace function public.rb_current_driver_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select d.id
  from public.drivers d
  where d.profile_id = auth.uid()
  limit 1
$$;

create or replace function public.rb_can_driver_notify_driver(
  notice_type text,
  notice_shift_id text,
  notice_target_driver_id text
)
returns boolean
language sql
stable
set search_path = public
as $$
  with me as (
    select public.rb_current_driver_id() as driver_id
  )
  select coalesce((
    select exists (
      select 1
      from me
      where me.driver_id is not null
        and notice_target_driver_id is not null
        and notice_target_driver_id <> me.driver_id
        and exists (
          select 1
          from public.drivers target_driver
          where target_driver.id = notice_target_driver_id
            and target_driver.active is not false
        )
        and (
          (
            notice_type = 'swap-offer'
            and exists (
              select 1
              from public.swap_requests sr
              join public.shifts sh on sh.id = sr.shift_id
              where sr.shift_id = notice_shift_id
                and sh.driver_id = me.driver_id
                and sr.driver_id = me.driver_id
                and sr.status = 'pending'
                and (
                  sr.target_mode = 'all'
                  or sr.target_driver_id = notice_target_driver_id
                )
            )
          )
          or (
            notice_type = 'swap-accepted'
            and exists (
              select 1
              from public.swap_requests sr
              where sr.shift_id = notice_shift_id
                and sr.status = 'accepted'
                and sr.accepted_by_driver_id = me.driver_id
                and sr.driver_id = notice_target_driver_id
            )
          )
        )
    )
  ), false)
$$;

grant execute on function public.rb_is_staff() to authenticated;
grant execute on function public.rb_current_driver_id() to authenticated;
grant execute on function public.rb_can_driver_notify_driver(text, text, text) to authenticated;

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_visible" on public.notifications;
drop policy if exists "notifications_insert_allowed" on public.notifications;
drop policy if exists "notifications_update_visible" on public.notifications;
drop policy if exists "notifications_select_authenticated" on public.notifications;
drop policy if exists "notifications_insert_authenticated" on public.notifications;
drop policy if exists "notifications_update_authenticated" on public.notifications;
drop policy if exists "notifications_insert_signed" on public.notifications;
drop policy if exists "notifications_select" on public.notifications;
drop policy if exists "notifications_insert" on public.notifications;
drop policy if exists "notifications_update" on public.notifications;

create policy "notifications_select_visible"
on public.notifications
for select
to authenticated
using (
  (select public.rb_is_staff())
  or target_role in ('all', 'driver_all')
  or target_driver_id = (select public.rb_current_driver_id())
);

create policy "notifications_insert_allowed"
on public.notifications
for insert
to authenticated
with check (
  (select public.rb_is_staff())
  or (
    auth.uid() is not null
    and (
      (target_driver_id is null and target_role in ('admin', 'dispatcher'))
      or target_driver_id = (select public.rb_current_driver_id())
      or (
        target_role = 'driver'
        and public.rb_can_driver_notify_driver(type, shift_id, target_driver_id)
      )
    )
  )
);

create policy "notifications_update_visible"
on public.notifications
for update
to authenticated
using (
  (select public.rb_is_staff())
  or target_driver_id = (select public.rb_current_driver_id())
)
with check (
  (select public.rb_is_staff())
  or target_driver_id = (select public.rb_current_driver_id())
);

-- daily-coverage: 07:00 Europe/Prague.
-- pg_cron běží v UTC, proto voláme v 05:00 i 06:00 UTC.
-- Edge Function pustí práci jen tehdy, když je v Praze lokálně 07:xx.
select cron.unschedule('rbshift-daily-coverage')
where exists (select 1 from cron.job where jobname = 'rbshift-daily-coverage');

select cron.schedule(
  'rbshift-daily-coverage',
  '0 5,6 * * *',
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
      'expectedLocalHour', 7,
      'time', now()
    )
  ) as request_id;
  $$
);

-- driver-reminder: středa 18:00 Europe/Prague.
insert into public.app_settings (id, payload)
values ('default', jsonb_build_object('driverReminderSchedule', '0 18 * * 3'))
on conflict (id) do update
set
  payload = public.app_settings.payload || jsonb_build_object('driverReminderSchedule', '0 18 * * 3'),
  updated_at = now();

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

grant execute on function public.refresh_driver_reminder_cron() to authenticated;

select public.refresh_driver_reminder_cron();
