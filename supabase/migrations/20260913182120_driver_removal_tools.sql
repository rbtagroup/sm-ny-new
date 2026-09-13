-- Admin tools for removing drivers.
-- rb_delete_driver_completely: the driver leaves for good. Removes the driver with shift history, settlements,
--   swaps, notifications, availability, absences, push devices and the driver's login account.
-- rb_delete_driver_login: the driver cannot recover the password. Removes only the login account; the driver
--   signs up again with the same e-mail and private.rb_upsert_driver_signup links the kept history.

-- The driver's login when it is an ordinary driver account other than the caller; staff accounts are never removed.
create or replace function private.rb_removable_driver_login(p_profile_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.id = p_profile_id
    and p.id is distinct from auth.uid()
    and trim(lower(coalesce(p.role, ''))) = 'driver'
$$;

revoke all on function private.rb_removable_driver_login(uuid) from public, anon, authenticated, service_role;

create or replace function private.rb_delete_driver_completely(p_driver_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver public.drivers%rowtype;
  v_login_id uuid;
  v_shift_ids text[];
  v_released_shift_ids text[];
  v_settlements integer := 0;
  v_swap_requests integer := 0;
  v_cancelled_swaps integer := 0;
  v_notifications integer := 0;
  v_shifts integer := 0;
  v_availability integer := 0;
  v_absences integer := 0;
  v_push_subscriptions integer := 0;
  v_login_deleted boolean := false;
begin
  if not private.rb_is_admin() then
    raise exception 'Řidiče může trvale smazat jen administrátor.' using errcode = '42501';
  end if;

  select d.*
  into v_driver
  from public.drivers d
  where d.id = p_driver_id
  for update;

  if not found then
    raise exception 'Řidič už neexistuje. Obnov aplikaci.' using errcode = 'P0002';
  end if;

  v_login_id := private.rb_removable_driver_login(v_driver.profile_id);

  select coalesce(array_agg(s.id), '{}'::text[])
  into v_shift_ids
  from public.shifts s
  where s.driver_id = p_driver_id;

  -- Settlements reference drivers without ON DELETE, and shifts would otherwise become open shifts (SET NULL).
  delete from public.shift_settlements ss
  where ss.driver_id = p_driver_id
    or ss.shift_id = any(v_shift_ids);
  get diagnostics v_settlements = row_count;

  delete from public.swap_requests sr
  where sr.driver_id = p_driver_id
    or sr.shift_id = any(v_shift_ids);
  get diagnostics v_swap_requests = row_count;

  -- Colleagues' unresolved swaps offered to or accepted by this driver would be left without a driver.
  with cancelled as (
    update public.swap_requests sr
    set
      status = 'cancelled',
      cancelled_at = now(),
      resolved_at = now(),
      history = coalesce(sr.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'at', now(),
        'text', 'Výměna zrušena, protože řidič byl smazán.'
      ))
    where sr.status in ('pending', 'accepted')
      and (sr.target_driver_id = p_driver_id or sr.accepted_by_driver_id = p_driver_id)
    returning sr.shift_id
  )
  select coalesce(array_agg(cancelled.shift_id), '{}'::text[])
  into v_released_shift_ids
  from cancelled;
  v_cancelled_swaps := cardinality(v_released_shift_ids);

  update public.shifts s
  set swap_request_status = 'cancelled', updated_at = now()
  where s.id = any(v_released_shift_ids)
    and s.swap_request_status in ('pending', 'accepted')
    and not exists (
      select 1
      from public.swap_requests sr
      where sr.shift_id = s.id
        and sr.status in ('pending', 'accepted')
    );

  delete from public.notifications n
  where n.target_driver_id = p_driver_id
    or n.shift_id = any(v_shift_ids);
  get diagnostics v_notifications = row_count;

  delete from public.shifts s
  where s.id = any(v_shift_ids);
  get diagnostics v_shifts = row_count;

  delete from public.availability a
  where a.driver_id = p_driver_id;
  get diagnostics v_availability = row_count;

  delete from public.absences a
  where a.driver_id = p_driver_id;
  get diagnostics v_absences = row_count;

  delete from public.push_subscriptions ps
  where ps.driver_id = p_driver_id
    or (v_login_id is not null and ps.profile_id = v_login_id);
  get diagnostics v_push_subscriptions = row_count;

  delete from public.drivers d
  where d.id = p_driver_id;

  if v_login_id is not null then
    delete from auth.users u
    where u.id = v_login_id;
    v_login_deleted := found;

    delete from public.profiles p
    where p.id = v_login_id;
    v_login_deleted := v_login_deleted or found;
  end if;

  insert into public.audit_logs (id, actor_id, action, payload)
  values (
    'log_' || pg_catalog.gen_random_uuid()::text,
    auth.uid(),
    'Řidič ' || coalesce(nullif(trim(v_driver.name), ''), p_driver_id) || ' byl trvale smazán i s historií.',
    jsonb_build_object(
      'type', 'driver-deleted',
      'driverId', p_driver_id,
      'shifts', v_shifts,
      'settlements', v_settlements,
      'swapRequests', v_swap_requests,
      'cancelledSwaps', v_cancelled_swaps,
      'notifications', v_notifications,
      'availability', v_availability,
      'absences', v_absences,
      'pushSubscriptions', v_push_subscriptions,
      'loginDeleted', v_login_deleted
    )
  );

  return jsonb_build_object(
    'driverId', p_driver_id,
    'name', v_driver.name,
    'shifts', v_shifts,
    'settlements', v_settlements,
    'swapRequests', v_swap_requests,
    'cancelledSwaps', v_cancelled_swaps,
    'notifications', v_notifications,
    'availability', v_availability,
    'absences', v_absences,
    'pushSubscriptions', v_push_subscriptions,
    'loginDeleted', v_login_deleted
  );
end;
$$;

revoke all on function private.rb_delete_driver_completely(text) from public, anon, service_role;
grant execute on function private.rb_delete_driver_completely(text) to authenticated;

create or replace function public.rb_delete_driver_completely(p_driver_id text)
returns jsonb
language sql
set search_path = ''
as $$
  select private.rb_delete_driver_completely(p_driver_id)
$$;

revoke all on function public.rb_delete_driver_completely(text) from public, anon, service_role;
grant execute on function public.rb_delete_driver_completely(text) to authenticated;

create or replace function private.rb_delete_driver_login(p_driver_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver public.drivers%rowtype;
  v_login_id uuid;
  v_push_subscriptions integer := 0;
begin
  if not private.rb_is_admin() then
    raise exception 'Přihlašovací účet řidiče může zrušit jen administrátor.' using errcode = '42501';
  end if;

  select d.*
  into v_driver
  from public.drivers d
  where d.id = p_driver_id
  for update;

  if not found then
    raise exception 'Řidič už neexistuje. Obnov aplikaci.' using errcode = 'P0002';
  end if;

  if v_driver.profile_id is null then
    raise exception 'Řidič nemá přihlašovací účet.' using errcode = 'P0002';
  end if;

  -- The new signup links to this row only through a unique e-mail among drivers without a login.
  if nullif(trim(coalesce(v_driver.email, '')), '') is null then
    raise exception 'Doplň řidiči e-mail, jinak se nový účet nenapojí na jeho historii.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.drivers d
    where d.id <> p_driver_id
      and d.profile_id is null
      and lower(trim(coalesce(d.email, ''))) = lower(trim(v_driver.email))
  ) then
    raise exception 'Stejný e-mail má i jiný řidič bez účtu. Oprav e-maily, jinak se nový účet nenapojí správně.' using errcode = '22023';
  end if;

  v_login_id := private.rb_removable_driver_login(v_driver.profile_id);

  if v_login_id is null then
    raise exception 'Tento přihlašovací účet nepatří řidiči, tady ho zrušit nejde.' using errcode = '42501';
  end if;

  delete from public.push_subscriptions ps
  where ps.profile_id = v_login_id
    or ps.driver_id = p_driver_id;
  get diagnostics v_push_subscriptions = row_count;

  -- Cascades to public.profiles, which sets drivers.profile_id to null.
  delete from auth.users u
  where u.id = v_login_id;

  delete from public.profiles p
  where p.id = v_login_id;

  update public.drivers d
  set profile_id = null, updated_at = now()
  where d.id = p_driver_id
    and d.profile_id is not null;

  insert into public.audit_logs (id, actor_id, action, payload)
  values (
    'log_' || pg_catalog.gen_random_uuid()::text,
    auth.uid(),
    'Přihlašovací účet řidiče ' || coalesce(nullif(trim(v_driver.name), ''), p_driver_id) || ' byl zrušen, historie zůstala.',
    jsonb_build_object(
      'type', 'driver-login-deleted',
      'driverId', p_driver_id,
      'pushSubscriptions', v_push_subscriptions
    )
  );

  return jsonb_build_object(
    'driverId', p_driver_id,
    'name', v_driver.name,
    'email', v_driver.email,
    'pushSubscriptions', v_push_subscriptions,
    'loginDeleted', true
  );
end;
$$;

revoke all on function private.rb_delete_driver_login(text) from public, anon, service_role;
grant execute on function private.rb_delete_driver_login(text) to authenticated;

create or replace function public.rb_delete_driver_login(p_driver_id text)
returns jsonb
language sql
set search_path = ''
as $$
  select private.rb_delete_driver_login(p_driver_id)
$$;

revoke all on function public.rb_delete_driver_login(text) from public, anon, service_role;
grant execute on function public.rb_delete_driver_login(text) to authenticated;
