create schema if not exists private;

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
  on conflict (id) do update
  set
    profile_id = coalesce(public.drivers.profile_id, excluded.profile_id),
    name = case when nullif(trim(public.drivers.name), '') is null then excluded.name else public.drivers.name end,
    phone = coalesce(nullif(public.drivers.phone, ''), excluded.phone),
    email = coalesce(nullif(public.drivers.email, ''), excluded.email),
    active = true,
    updated_at = now()
  where public.drivers.profile_id is null
     or public.drivers.profile_id = excluded.profile_id;

  select d.id
  into existing_driver_id
  from public.drivers d
  where d.profile_id = target_user_id
  order by d.created_at nulls last, d.id
  limit 1;

  return existing_driver_id;
end;
$$;

revoke all on function private.rb_upsert_driver_signup(uuid, text, jsonb) from public;

create or replace function private.rb_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.rb_upsert_driver_signup(new.id, new.email, coalesce(new.raw_user_meta_data, '{}'::jsonb));
  return new;
exception when others then
  raise warning 'RBSHIFT signup bootstrap failed for auth user %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function private.rb_handle_new_auth_user() from public;

drop trigger if exists on_auth_user_created_rbshift_driver on auth.users;

create trigger on_auth_user_created_rbshift_driver
after insert on auth.users
for each row execute function private.rb_handle_new_auth_user();

create or replace function public.rb_ensure_driver_signup_profile(
  display_name text default null,
  phone_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  current_email text;
  current_meta jsonb;
  driver_id text;
  profile_role text;
begin
  current_user_id := auth.uid();
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

revoke all on function public.rb_ensure_driver_signup_profile(text, text) from public;
revoke all on function public.rb_ensure_driver_signup_profile(text, text) from anon;
revoke all on function public.rb_ensure_driver_signup_profile(text, text) from service_role;
grant execute on function public.rb_ensure_driver_signup_profile(text, text) to authenticated;

do $$
declare
  auth_user record;
begin
  for auth_user in
    select u.id, u.email, coalesce(u.raw_user_meta_data, '{}'::jsonb) as raw_user_meta_data
    from auth.users u
    left join public.profiles p on p.id = u.id
    where p.id is null
  loop
    perform private.rb_upsert_driver_signup(auth_user.id, auth_user.email, auth_user.raw_user_meta_data);
  end loop;

  for auth_user in
    select u.id, u.email, coalesce(u.raw_user_meta_data, '{}'::jsonb) as raw_user_meta_data
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.drivers d on d.profile_id = p.id
    where trim(lower(p.role)) = 'driver'
      and d.id is null
  loop
    perform private.rb_upsert_driver_signup(auth_user.id, auth_user.email, auth_user.raw_user_meta_data);
  end loop;
end;
$$;
