alter table public.shifts disable trigger shifts_guard_update;
alter table public.notifications disable trigger notifications_guard_update;
alter table public.swap_requests disable trigger swap_requests_guard_update;

do $$
declare
  duplicate_driver record;
begin
  for duplicate_driver in
    select
      duplicate_row.id as duplicate_id,
      linked_row.id as linked_id,
      duplicate_row.name as duplicate_name,
      duplicate_row.phone as duplicate_phone,
      duplicate_row.note as duplicate_note,
      duplicate_row.active as duplicate_active
    from public.drivers duplicate_row
    join public.drivers linked_row
      on linked_row.profile_id is not null
     and duplicate_row.profile_id is null
     and duplicate_row.id <> linked_row.id
     and nullif(trim(duplicate_row.email), '') is not null
     and lower(trim(duplicate_row.email)) = lower(trim(linked_row.email))
    where (
      select count(*)
      from public.drivers candidate
      where candidate.profile_id is not null
        and lower(trim(candidate.email)) = lower(trim(duplicate_row.email))
    ) = 1
  loop
    update public.shifts
    set driver_id = duplicate_driver.linked_id
    where driver_id = duplicate_driver.duplicate_id;

    update public.shift_settlements
    set driver_id = duplicate_driver.linked_id
    where driver_id = duplicate_driver.duplicate_id;

    update public.absences
    set driver_id = duplicate_driver.linked_id
    where driver_id = duplicate_driver.duplicate_id;

    update public.availability
    set driver_id = duplicate_driver.linked_id
    where driver_id = duplicate_driver.duplicate_id;

    update public.swap_requests
    set
      driver_id = case when driver_id = duplicate_driver.duplicate_id then duplicate_driver.linked_id else driver_id end,
      target_driver_id = case when target_driver_id = duplicate_driver.duplicate_id then duplicate_driver.linked_id else target_driver_id end,
      accepted_by_driver_id = case when accepted_by_driver_id = duplicate_driver.duplicate_id then duplicate_driver.linked_id else accepted_by_driver_id end,
      approved_driver_id = case when approved_driver_id = duplicate_driver.duplicate_id then duplicate_driver.linked_id else approved_driver_id end
    where driver_id = duplicate_driver.duplicate_id
       or target_driver_id = duplicate_driver.duplicate_id
       or accepted_by_driver_id = duplicate_driver.duplicate_id
       or approved_driver_id = duplicate_driver.duplicate_id;

    update public.notifications
    set target_driver_id = duplicate_driver.linked_id
    where target_driver_id = duplicate_driver.duplicate_id;

    update public.push_subscriptions
    set driver_id = duplicate_driver.linked_id
    where driver_id = duplicate_driver.duplicate_id;

    update public.push_delivery_logs
    set target_driver_id = duplicate_driver.linked_id
    where target_driver_id = duplicate_driver.duplicate_id;

    update public.drivers
    set
      name = case
        when length(trim(coalesce(duplicate_driver.duplicate_name, ''))) > length(trim(coalesce(public.drivers.name, '')))
          then duplicate_driver.duplicate_name
        else public.drivers.name
      end,
      phone = coalesce(nullif(public.drivers.phone, ''), duplicate_driver.duplicate_phone),
      note = coalesce(nullif(public.drivers.note, ''), duplicate_driver.duplicate_note),
      active = public.drivers.active is not false or duplicate_driver.duplicate_active is not false,
      updated_at = now()
    where id = duplicate_driver.linked_id;

    delete from public.drivers
    where id = duplicate_driver.duplicate_id;
  end loop;
end;
$$;

alter table public.shifts enable trigger shifts_guard_update;
alter table public.notifications enable trigger notifications_guard_update;
alter table public.swap_requests enable trigger swap_requests_guard_update;

create or replace function private.rb_upsert_driver_signup(
  target_user_id uuid,
  target_email text,
  target_meta jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  generated_name text;
  generated_phone text;
  existing_role text;
  existing_driver_id text;
  candidate_driver_id text;
begin
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  generated_name := coalesce(
    nullif(trim(target_meta ->> 'full_name'), ''),
    nullif(trim(target_meta ->> 'name'), ''),
    nullif(trim(split_part(coalesce(target_email, ''), '@', 1)), ''),
    'Řidič'
  );
  generated_phone := nullif(trim(target_meta ->> 'phone'), '');
  candidate_driver_id := 'drv_' || replace(target_user_id::text, '-', '');

  insert into public.profiles (id, role, full_name, phone)
  values (target_user_id, 'driver', generated_name, generated_phone)
  on conflict (id) do nothing;

  select p.role
  into existing_role
  from public.profiles p
  where p.id = target_user_id;

  if trim(lower(coalesce(existing_role, ''))) <> 'driver' then
    return null;
  end if;

  select d.id
  into existing_driver_id
  from public.drivers d
  where d.profile_id = target_user_id
  order by d.created_at nulls last, d.id
  limit 1;

  if existing_driver_id is null and nullif(trim(target_email), '') is not null then
    select case when count(*) = 1 then min(d.id) else null end
    into existing_driver_id
    from public.drivers d
    where d.profile_id is null
      and lower(trim(d.email)) = lower(trim(target_email));

    if existing_driver_id is not null then
      update public.drivers
      set
        profile_id = target_user_id,
        name = case when nullif(trim(public.drivers.name), '') is null then generated_name else public.drivers.name end,
        phone = coalesce(nullif(public.drivers.phone, ''), generated_phone),
        email = coalesce(nullif(public.drivers.email, ''), target_email),
        active = true,
        updated_at = now()
      where public.drivers.id = existing_driver_id;

      return existing_driver_id;
    end if;
  end if;

  if existing_driver_id is not null then
    update public.drivers
    set
      name = case when nullif(trim(public.drivers.name), '') is null then generated_name else public.drivers.name end,
      phone = coalesce(nullif(public.drivers.phone, ''), generated_phone),
      email = coalesce(nullif(public.drivers.email, ''), target_email),
      active = true,
      updated_at = now()
    where public.drivers.id = existing_driver_id;

    return existing_driver_id;
  end if;

  insert into public.drivers (id, profile_id, name, phone, email, active, note)
  values (
    candidate_driver_id,
    target_user_id,
    generated_name,
    generated_phone,
    target_email,
    true,
    'Vytvořeno automaticky při registraci.'
  )
  on conflict (profile_id) where profile_id is not null do update
  set
    name = case when nullif(trim(public.drivers.name), '') is null then excluded.name else public.drivers.name end,
    phone = coalesce(nullif(public.drivers.phone, ''), excluded.phone),
    email = coalesce(nullif(public.drivers.email, ''), excluded.email),
    active = true,
    updated_at = now()
  where public.drivers.profile_id = excluded.profile_id
  returning id into existing_driver_id;

  return existing_driver_id;
end;
$$;

revoke all on function private.rb_upsert_driver_signup(uuid, text, jsonb) from public;

create or replace function private.rb_ensure_current_driver_signup(
  display_name text default null,
  phone_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text;
  current_meta jsonb;
  driver_id text;
  profile_role text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select u.email, coalesce(u.raw_user_meta_data, '{}'::jsonb)
  into current_email, current_meta
  from auth.users u
  where u.id = current_user_id;

  if current_email is null then
    raise exception 'Auth user not found';
  end if;

  if nullif(trim(display_name), '') is not null then
    current_meta := jsonb_set(current_meta, '{full_name}', to_jsonb(trim(display_name)), true);
  end if;

  if nullif(trim(phone_number), '') is not null then
    current_meta := jsonb_set(current_meta, '{phone}', to_jsonb(trim(phone_number)), true);
  end if;

  driver_id := private.rb_upsert_driver_signup(current_user_id, current_email, current_meta);

  select p.role
  into profile_role
  from public.profiles p
  where p.id = current_user_id;

  return jsonb_build_object(
    'profileId', current_user_id,
    'role', profile_role,
    'driverId', driver_id
  );
end;
$$;

revoke all on function private.rb_ensure_current_driver_signup(text, text) from public;
revoke all on function private.rb_ensure_current_driver_signup(text, text) from anon;
revoke all on function private.rb_ensure_current_driver_signup(text, text) from service_role;
grant execute on function private.rb_ensure_current_driver_signup(text, text) to authenticated;

create or replace function public.rb_ensure_driver_signup_profile(
  display_name text default null,
  phone_number text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.rb_ensure_current_driver_signup(display_name, phone_number)
$$;

revoke all on function public.rb_ensure_driver_signup_profile(text, text) from public;
revoke all on function public.rb_ensure_driver_signup_profile(text, text) from anon;
revoke all on function public.rb_ensure_driver_signup_profile(text, text) from service_role;
grant execute on function public.rb_ensure_driver_signup_profile(text, text) to authenticated;

create or replace function public.rb_set_notification_state(
  p_notification_id text,
  p_read boolean default null,
  p_deleted boolean default null
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_driver text := public.rb_current_driver_id();
  user_key text;
  legacy_delete_key text;
  current_read_by jsonb;
  current_deleted_by jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if public.rb_is_staff() then
    user_key := 'staff:' || auth.uid()::text;
  else
    if current_driver is null then
      raise exception 'Driver profile is required.';
    end if;
    user_key := 'driver:' || current_driver;
  end if;
  legacy_delete_key := 'deleted:' || user_key;

  select read_by, deleted_by
  into current_read_by, current_deleted_by
  from public.notifications
  where id = p_notification_id
  for update;

  if not found then
    raise exception 'Notification not found.';
  end if;

  current_read_by := coalesce(current_read_by, '[]'::jsonb);
  current_deleted_by := coalesce(current_deleted_by, '[]'::jsonb);

  if p_read is true then
    select coalesce(jsonb_agg(value), '[]'::jsonb)
    into current_read_by
    from (
      select value from jsonb_array_elements_text(current_read_by) as existing(value)
      union
      select user_key
    ) merged;
  elsif p_read is false then
    select coalesce(jsonb_agg(value), '[]'::jsonb)
    into current_read_by
    from (
      select value
      from jsonb_array_elements_text(current_read_by) as existing(value)
      where value <> user_key
    ) kept;
  end if;

  if p_deleted is true then
    select coalesce(jsonb_agg(value), '[]'::jsonb)
    into current_deleted_by
    from (
      select value from jsonb_array_elements_text(current_deleted_by) as existing(value)
      union
      select user_key
    ) merged;
  elsif p_deleted is false then
    select coalesce(jsonb_agg(value), '[]'::jsonb)
    into current_deleted_by
    from (
      select value
      from jsonb_array_elements_text(current_deleted_by) as existing(value)
      where value <> user_key
    ) kept;

    select coalesce(jsonb_agg(value), '[]'::jsonb)
    into current_read_by
    from (
      select value
      from jsonb_array_elements_text(current_read_by) as existing(value)
      where value <> legacy_delete_key
        and value not like legacy_delete_key || ':%'
    ) kept;
  end if;

  update public.notifications
  set
    read_by = current_read_by,
    deleted_by = current_deleted_by
  where id = p_notification_id;
end;
$$;

revoke all on function public.rb_set_notification_state(text, boolean, boolean) from public;
revoke all on function public.rb_set_notification_state(text, boolean, boolean) from anon;
revoke all on function public.rb_set_notification_state(text, boolean, boolean) from service_role;
grant execute on function public.rb_set_notification_state(text, boolean, boolean) to authenticated;
