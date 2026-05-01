-- RBSHIFT notification hardening
-- Spustit v Supabase SQL editoru po nasazení nové verze funkcí.
-- Řeší:
-- - payload sloupec pro systémové notifikace
-- - idempotenci daily-coverage a driver-reminder notifikací
-- - užší RLS policies pro notifications

create or replace function public.rb_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$$;

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

grant execute on function public.rb_current_role() to authenticated;
grant execute on function public.rb_is_staff() to authenticated;
grant execute on function public.rb_current_driver_id() to authenticated;

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

grant execute on function public.rb_can_driver_notify_driver(text, text, text) to authenticated;

create or replace function public.rb_guard_notification_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.rb_is_staff() then
    return new;
  end if;

  if new.id is distinct from old.id
    or new.target_driver_id is distinct from old.target_driver_id
    or new.target_role is distinct from old.target_role
    or new.type is distinct from old.type
    or new.shift_id is distinct from old.shift_id
    or new.title is distinct from old.title
    or new.body is distinct from old.body
    or new.payload is distinct from old.payload
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Only read_by can be updated on notifications.';
  end if;

  return new;
end;
$$;

drop trigger if exists notifications_guard_update on public.notifications;
create trigger notifications_guard_update
before update on public.notifications
for each row
execute function public.rb_guard_notification_update();

alter table public.notifications
  add column if not exists payload jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from public.notifications
    where left(type, 15) = 'daily-coverage:' and target_role = 'admin'
    group by type, target_role
    having count(*) > 1
  ) then
    create unique index if not exists notifications_daily_coverage_once
      on public.notifications (type, target_role)
      where left(type, 15) = 'daily-coverage:' and target_role = 'admin';
  else
    raise notice 'Skipping notifications_daily_coverage_once: existing duplicate daily-coverage notifications must be deduplicated first.';
  end if;

  if not exists (
    select 1
    from public.notifications
    where left(type, 23) = 'driver-signup-reminder:' and target_driver_id is not null
    group by type, target_driver_id
    having count(*) > 1
  ) then
    create unique index if not exists notifications_driver_reminder_once
      on public.notifications (type, target_driver_id)
      where left(type, 23) = 'driver-signup-reminder:' and target_driver_id is not null;
  else
    raise notice 'Skipping notifications_driver_reminder_once: existing duplicate driver reminders must be deduplicated first.';
  end if;
end $$;

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
  or target_role in ('all', 'driver_all')
  or target_driver_id = (select public.rb_current_driver_id())
)
with check (
  (select public.rb_is_staff())
  or target_role in ('all', 'driver_all')
  or target_driver_id = (select public.rb_current_driver_id())
);
