-- RBSHIFT RLS regression probes.
-- Run from Supabase SQL editor or psql as an owner role. The script rolls back
-- all probe rows and raises an exception if a protected action becomes allowed.

begin;

do $$
declare
  driver_profile_id uuid;
  driver_row_id text;
  staff_profile_id uuid;
  affected int;
begin
  select p.id, d.id
    into driver_profile_id, driver_row_id
  from public.profiles p
  join public.drivers d on d.profile_id = p.id
  where trim(lower(p.role)) = 'driver'
  limit 1;

  select p.id
    into staff_profile_id
  from public.profiles p
  where trim(lower(p.role)) in ('admin', 'dispatcher')
  limit 1;

  if driver_profile_id is null or driver_row_id is null then
    raise exception 'RLS regression needs at least one driver profile linked to drivers.';
  end if;

  if staff_profile_id is null then
    raise exception 'RLS regression needs at least one staff profile.';
  end if;

  perform set_config('request.jwt.claim.sub', driver_profile_id::text, true);
  set local role authenticated;

  begin
    update public.profiles
    set role = 'admin'
    where id = auth.uid();
    get diagnostics affected = row_count;
    if affected > 0 then
      raise exception 'UNEXPECTED_ALLOWED: driver role escalation';
    end if;
  exception when others then
    if sqlerrm like 'UNEXPECTED_ALLOWED:%' then
      raise;
    end if;
  end;

  begin
    insert into public.shifts (id, shift_date, start_time, end_time, driver_id, vehicle_id, type, status, note)
    values ('rls_probe_driver_insert', current_date, '00:00', '01:00', driver_row_id, null, 'day', 'confirmed', 'rollback probe');
    raise exception 'UNEXPECTED_ALLOWED: driver shift insert';
  exception when others then
    if sqlerrm like 'UNEXPECTED_ALLOWED:%' then
      raise;
    end if;
  end;

  reset role;

  insert into public.shifts (id, shift_date, start_time, end_time, driver_id, vehicle_id, type, status, note)
  values
    ('rls_probe_driver_confirm', current_date, '02:00', '03:00', driver_row_id, null, 'day', 'assigned', 'rollback probe'),
    ('rls_probe_driver_rewrite', current_date, '04:00', '05:00', driver_row_id, null, 'day', 'confirmed', 'rollback probe'),
    ('rls_probe_open_claim', current_date, '06:00', '07:00', null, null, 'day', 'open', 'rollback probe');

  perform set_config('request.jwt.claim.sub', driver_profile_id::text, true);
  set local role authenticated;

  update public.shifts
  set status = 'confirmed'
  where id = 'rls_probe_driver_confirm';
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'EXPECTED_ALLOWED_FAILED: driver confirm own shift';
  end if;

  begin
    update public.shifts
    set shift_date = current_date + 1
    where id = 'rls_probe_driver_rewrite';
    get diagnostics affected = row_count;
    if affected > 0 then
      raise exception 'UNEXPECTED_ALLOWED: driver shift rewrite';
    end if;
  exception when others then
    if sqlerrm like 'UNEXPECTED_ALLOWED:%' then
      raise;
    end if;
  end;

  update public.shifts
  set driver_id = driver_row_id, status = 'confirmed'
  where id = 'rls_probe_open_claim';
  get diagnostics affected = row_count;
  if affected > 0 then
    raise exception 'UNEXPECTED_ALLOWED: driver direct open-shift claim';
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', staff_profile_id::text, true);
  set local role authenticated;

  insert into public.shifts (id, shift_date, start_time, end_time, driver_id, vehicle_id, type, status, note)
  values ('rls_probe_staff_insert', current_date, '08:00', '09:00', driver_row_id, null, 'day', 'assigned', 'rollback probe');

  reset role;
end $$;

rollback;

select 'rls_regression_passed' as result;
