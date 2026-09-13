-- Only staff and active drivers can see shared operational data.
-- Pending (self-registered) or deactivated drivers keep access to their own driver row only.

create or replace function private.rb_current_driver_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select d.id
  from public.drivers d
  where d.profile_id = auth.uid()
    and d.active is not false
  limit 1
$$;

create or replace function private.rb_has_app_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.rb_is_staff() or private.rb_current_driver_id() is not null
$$;

revoke all on function private.rb_has_app_access() from public;
grant execute on function private.rb_has_app_access() to anon, authenticated, service_role;

create or replace function public.rb_has_app_access()
returns boolean
language sql
stable
set search_path = public, private
as $$
  select private.rb_has_app_access()
$$;

revoke all on function public.rb_has_app_access() from public;
grant execute on function public.rb_has_app_access() to anon, authenticated, service_role;

alter policy "drivers_select_signed" on public.drivers
  using ((select public.rb_has_app_access()) or profile_id = (select auth.uid()));

-- Driver rows for accounts are created by the signup bootstrap (security definer), not by clients.
alter policy "drivers_insert" on public.drivers
  with check ((select public.rb_is_staff()));

alter policy "vehicles_select_signed" on public.vehicles
  using ((select public.rb_has_app_access()));

alter policy "service_blocks_select_signed" on public.service_blocks
  using ((select public.rb_has_app_access()));

alter policy "settings_select_signed" on public.app_settings
  using ((select public.rb_has_app_access()));

alter policy "notifications_select_visible" on public.notifications
  using (
    (select public.rb_is_staff())
    or target_driver_id = (select public.rb_current_driver_id())
    or (target_role = any (array['all', 'driver_all']) and (select public.rb_has_app_access()))
  );

alter policy "notifications_update_visible" on public.notifications
  using (
    (select public.rb_is_staff())
    or target_driver_id = (select public.rb_current_driver_id())
    or (target_role = any (array['all', 'driver_all']) and (select public.rb_has_app_access()))
  )
  with check (
    (select public.rb_is_staff())
    or target_driver_id = (select public.rb_current_driver_id())
    or (target_role = any (array['all', 'driver_all']) and (select public.rb_has_app_access()))
  );

alter policy "notifications_insert_allowed" on public.notifications
  with check (
    (select public.rb_is_staff())
    or (
      (select public.rb_has_app_access())
      and (
        (target_driver_id is null and target_role = any (array['admin', 'dispatcher']))
        or target_driver_id = (select public.rb_current_driver_id())
        or (target_role = 'driver' and public.rb_can_driver_notify_driver(type, shift_id, target_driver_id))
      )
    )
  );

alter policy "shifts_select_staff_own_or_swap" on public.shifts
  using (
    (select public.rb_is_staff())
    or driver_id = (select public.rb_current_driver_id())
    or (
      (select public.rb_has_app_access())
      and (
        status = 'open'
        or id in (
          select sr.shift_id
          from public.swap_requests sr
          where sr.target_mode = 'all'
            or sr.target_driver_id = (select public.rb_current_driver_id())
            or sr.accepted_by_driver_id = (select public.rb_current_driver_id())
        )
      )
    )
  );

alter policy "swap_requests_select_scoped" on public.swap_requests
  using (
    (select public.rb_is_staff())
    or driver_id = (select public.rb_current_driver_id())
    or target_driver_id = (select public.rb_current_driver_id())
    or accepted_by_driver_id = (select public.rb_current_driver_id())
    or (target_mode = 'all' and (select public.rb_has_app_access()))
  );

alter policy "swap_requests_update_scoped" on public.swap_requests
  using (
    (select public.rb_is_staff())
    or driver_id = (select public.rb_current_driver_id())
    or target_driver_id = (select public.rb_current_driver_id())
    or accepted_by_driver_id = (select public.rb_current_driver_id())
    or (target_mode = 'all' and (select public.rb_has_app_access()))
  );

alter policy "audit_logs_insert_authenticated" on public.audit_logs
  with check ((select public.rb_has_app_access()));

-- Drivers may update only their phone number; dispatch owns identity and activation.
create or replace function private.rb_guard_drivers_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Security definer functions, the service role and migrations run under other roles.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if public.rb_is_staff() then
    return new;
  end if;

  if new.id is distinct from old.id
    or new.profile_id is distinct from old.profile_id
    or new.name is distinct from old.name
    or new.email is distinct from old.email
    or new.active is distinct from old.active
    or new.note is distinct from old.note
    or new.created_at is distinct from old.created_at then
    raise exception 'Only dispatch can change driver details.';
  end if;

  return new;
end;
$$;

revoke all on function private.rb_guard_drivers_update() from public, anon, authenticated, service_role;

drop trigger if exists drivers_guard_update on public.drivers;
create trigger drivers_guard_update
before update on public.drivers
for each row
execute function private.rb_guard_drivers_update();

-- Self-registration: link e-mails known to dispatch, park unknown ones as pending.
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
  created_pending boolean := false;
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
      -- Dispatch already registered this e-mail: link the account and keep the active flag dispatch set.
      update public.drivers
      set
        profile_id = target_user_id,
        name = case when nullif(trim(public.drivers.name), '') is null then generated_name else public.drivers.name end,
        phone = coalesce(nullif(public.drivers.phone, ''), generated_phone),
        email = coalesce(nullif(public.drivers.email, ''), target_email),
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
    false,
    'Čeká na schválení dispečinkem.'
  )
  on conflict (profile_id) where profile_id is not null do update
  set
    name = case when nullif(trim(public.drivers.name), '') is null then excluded.name else public.drivers.name end,
    phone = coalesce(nullif(public.drivers.phone, ''), excluded.phone),
    email = coalesce(nullif(public.drivers.email, ''), excluded.email),
    updated_at = now()
  where public.drivers.profile_id = excluded.profile_id
  returning id, (xmax = 0) into existing_driver_id, created_pending;

  if created_pending then
    begin
      insert into public.notifications (id, target_driver_id, target_role, type, title, body)
      values (
        'ntf_driver_pending_' || existing_driver_id,
        null,
        'admin',
        'driver-signup-pending',
        'Nový účet čeká na schválení',
        'Nová registrace: ' || generated_name || coalesce(' (' || nullif(trim(target_email), '') || ')', '')
          || '. Pokud jde o vašeho řidiče, aktivujte ho v sekci Řidiči.'
      )
      on conflict (id) do nothing;
    exception when others then
      raise warning 'RBSHIFT pending signup notification failed for %: %', existing_driver_id, sqlerrm;
    end;
  end if;

  return existing_driver_id;
end;
$$;

revoke all on function private.rb_upsert_driver_signup(uuid, text, jsonb) from public;

-- Scheduled jobs log their push result to audit_logs; tell dispatch in the app when delivery fails.
create or replace function private.rb_alert_failed_job_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_name text := new.payload ->> 'job';
  push_result jsonb := new.payload -> 'pushResult';
  job_label text;
  reason text;
begin
  if auth.uid() is not null or new.actor_id is not null then
    return new;
  end if;

  if job_name is null
    or job_name not in ('daily-coverage', 'driver-signup-reminder')
    or jsonb_typeof(push_result) is distinct from 'object' then
    return new;
  end if;

  if push_result ->> 'ok' = 'false' then
    reason := coalesce(
      nullif(push_result ->> 'error', ''),
      case when push_result ->> 'status' is not null then 'HTTP ' || (push_result ->> 'status') end,
      'neznámá chyba'
    );
  elsif push_result ->> 'skipped' = 'true' and coalesce(push_result ->> 'reason', '') like 'missing-push-delivery%' then
    reason := 'chybí nastavení odesílání: ' || (push_result ->> 'reason');
  else
    return new;
  end if;

  job_label := case job_name
    when 'daily-coverage' then 'Denní kontrola obsazení'
    else 'Připomínka registrace řidičů'
  end;

  insert into public.notifications (id, target_driver_id, target_role, type, title, body)
  values (
    'ntf_system_push_failed_' || replace(job_name, '-', '_') || '_'
      || to_char(coalesce(new.created_at, now()) at time zone 'Europe/Prague', 'YYYYMMDD'),
    null,
    'admin',
    'system-push-failed',
    'Push notifikace se nepodařilo odeslat',
    job_label || ': upozornění je v aplikaci, ale na telefony neodešlo (' || left(reason, 160)
      || '). Zkontroluj odesílání pushů ve Vercelu.'
  )
  on conflict (id) do nothing;

  return new;
exception when others then
  raise warning 'RBSHIFT push failure alert failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function private.rb_alert_failed_job_push() from public, anon, authenticated, service_role;

drop trigger if exists audit_logs_alert_failed_job_push on public.audit_logs;
create trigger audit_logs_alert_failed_job_push
after insert on public.audit_logs
for each row
execute function private.rb_alert_failed_job_push();
