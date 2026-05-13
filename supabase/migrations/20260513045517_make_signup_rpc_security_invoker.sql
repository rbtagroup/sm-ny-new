create unique index if not exists drivers_profile_id_unique
on public.drivers (profile_id)
where profile_id is not null;

drop policy if exists "drivers_insert" on public.drivers;
create policy "drivers_insert"
on public.drivers
as permissive
for insert
to authenticated
with check (
  (select public.rb_is_staff())
  or (
    profile_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and trim(lower(p.role)) = 'driver'
    )
  )
);

create or replace function public.rb_ensure_driver_signup_profile(
  display_name text default null,
  phone_number text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  generated_name text;
  generated_phone text;
  profile_role text;
  driver_id text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  generated_name := coalesce(nullif(trim(display_name), ''), 'Řidič');
  generated_phone := nullif(trim(phone_number), '');

  insert into public.profiles (id, role, full_name, phone)
  values (current_user_id, 'driver', generated_name, generated_phone)
  on conflict (id) do update
  set
    full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
    phone = coalesce(excluded.phone, public.profiles.phone)
  returning role into profile_role;

  if trim(lower(coalesce(profile_role, ''))) <> 'driver' then
    return jsonb_build_object(
      'profileId', current_user_id,
      'role', profile_role,
      'driverId', null
    );
  end if;

  insert into public.drivers (id, profile_id, name, phone, active, note)
  values (
    'drv_' || replace(current_user_id::text, '-', ''),
    current_user_id,
    generated_name,
    generated_phone,
    true,
    'Vytvořeno automaticky při registraci.'
  )
  on conflict (profile_id) where profile_id is not null do update
  set
    name = case when nullif(trim(public.drivers.name), '') is null then excluded.name else public.drivers.name end,
    phone = coalesce(nullif(public.drivers.phone, ''), excluded.phone),
    active = true,
    updated_at = now()
  where public.drivers.profile_id = excluded.profile_id
  returning id into driver_id;

  if driver_id is null then
    select d.id
    into driver_id
    from public.drivers d
    where d.profile_id = current_user_id
    order by d.created_at nulls last, d.id
    limit 1;
  end if;

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
