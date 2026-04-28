-- ============================================================
-- RBSHIFT v5.4.1 – VOLNÉ SMĚNY / OPEN SHIFTS PATCH
-- Spusť v Supabase SQL Editoru po nasazení v5.4.1.
--
-- Přidává:
-- - status 'open' pro volné směny bez řidiče
-- - target_mode 'open' pro zájem řidiče o volnou směnu
-- - RLS pro čtení volných směn řidiči
-- - RLS pro zájemce uložené v swap_requests
-- ============================================================

alter table public.shifts drop constraint if exists shifts_status_check;
alter table public.shifts
  add constraint shifts_status_check
  check (status in ('open','draft','assigned','confirmed','declined','completed','cancelled'));

alter table public.swap_requests drop constraint if exists swap_requests_target_mode_check;
alter table public.swap_requests
  add constraint swap_requests_target_mode_check
  check (target_mode in ('all','driver','open'));

-- SHIFTS RLS
drop policy if exists "shifts_select_staff_own_or_swap" on public.shifts;
drop policy if exists "shifts_insert_staff" on public.shifts;
drop policy if exists "shifts_insert_driver_own_upsert" on public.shifts;
drop policy if exists "shifts_update_staff" on public.shifts;
drop policy if exists "shifts_update_driver_own" on public.shifts;
drop policy if exists "shifts_delete_staff" on public.shifts;

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
    where sr.target_mode in ('all','open')
       or sr.target_driver_id = (select public.rb_current_driver_id())
       or sr.accepted_by_driver_id = (select public.rb_current_driver_id())
       or sr.driver_id = (select public.rb_current_driver_id())
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

-- SWAP REQUESTS / OPEN SHIFT INTERESTS RLS
drop policy if exists "swap_select_staff_or_involved" on public.swap_requests;
drop policy if exists "swap_insert_signed" on public.swap_requests;
drop policy if exists "swap_update_staff_or_involved" on public.swap_requests;
drop policy if exists "swap_delete_staff" on public.swap_requests;

drop policy if exists "swap_requests_select_authenticated" on public.swap_requests;
drop policy if exists "swap_requests_insert_authenticated" on public.swap_requests;
drop policy if exists "swap_requests_update_authenticated" on public.swap_requests;
drop policy if exists "swap_requests_delete_staff" on public.swap_requests;

alter table public.swap_requests enable row level security;

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

-- REALTIME
alter table public.shifts replica identity full;
alter table public.swap_requests replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.shifts;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.swap_requests;
exception when duplicate_object then null;
end $$;
