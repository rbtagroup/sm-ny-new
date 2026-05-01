-- ============================================================
-- RBSHIFT – FINAL RLS PATCH
-- Použití:
-- 1) Nejdřív spusť základní schema: supabase/schema.sql
-- 2) Potom spusť tento patch v Supabase SQL Editoru.
--
-- Řeší:
-- - profiles infinite recursion
-- - ukládání směn adminem/dispečerem
-- - potvrzení/odmítnutí směny řidičem
-- - zápis notifikací
-- - zápis audit logů
-- ============================================================


-- ============================================================
-- 1) HELPER FUNKCE
-- ============================================================

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

create or replace function public.rb_is_admin()
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
      and trim(lower(p.role)) = 'admin'
  )
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
grant execute on function public.rb_is_admin() to authenticated;
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

create or replace function public.rb_push_subscription_matches_profile(
  subscription_profile_id uuid,
  subscription_driver_id text,
  subscription_role text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when trim(lower(p.role)) = 'driver' then
        trim(lower(subscription_role)) = 'driver'
        and subscription_driver_id is not null
        and exists (
          select 1
          from public.drivers d
          where d.id = subscription_driver_id
            and d.profile_id = p.id
            and d.active is not false
        )
      when trim(lower(p.role)) in ('admin', 'dispatcher') then
        trim(lower(subscription_role)) = trim(lower(p.role))
        and subscription_driver_id is null
      else false
    end
    from public.profiles p
    where p.id = auth.uid()
      and p.id = subscription_profile_id
    limit 1
  ), false)
$$;

grant execute on function public.rb_push_subscription_matches_profile(uuid, text, text) to authenticated;


-- ============================================================
-- 1B) KOMPATIBILITA PRO VOLNÉ SMĚNY v5.4.1
-- ============================================================

alter table public.shifts drop constraint if exists shifts_status_check;
alter table public.shifts
  add constraint shifts_status_check
  check (status in ('open','draft','assigned','confirmed','declined','completed','cancelled'));

alter table public.swap_requests drop constraint if exists swap_requests_target_mode_check;
alter table public.swap_requests
  add constraint swap_requests_target_mode_check
  check (target_mode in ('all','driver','open'));

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



-- ============================================================
-- 2) PROFILES RLS
-- ============================================================

drop policy if exists "profiles_select_self_or_staff" on public.profiles;
drop policy if exists "profiles_insert_self_driver" on public.profiles;
drop policy if exists "profiles_admin_manage" on public.profiles;
drop policy if exists "profiles_admin_staff" on public.profiles;
drop policy if exists "profiles_staff_select" on public.profiles;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own_driver" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_admin_all" on public.profiles;

alter table public.profiles enable row level security;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "profiles_staff_select"
on public.profiles
for select
to authenticated
using ((select public.rb_is_staff()));

create policy "profiles_insert_own_driver"
on public.profiles
for insert
to authenticated
with check (id = auth.uid() and trim(lower(role)) = 'driver');

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "profiles_admin_all"
on public.profiles
for all
to authenticated
using ((select public.rb_is_admin()))
with check ((select public.rb_is_admin()));


-- ============================================================
-- 3) SHIFTS RLS
-- ============================================================

drop policy if exists "shifts_select_staff_own_or_swap" on public.shifts;
drop policy if exists "shifts_insert_staff" on public.shifts;
drop policy if exists "shifts_update_staff" on public.shifts;
drop policy if exists "shifts_update_driver_own" on public.shifts;
drop policy if exists "shifts_driver_update_own" on public.shifts;
drop policy if exists "shifts_driver_confirm_own" on public.shifts;
drop policy if exists "shifts_insert_driver_own_upsert" on public.shifts;
drop policy if exists "shifts_delete_staff" on public.shifts;

drop policy if exists "shifts_select" on public.shifts;
drop policy if exists "shifts_insert" on public.shifts;
drop policy if exists "shifts_update" on public.shifts;
drop policy if exists "shifts_delete" on public.shifts;

alter table public.shifts enable row level security;

create policy "shifts_select_staff_own_or_swap"
on public.shifts
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and trim(lower(p.role)) in ('admin', 'dispatcher')
  )
  or status = 'open'
  or driver_id = (select public.rb_current_driver_id())
  or id in (
    select sr.shift_id
    from public.swap_requests sr
    where sr.target_mode = 'all'
       or sr.target_driver_id = (select public.rb_current_driver_id())
       or sr.accepted_by_driver_id = (select public.rb_current_driver_id())
  )
);

create policy "shifts_insert_staff"
on public.shifts
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and trim(lower(p.role)) in ('admin', 'dispatcher')
  )
);

-- Kvůli upsertu při potvrzení/odmítnutí vlastní směny řidičem.
create policy "shifts_insert_driver_own_upsert"
on public.shifts
for insert
to authenticated
with check (
  driver_id = (select public.rb_current_driver_id())
);

create policy "shifts_update_staff"
on public.shifts
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and trim(lower(p.role)) in ('admin', 'dispatcher')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and trim(lower(p.role)) in ('admin', 'dispatcher')
  )
);

create policy "shifts_update_driver_own"
on public.shifts
for update
to authenticated
using (
  driver_id = (select public.rb_current_driver_id())
)
with check (
  driver_id = (select public.rb_current_driver_id())
);

create policy "shifts_delete_staff"
on public.shifts
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and trim(lower(p.role)) in ('admin', 'dispatcher')
  )
);




-- ============================================================
-- 3B) SWAP REQUESTS / OPEN SHIFT INTERESTS RLS
-- ============================================================

drop policy if exists "swap_select_staff_or_involved" on public.swap_requests;
drop policy if exists "swap_insert_signed" on public.swap_requests;
drop policy if exists "swap_update_staff_or_involved" on public.swap_requests;
drop policy if exists "swap_delete_staff" on public.swap_requests;

drop policy if exists "swap_requests_select_authenticated" on public.swap_requests;
drop policy if exists "swap_requests_insert_authenticated" on public.swap_requests;
drop policy if exists "swap_requests_update_authenticated" on public.swap_requests;
drop policy if exists "swap_requests_delete_staff" on public.swap_requests;

alter table public.swap_requests enable row level security;

-- Uvolněno kvůli upsert/live sync chování aplikace a volným směnám.
create policy "swap_requests_select_authenticated"
on public.swap_requests
for select
to authenticated
using (auth.uid() is not null);

create policy "swap_requests_insert_authenticated"
on public.swap_requests
for insert
to authenticated
with check (auth.uid() is not null);

create policy "swap_requests_update_authenticated"
on public.swap_requests
for update
to authenticated
using (auth.uid() is not null)
with check (auth.uid() is not null);

create policy "swap_requests_delete_staff"
on public.swap_requests
for delete
to authenticated
using ((select public.rb_is_staff()));


-- ============================================================
-- 4) NOTIFICATIONS RLS
-- ============================================================

drop policy if exists "notifications_select_visible" on public.notifications;
drop policy if exists "notifications_insert_allowed" on public.notifications;
drop policy if exists "notifications_update_visible" on public.notifications;
drop policy if exists "notifications_select_authenticated" on public.notifications;
drop policy if exists "notifications_insert_authenticated" on public.notifications;
drop policy if exists "notifications_update_authenticated" on public.notifications;
drop policy if exists "notifications_delete_staff" on public.notifications;

drop policy if exists "notifications_insert_signed" on public.notifications;
drop policy if exists "notifications_select" on public.notifications;
drop policy if exists "notifications_insert" on public.notifications;
drop policy if exists "notifications_update" on public.notifications;
drop policy if exists "notifications_delete" on public.notifications;

alter table public.notifications enable row level security;

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

create policy "notifications_delete_staff"
on public.notifications
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and trim(lower(p.role)) in ('admin', 'dispatcher')
  )
);


-- ============================================================
-- 5) PUSH SUBSCRIPTIONS RLS
-- ============================================================

drop policy if exists "push_select_own_or_staff" on public.push_subscriptions;
drop policy if exists "push_insert_own" on public.push_subscriptions;
drop policy if exists "push_update_own_or_staff" on public.push_subscriptions;
drop policy if exists "push_delete_staff" on public.push_subscriptions;

drop policy if exists "push_subscriptions_select_own_or_staff" on public.push_subscriptions;
drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
drop policy if exists "push_subscriptions_update_own_or_staff" on public.push_subscriptions;
drop policy if exists "push_subscriptions_delete_staff" on public.push_subscriptions;

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions_select_own_or_staff"
on public.push_subscriptions
for select
to authenticated
using (
  profile_id = auth.uid()
  or (select public.rb_is_staff())
);

create policy "push_subscriptions_insert_own"
on public.push_subscriptions
for insert
to authenticated
with check (
  (select public.rb_is_staff())
  or public.rb_push_subscription_matches_profile(profile_id, driver_id, role)
);

create policy "push_subscriptions_update_own_or_staff"
on public.push_subscriptions
for update
to authenticated
using (
  profile_id = auth.uid()
  or (select public.rb_is_staff())
)
with check (
  (select public.rb_is_staff())
  or public.rb_push_subscription_matches_profile(profile_id, driver_id, role)
);

create policy "push_subscriptions_delete_staff"
on public.push_subscriptions
for delete
to authenticated
using ((select public.rb_is_staff()));

-- ============================================================
-- 6) AUDIT LOGS RLS
-- ============================================================

drop policy if exists "audit_select_staff" on public.audit_logs;
drop policy if exists "audit_insert_signed" on public.audit_logs;

drop policy if exists "audit_logs_select_staff" on public.audit_logs;
drop policy if exists "audit_logs_select_authenticated" on public.audit_logs;
drop policy if exists "audit_logs_insert_authenticated" on public.audit_logs;
drop policy if exists "audit_logs_update_authenticated" on public.audit_logs;
drop policy if exists "audit_logs_delete_staff" on public.audit_logs;

drop policy if exists "audit_logs_select" on public.audit_logs;
drop policy if exists "audit_logs_insert" on public.audit_logs;
drop policy if exists "audit_logs_update" on public.audit_logs;
drop policy if exists "audit_logs_delete" on public.audit_logs;

alter table public.audit_logs enable row level security;

-- Uvolněno kvůli aktuálnímu upsert/select chování aplikace.
create policy "audit_logs_select_authenticated"
on public.audit_logs
for select
to authenticated
using (auth.uid() is not null);

create policy "audit_logs_insert_authenticated"
on public.audit_logs
for insert
to authenticated
with check (auth.uid() is not null);

create policy "audit_logs_update_authenticated"
on public.audit_logs
for update
to authenticated
using (auth.uid() is not null)
with check (auth.uid() is not null);

create policy "audit_logs_delete_staff"
on public.audit_logs
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and trim(lower(p.role)) in ('admin', 'dispatcher')
  )
);




-- ============================================================
-- 7) REALTIME / LIVE SYNC
-- ============================================================
-- Důležité pro to, aby dispečer/admin viděl potvrzení, odmítnutí,
-- výměny a zrušení směn bez ručního refresh aplikace.
-- Pokud tabulka už v publikaci je, chyba se ignoruje.

alter table public.drivers replica identity full;
alter table public.vehicles replica identity full;
alter table public.shifts replica identity full;
alter table public.absences replica identity full;
alter table public.availability replica identity full;
alter table public.service_blocks replica identity full;
alter table public.swap_requests replica identity full;
alter table public.notifications replica identity full;
alter table public.push_subscriptions replica identity full;
alter table public.audit_logs replica identity full;
alter table public.app_settings replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.drivers;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.vehicles;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.shifts;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.absences;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.availability;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.service_blocks;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.swap_requests;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.push_subscriptions;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.audit_logs;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.app_settings;
exception when duplicate_object then null;
end $$;

-- ============================================================
-- 8) KONTROLA POLICIES
-- ============================================================

select
  schemaname,
  tablename,
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'shifts', 'notifications', 'push_subscriptions', 'audit_logs')
order by tablename, policyname;


-- ============================================================
-- RBSHIFT v5.4.5 – UX CLEANUP / AVAILABILITY DATE PATCH
-- Přidává možnost dostupnosti na konkrétní datum.
-- Spusť v Supabase SQL Editoru po nasazení v5.4.5.
-- ============================================================

alter table public.availability
  add column if not exists avail_date date;

alter table public.availability
  alter column weekday drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'availability_weekday_or_date_check'
  ) then
    alter table public.availability
      add constraint availability_weekday_or_date_check
      check (
        (avail_date is not null and weekday is null)
        or
        (avail_date is null and weekday between 0 and 6)
      );
  end if;
end $$;
-- ============================================================
-- RBSHIFT v5.4.7 – SENIOR REFACTOR PATCH
-- Přidává DateTime Range dostupnost řidičů.
-- Spusť po nasazení v5.4.7.
-- ============================================================

alter table public.availability
  add column if not exists from_at timestamptz,
  add column if not exists to_at timestamptz;

alter table public.availability
  alter column weekday drop not null;

alter table public.availability
  alter column avail_date drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'availability_datetime_range_check'
  ) then
    alter table public.availability
      add constraint availability_datetime_range_check
      check (
        (from_at is not null and to_at is not null and to_at > from_at)
        or
        (from_at is null and to_at is null)
      );
  end if;
end $$;
