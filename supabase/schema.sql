-- RBSHIFT v5 online schema
-- Spustit v Supabase SQL editoru. Tabulky aplikace používají textové ID, aby šla převést lokální data z demo verze bez migrací UUID.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'driver' check (role in ('driver', 'dispatcher', 'admin')),
  full_name text not null,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists public.drivers (
  id text primary key,
  profile_id uuid references public.profiles(id) on delete set null,
  name text not null,
  phone text,
  email text,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id text primary key,
  name text not null,
  plate text not null,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shifts (
  id text primary key,
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  driver_id text references public.drivers(id) on delete set null,
  vehicle_id text references public.vehicles(id) on delete set null,
  type text not null default 'day',
  status text not null default 'assigned' check (status in ('open','draft','assigned','confirmed','declined','completed','cancelled')),
  note text,
  instruction text,
  decline_reason text,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  swap_request_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.absences (
  id text primary key,
  driver_id text not null references public.drivers(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.availability (
  id text primary key,
  driver_id text not null references public.drivers(id) on delete cascade,
  weekday int check (weekday between 0 and 6),
  avail_date date,
  start_time time not null,
  end_time time not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.service_blocks (
  id text primary key,
  vehicle_id text not null references public.vehicles(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.swap_requests (
  id text primary key,
  shift_id text references public.shifts(id) on delete cascade,
  driver_id text references public.drivers(id) on delete cascade,
  target_mode text not null default 'all' check (target_mode in ('all','driver','open')),
  target_driver_id text references public.drivers(id) on delete set null,
  accepted_by_driver_id text references public.drivers(id) on delete set null,
  approved_driver_id text references public.drivers(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','accepted','approved','rejected','cancelled')),
  reason text,
  rejected_reason text,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  resolved_at timestamptz,
  cancelled_at timestamptz
);

create table if not exists public.notifications (
  id text primary key,
  target_driver_id text references public.drivers(id) on delete cascade,
  target_role text not null default 'admin',
  type text not null default 'info',
  shift_id text references public.shifts(id) on delete set null,
  title text not null,
  body text,
  read_by jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id text primary key,
  profile_id uuid references public.profiles(id) on delete cascade,
  driver_id text references public.drivers(id) on delete cascade,
  role text not null default 'driver',
  endpoint text not null unique,
  subscription jsonb not null,
  platform text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id text primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  id text primary key default 'default',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.shifts enable row level security;
alter table public.absences enable row level security;
alter table public.availability enable row level security;
alter table public.service_blocks enable row level security;
alter table public.swap_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_settings enable row level security;

create or replace function public.current_role()
returns text
language sql
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_driver_id()
returns text
language sql
stable
as $$
  select id from public.drivers where profile_id = auth.uid() limit 1
$$;

-- Profiles
create policy "profiles_select_self_or_staff" on public.profiles for select using (id = auth.uid() or public.current_role() in ('dispatcher','admin'));
create policy "profiles_insert_self_driver" on public.profiles for insert with check (id = auth.uid() and role = 'driver');
create policy "profiles_admin_manage" on public.profiles for all using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

-- Drivers / vehicles
create policy "drivers_select_signed" on public.drivers for select using (auth.uid() is not null);
create policy "drivers_staff_manage" on public.drivers for all using (public.current_role() in ('dispatcher','admin')) with check (public.current_role() in ('dispatcher','admin'));
create policy "drivers_update_own" on public.drivers for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy "vehicles_select_signed" on public.vehicles for select using (auth.uid() is not null);
create policy "vehicles_staff_manage" on public.vehicles for all using (public.current_role() in ('dispatcher','admin')) with check (public.current_role() in ('dispatcher','admin'));

-- Shifts
create policy "shifts_select_staff_own_or_swap" on public.shifts for select using (
  public.current_role() in ('dispatcher','admin')
  or status = 'open'
  or driver_id = public.current_driver_id()
  or id in (select shift_id from public.swap_requests where target_mode = 'all' or target_driver_id = public.current_driver_id() or accepted_by_driver_id = public.current_driver_id())
);
create policy "shifts_staff_manage" on public.shifts for all using (public.current_role() in ('dispatcher','admin')) with check (public.current_role() in ('dispatcher','admin'));
create policy "shifts_driver_update_own" on public.shifts for update using (driver_id = public.current_driver_id()) with check (driver_id = public.current_driver_id());

-- Availability and absences
create policy "absences_select_staff_or_own" on public.absences for select using (public.current_role() in ('dispatcher','admin') or driver_id = public.current_driver_id());
create policy "absences_insert_staff_or_own" on public.absences for insert with check (public.current_role() in ('dispatcher','admin') or driver_id = public.current_driver_id());
create policy "absences_update_delete_staff_or_own" on public.absences for all using (public.current_role() in ('dispatcher','admin') or driver_id = public.current_driver_id()) with check (public.current_role() in ('dispatcher','admin') or driver_id = public.current_driver_id());

create policy "availability_select_staff_or_own" on public.availability for select using (public.current_role() in ('dispatcher','admin') or driver_id = public.current_driver_id());
create policy "availability_insert_staff_or_own" on public.availability for insert with check (public.current_role() in ('dispatcher','admin') or driver_id = public.current_driver_id());
create policy "availability_update_delete_staff_or_own" on public.availability for all using (public.current_role() in ('dispatcher','admin') or driver_id = public.current_driver_id()) with check (public.current_role() in ('dispatcher','admin') or driver_id = public.current_driver_id());

-- Service blocks
create policy "service_blocks_select_signed" on public.service_blocks for select using (auth.uid() is not null);
create policy "service_blocks_staff_manage" on public.service_blocks for all using (public.current_role() in ('dispatcher','admin')) with check (public.current_role() in ('dispatcher','admin'));

-- Swap requests
create policy "swap_select_staff_or_involved" on public.swap_requests for select using (
  public.current_role() in ('dispatcher','admin')
  or status = 'open'
  or driver_id = public.current_driver_id()
  or target_driver_id = public.current_driver_id()
  or accepted_by_driver_id = public.current_driver_id()
  or target_mode in ('all','open')
);
create policy "swap_insert_signed" on public.swap_requests for insert with check (auth.uid() is not null);
create policy "swap_update_staff_or_involved" on public.swap_requests for update using (
  public.current_role() in ('dispatcher','admin')
  or status = 'open'
  or driver_id = public.current_driver_id()
  or target_driver_id = public.current_driver_id()
  or target_mode = 'all'
) with check (auth.uid() is not null);
create policy "swap_delete_staff" on public.swap_requests for delete using (public.current_role() in ('dispatcher','admin'));

-- Notifications
create policy "notifications_select_visible" on public.notifications for select using (
  public.current_role() in ('dispatcher','admin')
  or target_role in ('all','driver_all')
  or target_driver_id = public.current_driver_id()
);
create policy "notifications_insert_signed" on public.notifications for insert with check (auth.uid() is not null);
create policy "notifications_update_visible" on public.notifications for update using (
  public.current_role() in ('dispatcher','admin')
  or target_role in ('all','driver_all')
  or target_driver_id = public.current_driver_id()
) with check (auth.uid() is not null);

-- Push subscriptions
create policy "push_select_own_or_staff" on public.push_subscriptions for select using (public.current_role() in ('dispatcher','admin') or profile_id = auth.uid());
create policy "push_insert_own" on public.push_subscriptions for insert with check (profile_id = auth.uid() or public.current_role() in ('dispatcher','admin'));
create policy "push_update_own_or_staff" on public.push_subscriptions for update using (profile_id = auth.uid() or public.current_role() in ('dispatcher','admin')) with check (profile_id = auth.uid() or public.current_role() in ('dispatcher','admin'));

-- Audit / settings
create policy "audit_select_staff" on public.audit_logs for select using (public.current_role() in ('dispatcher','admin'));
create policy "audit_insert_signed" on public.audit_logs for insert with check (auth.uid() is not null);
create policy "settings_select_signed" on public.app_settings for select using (auth.uid() is not null);
create policy "settings_staff_manage" on public.app_settings for all using (public.current_role() in ('dispatcher','admin')) with check (public.current_role() in ('dispatcher','admin'));

-- První admin po vytvoření účtu:
-- update public.profiles set role = 'admin', full_name = 'Admin RB Taxi' where id = '<UUID uživatele>';


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
