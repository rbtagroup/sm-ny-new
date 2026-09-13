-- RBSHIFT RLS regression probes.
-- Run from Supabase SQL editor or psql as an owner role. The script rolls back
-- all probe rows and raises an exception if a protected action becomes allowed.

begin;

do $$
declare
  driver_profile_id uuid;
  driver_row_id text;
  other_driver_profile_id uuid;
  other_driver_row_id text;
  staff_profile_id uuid;
  admin_profile_id uuid;
  dispatcher_profile_id uuid;
  login_probe_driver_id text;
  login_probe_profile_id uuid;
  login_probe_shift_count int;
  removed_shift_ids text[];
  affected int;
begin
  select p.id, d.id
    into driver_profile_id, driver_row_id
  from public.profiles p
  join public.drivers d on d.profile_id = p.id
  where trim(lower(p.role)) = 'driver'
    and d.active is distinct from false
  limit 1;

  select p.id, d.id
    into other_driver_profile_id, other_driver_row_id
  from public.profiles p
  join public.drivers d on d.profile_id = p.id
  where d.id <> driver_row_id
    and d.active is distinct from false
    and trim(lower(p.role)) = 'driver'
  limit 1;

  select p.id
    into staff_profile_id
  from public.profiles p
  where trim(lower(p.role)) in ('admin', 'dispatcher')
  limit 1;

  select p.id
    into admin_profile_id
  from public.profiles p
  where trim(lower(p.role)) = 'admin'
  limit 1;

  select p.id
    into dispatcher_profile_id
  from public.profiles p
  where trim(lower(p.role)) = 'dispatcher'
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
    ('rls_probe_driver_decline', current_date, '03:00', '04:00', driver_row_id, null, 'day', 'assigned', 'rollback probe'),
    ('rls_probe_driver_rewrite', current_date, '04:00', '05:00', driver_row_id, null, 'day', 'confirmed', 'rollback probe'),
    ('rls_probe_swap_targeted_shift', current_date, '05:00', '06:00', driver_row_id, null, 'day', 'confirmed', 'rollback probe'),
    ('rls_probe_swap_all_shift', current_date, '05:30', '06:30', driver_row_id, null, 'day', 'confirmed', 'rollback probe'),
    ('rls_probe_open_claim', current_date, '06:00', '07:00', null, null, 'day', 'open', 'rollback probe');

  insert into public.notifications (id, target_driver_id, target_role, type, title, body, read_by, deleted_by)
  values ('rls_probe_driver_notice', driver_row_id, 'driver', 'info', 'RLS probe', 'rollback probe', '[]'::jsonb, '[]'::jsonb);

  perform set_config('request.jwt.claim.sub', driver_profile_id::text, true);
  set local role authenticated;

  update public.shifts
  set status = 'confirmed'
  where id = 'rls_probe_driver_confirm';
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'EXPECTED_ALLOWED_FAILED: driver confirm own shift';
  end if;

  update public.shifts
  set status = 'declined',
      decline_reason = 'RLS probe decline'
  where id = 'rls_probe_driver_decline';
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'EXPECTED_ALLOWED_FAILED: driver decline own shift';
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

  update public.notifications
  set read_by = jsonb_build_array(jsonb_build_object('driverId', driver_row_id, 'at', now()))
  where id = 'rls_probe_driver_notice';
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'EXPECTED_ALLOWED_FAILED: driver notification read state update';
  end if;

  begin
    update public.notifications
    set title = 'RLS probe rewrite'
    where id = 'rls_probe_driver_notice';
    get diagnostics affected = row_count;
    if affected > 0 then
      raise exception 'UNEXPECTED_ALLOWED: driver notification title rewrite';
    end if;
  exception when others then
    if sqlerrm like 'UNEXPECTED_ALLOWED:%' then
      raise;
    end if;
  end;

  perform public.rb_insert_notifications(jsonb_build_array(jsonb_build_object(
    'id', 'rls_probe_driver_notice_rpc',
    'target_role', 'admin',
    'type', 'info',
    'title', 'RLS probe driver notice RPC',
    'body', 'rollback probe'
  )));

  perform public.rb_insert_audit_log(
    'rls_probe_driver_audit_rpc',
    'RLS probe driver audit RPC',
    '{}'::jsonb
  );

  select count(*)::int
    into affected
  from public.audit_logs
  where id = 'rls_probe_driver_audit_rpc';
  if affected > 0 then
    raise exception 'UNEXPECTED_ALLOWED: driver audit log select';
  end if;

  if other_driver_row_id is not null then
    perform public.rb_request_swap_with_notifications(
      'rls_probe_swap_targeted',
      'rls_probe_swap_targeted_shift',
      'driver',
      other_driver_row_id,
      'RLS probe targeted swap',
      jsonb_build_array(jsonb_build_object('at', now(), 'text', 'RLS probe targeted swap created')),
      now(),
      jsonb_build_array(jsonb_build_object(
        'id', 'rls_probe_swap_targeted_notice',
        'targetDriverId', other_driver_row_id,
        'targetRole', 'driver',
        'type', 'swap-offer',
        'shiftId', 'rls_probe_swap_targeted_shift',
        'title', 'RLS probe targeted swap notice',
        'body', 'rollback probe'
      )),
      jsonb_build_array(jsonb_build_object(
        'id', 'rls_probe_swap_targeted_audit',
        'text', 'RLS probe targeted swap audit',
        'payload', jsonb_build_object('shiftId', 'rls_probe_swap_targeted_shift')
      ))
    );

    select count(*)::int
      into affected
    from public.swap_requests
    where id = 'rls_probe_swap_targeted'
      and driver_id = driver_row_id
      and target_driver_id = other_driver_row_id
      and status = 'pending';
    if affected <> 1 then
      raise exception 'EXPECTED_ALLOWED_FAILED: driver targeted swap request with side effects';
    end if;

    perform public.rb_request_swap_with_notifications(
      'rls_probe_swap_all',
      'rls_probe_swap_all_shift',
      'all',
      null,
      'RLS probe all-driver swap',
      jsonb_build_array(jsonb_build_object('at', now(), 'text', 'RLS probe all-driver swap created')),
      now(),
      jsonb_build_array(jsonb_build_object(
        'id', 'rls_probe_swap_all_notice',
        'targetDriverId', other_driver_row_id,
        'targetRole', 'driver',
        'type', 'swap-offer',
        'shiftId', 'rls_probe_swap_all_shift',
        'title', 'RLS probe all-driver swap notice',
        'body', 'rollback probe'
      )),
      jsonb_build_array(jsonb_build_object(
        'id', 'rls_probe_swap_all_audit',
        'text', 'RLS probe all-driver swap audit',
        'payload', jsonb_build_object('shiftId', 'rls_probe_swap_all_shift')
      ))
    );

    select count(*)::int
      into affected
    from public.swap_requests
    where id = 'rls_probe_swap_all'
      and driver_id = driver_row_id
      and target_mode = 'all'
      and status = 'pending';
    if affected <> 1 then
      raise exception 'EXPECTED_ALLOWED_FAILED: driver all-driver swap request with side effects';
    end if;

    begin
      insert into public.notifications (id, target_driver_id, target_role, type, title, body)
      values ('rls_probe_driver_notice_foreign', other_driver_row_id, 'driver', 'info', 'RLS probe foreign', 'rollback probe');
      raise exception 'UNEXPECTED_ALLOWED: driver foreign notification insert';
    exception when others then
      if sqlerrm like 'UNEXPECTED_ALLOWED:%' then
        raise;
      end if;
    end;

    reset role;
    perform set_config('request.jwt.claim.sub', other_driver_profile_id::text, true);
    set local role authenticated;

    perform public.rb_decline_swap_request_with_notifications(
      'rls_probe_swap_targeted',
      jsonb_build_array(jsonb_build_object('at', now(), 'text', 'RLS probe targeted swap declined')),
      'RLS probe targeted decline',
      now(),
      jsonb_build_array(jsonb_build_object(
        'id', 'rls_probe_swap_rejected_notice',
        'targetDriverId', driver_row_id,
        'targetRole', 'driver',
        'type', 'swap-rejected',
        'shiftId', 'rls_probe_swap_targeted_shift',
        'title', 'RLS probe swap rejected notice',
        'body', 'rollback probe'
      )),
      jsonb_build_array(jsonb_build_object(
        'id', 'rls_probe_swap_rejected_audit',
        'text', 'RLS probe targeted swap rejected audit',
        'payload', jsonb_build_object('shiftId', 'rls_probe_swap_targeted_shift')
      ))
    );

    select count(*)::int
      into affected
    from public.swap_requests
    where id = 'rls_probe_swap_targeted'
      and target_driver_id = other_driver_row_id
      and status = 'rejected';
    if affected <> 1 then
      raise exception 'EXPECTED_ALLOWED_FAILED: target driver decline targeted swap with side effects';
    end if;

    perform public.rb_accept_swap_request_with_notifications(
      'rls_probe_swap_all',
      jsonb_build_array(jsonb_build_object('at', now(), 'text', 'RLS probe all-driver swap accepted')),
      now(),
      jsonb_build_array(jsonb_build_object(
        'id', 'rls_probe_swap_accepted_notice',
        'targetDriverId', driver_row_id,
        'targetRole', 'driver',
        'type', 'swap-accepted',
        'shiftId', 'rls_probe_swap_all_shift',
        'title', 'RLS probe swap accepted notice',
        'body', 'rollback probe'
      )),
      jsonb_build_array(jsonb_build_object(
        'id', 'rls_probe_swap_accepted_audit',
        'text', 'RLS probe all-driver swap accepted audit',
        'payload', jsonb_build_object('shiftId', 'rls_probe_swap_all_shift')
      ))
    );

    select count(*)::int
      into affected
    from public.swap_requests
    where id = 'rls_probe_swap_all'
      and accepted_by_driver_id = other_driver_row_id
      and status = 'accepted';
    if affected <> 1 then
      raise exception 'EXPECTED_ALLOWED_FAILED: target driver accept all-driver swap with side effects';
    end if;
  else
    raise notice 'Skipping cross-driver swap and foreign notification probes: only one driver row found.';
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', staff_profile_id::text, true);
  set local role authenticated;

  perform public.rb_insert_notifications(jsonb_build_array(jsonb_build_object(
    'id', 'rls_probe_staff_message_rpc',
    'targetRole', 'driver_all',
    'type', 'staff-message',
    'title', 'RLS probe staff message RPC',
    'body', 'rollback probe'
  )));

  select count(*)::int
    into affected
  from public.notifications
  where id = 'rls_probe_staff_message_rpc'
    and target_role = 'driver_all'
    and type = 'staff-message';
  if affected <> 1 then
    raise exception 'EXPECTED_ALLOWED_FAILED: staff notification RPC';
  end if;

  if other_driver_row_id is not null then
    perform public.rb_resolve_swap_request_with_notifications(
      'rls_probe_swap_all',
      'approved',
      other_driver_row_id,
      null,
      jsonb_build_array(jsonb_build_object('at', now(), 'text', 'RLS probe all-driver swap approved')),
      now(),
      jsonb_build_array(jsonb_build_object(
        'id', 'rls_probe_swap_approved_notice',
        'targetDriverId', driver_row_id,
        'targetRole', 'driver',
        'type', 'swap-approved',
        'shiftId', 'rls_probe_swap_all_shift',
        'title', 'RLS probe swap approved notice',
        'body', 'rollback probe'
      )),
      jsonb_build_array(jsonb_build_object(
        'id', 'rls_probe_swap_approved_audit',
        'text', 'RLS probe all-driver swap approved audit',
        'payload', jsonb_build_object('shiftId', 'rls_probe_swap_all_shift')
      ))
    );

    select count(*)::int
      into affected
    from public.swap_requests
    where id = 'rls_probe_swap_all'
      and approved_driver_id = other_driver_row_id
      and status = 'approved';
    if affected <> 1 then
      raise exception 'EXPECTED_ALLOWED_FAILED: staff approve accepted swap with side effects';
    end if;

    select count(*)::int
      into affected
    from public.shifts
    where id = 'rls_probe_swap_all_shift'
      and driver_id = other_driver_row_id
      and status = 'confirmed'
      and swap_request_status = 'approved';
    if affected <> 1 then
      raise exception 'EXPECTED_ALLOWED_FAILED: staff swap approval assigns shift to approved driver';
    end if;
  end if;

  insert into public.shifts (id, shift_date, start_time, end_time, driver_id, vehicle_id, type, status, note)
  values ('rls_probe_staff_insert', current_date, '08:00', '09:00', driver_row_id, null, 'day', 'assigned', 'rollback probe');

  select count(*)::int
    into affected
  from public.rb_driver_activity()
  where driver_id = driver_row_id;
  if affected <> 1 then
    raise exception 'EXPECTED_ALLOWED_FAILED: staff reads driver activity';
  end if;

  begin
    insert into public.shifts (id, shift_date, start_time, end_time, driver_id, vehicle_id, type, status, note)
    values ('rls_probe_implausible_date', date '0005-05-04', '08:00', '09:00', driver_row_id, null, 'day', 'assigned', 'rollback probe');
    raise exception 'UNEXPECTED_ALLOWED: shift with implausible date';
  exception when others then
    if sqlerrm like 'UNEXPECTED_ALLOWED:%' then
      raise;
    end if;
  end;

  select count(*)::int
    into affected
  from public.audit_logs
  where id = 'rls_probe_driver_audit_rpc';
  if affected <> 1 then
    raise exception 'EXPECTED_ALLOWED_FAILED: staff audit log select';
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', driver_profile_id::text, true);
  set local role authenticated;

  begin
    update public.drivers
    set note = 'rls probe note'
    where id = driver_row_id;
    get diagnostics affected = row_count;
    if affected > 0 then
      raise exception 'UNEXPECTED_ALLOWED: driver own note rewrite';
    end if;
  exception when others then
    if sqlerrm like 'UNEXPECTED_ALLOWED:%' then
      raise;
    end if;
  end;

  begin
    update public.drivers
    set active = false
    where id = driver_row_id;
    get diagnostics affected = row_count;
    if affected > 0 then
      raise exception 'UNEXPECTED_ALLOWED: driver own activation change';
    end if;
  exception when others then
    if sqlerrm like 'UNEXPECTED_ALLOWED:%' then
      raise;
    end if;
  end;

  update public.drivers
  set phone = coalesce(phone, '')
  where id = driver_row_id;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'EXPECTED_ALLOWED_FAILED: driver own phone update';
  end if;

  select count(*)::int
    into affected
  from public.drivers
  where id <> driver_row_id;
  if affected > 0 then
    raise exception 'UNEXPECTED_ALLOWED: driver reads colleague contacts';
  end if;

  if other_driver_row_id is not null then
    select count(*)::int
      into affected
    from public.rb_driver_directory()
    where id = other_driver_row_id;
    if affected <> 1 then
      raise exception 'EXPECTED_ALLOWED_FAILED: driver directory lists colleague names';
    end if;
  end if;

  select count(*)::int
    into affected
  from public.rb_driver_activity();
  if affected > 0 then
    raise exception 'UNEXPECTED_ALLOWED: driver reads driver activity';
  end if;

  reset role;
  update public.drivers
  set active = false
  where id = driver_row_id;

  perform set_config('request.jwt.claim.sub', driver_profile_id::text, true);
  set local role authenticated;

  select count(*)::int
    into affected
  from public.drivers
  where id <> driver_row_id;
  if affected > 0 then
    raise exception 'UNEXPECTED_ALLOWED: inactive driver reads other drivers';
  end if;

  select count(*)::int
    into affected
  from public.drivers
  where id = driver_row_id;
  if affected <> 1 then
    raise exception 'EXPECTED_ALLOWED_FAILED: inactive driver reads own driver row';
  end if;

  select count(*)::int
    into affected
  from public.rb_driver_directory();
  if affected > 0 then
    raise exception 'UNEXPECTED_ALLOWED: inactive driver reads driver directory';
  end if;

  select count(*)::int
    into affected
  from public.vehicles;
  if affected > 0 then
    raise exception 'UNEXPECTED_ALLOWED: inactive driver reads vehicles';
  end if;

  select count(*)::int
    into affected
  from public.shifts
  where status = 'open';
  if affected > 0 then
    raise exception 'UNEXPECTED_ALLOWED: inactive driver reads open shifts';
  end if;

  select count(*)::int
    into affected
  from public.notifications
  where target_role in ('all', 'driver_all');
  if affected > 0 then
    raise exception 'UNEXPECTED_ALLOWED: inactive driver reads broadcast notifications';
  end if;

  begin
    insert into public.notifications (id, target_role, type, title, body)
    values ('rls_probe_inactive_admin_notice', 'admin', 'info', 'RLS probe', 'rollback probe');
    raise exception 'UNEXPECTED_ALLOWED: inactive driver notifies dispatch';
  exception when others then
    if sqlerrm like 'UNEXPECTED_ALLOWED:%' then
      raise;
    end if;
  end;

  -- Driver removal tools are admin-only; these probes run last because they delete the probe driver's login.
  begin
    perform public.rb_delete_driver_completely(driver_row_id);
    raise exception 'UNEXPECTED_ALLOWED: driver deletes a driver completely';
  exception when others then
    if sqlerrm like 'UNEXPECTED_ALLOWED:%' then
      raise;
    end if;
  end;

  if dispatcher_profile_id is not null then
    reset role;
    perform set_config('request.jwt.claim.sub', dispatcher_profile_id::text, true);
    set local role authenticated;

    begin
      perform public.rb_delete_driver_login(driver_row_id);
      raise exception 'UNEXPECTED_ALLOWED: dispatcher removes a driver login';
    exception when others then
      if sqlerrm like 'UNEXPECTED_ALLOWED:%' then
        raise;
      end if;
    end;
  end if;

  reset role;
  set local role anon;

  begin
    perform public.rb_delete_driver_completely(driver_row_id);
    raise exception 'UNEXPECTED_ALLOWED: anon deletes a driver completely';
  exception when others then
    if sqlerrm like 'UNEXPECTED_ALLOWED:%' then
      raise;
    end if;
  end;

  reset role;

  if admin_profile_id is null then
    raise exception 'RLS regression needs an admin profile for driver removal probes.';
  end if;

  insert into public.drivers (id, profile_id, name, email, active, note)
  values ('rls_probe_staff_linked_driver', coalesce(dispatcher_profile_id, admin_profile_id), 'RLS probe staff-linked driver', 'rls-probe-staff-linked@example.invalid', true, 'rollback probe');

  select d.id, d.profile_id
    into login_probe_driver_id, login_probe_profile_id
  from public.drivers d
  join public.profiles p on p.id = d.profile_id
  where d.id <> driver_row_id
    and trim(lower(p.role)) = 'driver'
    and nullif(trim(coalesce(d.email, '')), '') is not null
    and not exists (
      select 1
      from public.drivers other
      where other.id <> d.id
        and other.profile_id is null
        and lower(trim(coalesce(other.email, ''))) = lower(trim(d.email))
    )
  limit 1;

  select count(*)::int
    into login_probe_shift_count
  from public.shifts
  where driver_id = login_probe_driver_id;

  select coalesce(array_agg(id), '{}'::text[])
    into removed_shift_ids
  from public.shifts
  where driver_id = driver_row_id;

  perform set_config('request.jwt.claim.sub', admin_profile_id::text, true);
  set local role authenticated;

  begin
    perform public.rb_delete_driver_login('rls_probe_staff_linked_driver');
    raise exception 'UNEXPECTED_ALLOWED: admin removes a staff login through driver tools';
  exception when others then
    if sqlerrm like 'UNEXPECTED_ALLOWED:%' then
      raise;
    end if;
  end;

  if login_probe_driver_id is not null then
    perform public.rb_delete_driver_login(login_probe_driver_id);
  else
    raise notice 'Skipping driver login reset probe: no other driver with a login and unique e-mail found.';
  end if;

  perform public.rb_delete_driver_completely(driver_row_id);

  reset role;

  select count(*)::int
    into affected
  from auth.users
  where id = coalesce(dispatcher_profile_id, admin_profile_id);
  if affected <> 1 then
    raise exception 'UNEXPECTED_ALLOWED: driver tools removed a staff login';
  end if;

  if login_probe_driver_id is not null then
    select count(*)::int
      into affected
    from public.drivers
    where id = login_probe_driver_id
      and profile_id is null;
    if affected <> 1 then
      raise exception 'EXPECTED_ALLOWED_FAILED: admin login reset keeps driver row without login';
    end if;

    select count(*)::int
      into affected
    from auth.users
    where id = login_probe_profile_id;
    if affected <> 0 then
      raise exception 'EXPECTED_ALLOWED_FAILED: admin login reset removes auth user';
    end if;

    select count(*)::int
      into affected
    from public.shifts
    where driver_id = login_probe_driver_id;
    if affected <> login_probe_shift_count then
      raise exception 'EXPECTED_ALLOWED_FAILED: admin login reset keeps shift history';
    end if;
  end if;

  select count(*)::int
    into affected
  from public.drivers
  where id = driver_row_id;
  if affected <> 0 then
    raise exception 'EXPECTED_ALLOWED_FAILED: admin deletes driver completely';
  end if;

  select count(*)::int
    into affected
  from public.shifts
  where id = any(removed_shift_ids);
  if affected <> 0 then
    raise exception 'EXPECTED_ALLOWED_FAILED: complete driver deletion removes shifts instead of opening them';
  end if;

  select count(*)::int
    into affected
  from public.shift_settlements
  where driver_id = driver_row_id
    or shift_id = any(removed_shift_ids);
  if affected <> 0 then
    raise exception 'EXPECTED_ALLOWED_FAILED: complete driver deletion removes settlements';
  end if;

  select count(*)::int
    into affected
  from auth.users
  where id = driver_profile_id;
  if affected <> 0 then
    raise exception 'EXPECTED_ALLOWED_FAILED: complete driver deletion removes driver login';
  end if;

  select count(*)::int
    into affected
  from public.audit_logs
  where payload ->> 'type' = 'driver-deleted'
    and payload ->> 'driverId' = driver_row_id;
  if affected <> 1 then
    raise exception 'EXPECTED_ALLOWED_FAILED: complete driver deletion is audited';
  end if;

  reset role;
end $$;

rollback;

select 'rls_regression_passed' as result;
