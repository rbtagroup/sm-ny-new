create schema if not exists private;

create or replace function private.rb_guard_profiles_update()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if public.rb_is_admin() then
    return new;
  end if;

  if auth.uid() is null or old.id is distinct from auth.uid() then
    raise exception 'Only admins can update other profiles.';
  end if;

  if new.id is distinct from old.id
    or new.role is distinct from old.role
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Only admins can change protected profile fields.';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
before update on public.profiles
for each row
execute function private.rb_guard_profiles_update();

revoke all on function private.rb_guard_profiles_update() from public;
revoke all on function private.rb_guard_profiles_update() from anon;
revoke all on function private.rb_guard_profiles_update() from authenticated;
revoke all on function private.rb_guard_profiles_update() from service_role;

create or replace function private.rb_guard_shifts_update()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  current_driver text := public.rb_current_driver_id();
  start_was_set boolean := old.actual_start_at is not null or new.actual_start_at is not null;
begin
  if public.rb_is_staff() then
    return new;
  end if;

  if current_driver is null then
    raise exception 'Driver profile is required.';
  end if;

  if old.driver_id is distinct from current_driver then
    raise exception 'Drivers can update only their own shifts.';
  end if;

  if new.id is distinct from old.id
    or new.shift_date is distinct from old.shift_date
    or new.start_time is distinct from old.start_time
    or new.end_time is distinct from old.end_time
    or new.driver_id is distinct from old.driver_id
    or new.vehicle_id is distinct from old.vehicle_id
    or new.type is distinct from old.type
    or new.note is distinct from old.note
    or new.instruction is distinct from old.instruction
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Drivers can update only attendance, response and swap state on own shifts.';
  end if;

  if new.actual_start_at is distinct from old.actual_start_at
    and (
      old.actual_start_at is not null
      or new.actual_start_at is null
      or old.status in ('declined', 'cancelled', 'completed')
      or new.status not in ('confirmed', 'in_progress', 'completed')
    )
  then
    raise exception 'Shift start time cannot be changed once set.';
  end if;

  if new.actual_end_at is distinct from old.actual_end_at
    and (
      old.actual_end_at is not null
      or new.actual_end_at is null
      or not start_was_set
      or new.status <> 'completed'
    )
  then
    raise exception 'Shift end time cannot be changed once set.';
  end if;

  if new.status = 'declined' and (new.actual_start_at is not null or new.actual_end_at is not null) then
    raise exception 'Declined shift cannot have attendance timestamps.';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'confirmed' and old.status in ('assigned', 'draft', 'pending', 'confirmed') then
      -- Allowed: driver confirms an assigned shift.
    elsif new.status = 'declined'
      and old.actual_start_at is null
      and new.actual_start_at is null
      and new.actual_end_at is null
    then
      -- Allowed: driver declines a shift before attendance starts.
    elsif new.status = 'completed'
      and new.actual_end_at is not null
      and start_was_set
    then
      -- Allowed: driver checks out from a started shift.
    else
      raise exception 'Unsupported driver shift status transition.';
    end if;
  end if;

  if new.decline_reason is distinct from old.decline_reason and new.status <> 'declined' then
    raise exception 'Decline reason can be changed only when declining a shift.';
  end if;

  if new.swap_request_status is distinct from old.swap_request_status
    and coalesce(new.swap_request_status, '') not in ('', 'pending', 'accepted', 'cancelled')
  then
    raise exception 'Unsupported driver swap state.';
  end if;

  return new;
end;
$$;

drop trigger if exists shifts_guard_update on public.shifts;
create trigger shifts_guard_update
before update on public.shifts
for each row
execute function private.rb_guard_shifts_update();

revoke all on function private.rb_guard_shifts_update() from public;
revoke all on function private.rb_guard_shifts_update() from anon;
revoke all on function private.rb_guard_shifts_update() from authenticated;
revoke all on function private.rb_guard_shifts_update() from service_role;

drop policy if exists "shifts_insert" on public.shifts;
create policy "shifts_insert"
on public.shifts
as permissive
for insert
to authenticated
with check ((select public.rb_is_staff()));

drop policy if exists "shifts_update" on public.shifts;
create policy "shifts_update"
on public.shifts
as permissive
for update
to authenticated
using (((select public.rb_is_staff()) or (driver_id = (select public.rb_current_driver_id()))))
with check (((select public.rb_is_staff()) or (driver_id = (select public.rb_current_driver_id()))));
