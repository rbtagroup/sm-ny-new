-- ============================================================
-- RBSHIFT + Výčetka produkční integrace
-- Spouštět až po základním schema.sql + rls-final-fix.sql.
-- ============================================================

create table if not exists public.shift_settlements (
  id text primary key,
  shift_id text not null references public.shifts(id) on delete cascade,
  driver_id text references public.drivers(id),
  vehicle_id text references public.vehicles(id),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'returned')),
  inputs jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  note text,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by text,
  returned_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shift_id)
);

create index if not exists shift_settlements_driver_id_idx on public.shift_settlements(driver_id);
create index if not exists shift_settlements_status_idx on public.shift_settlements(status);
create index if not exists shift_settlements_submitted_at_idx on public.shift_settlements(submitted_at desc);

create or replace function public.rb_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists shift_settlements_updated_at on public.shift_settlements;
create trigger shift_settlements_updated_at
before update on public.shift_settlements
for each row
execute function public.rb_set_updated_at();

alter table public.shift_settlements enable row level security;

drop policy if exists "shift_settlements_select_own_or_staff" on public.shift_settlements;
drop policy if exists "shift_settlements_insert_own_or_staff" on public.shift_settlements;
drop policy if exists "shift_settlements_update_own_or_staff" on public.shift_settlements;
drop policy if exists "shift_settlements_delete_staff" on public.shift_settlements;

create policy "shift_settlements_select_own_or_staff"
on public.shift_settlements
for select
to authenticated
using (
  (select public.rb_is_staff())
  or driver_id = (select public.rb_current_driver_id())
);

create policy "shift_settlements_insert_own_or_staff"
on public.shift_settlements
for insert
to authenticated
with check (
  (select public.rb_is_staff())
  or (
    driver_id = (select public.rb_current_driver_id())
    and status in ('draft', 'submitted')
    and exists (
      select 1
      from public.shifts sh
      where sh.id = shift_id
        and sh.driver_id = (select public.rb_current_driver_id())
    )
  )
);

create policy "shift_settlements_update_own_or_staff"
on public.shift_settlements
for update
to authenticated
using (
  (select public.rb_is_staff())
  or (
    driver_id = (select public.rb_current_driver_id())
    and status <> 'approved'
  )
)
with check (
  (select public.rb_is_staff())
  or (
    driver_id = (select public.rb_current_driver_id())
    and status in ('draft', 'submitted', 'returned')
  )
);

create policy "shift_settlements_delete_staff"
on public.shift_settlements
for delete
to authenticated
using ((select public.rb_is_staff()));

alter table public.shift_settlements replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.shift_settlements;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
