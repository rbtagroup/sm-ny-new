create or replace function public.rb_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$$;

create or replace function public.rb_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and trim(lower(p.role)) = 'admin'
  )
$$;

create or replace function public.rb_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and trim(lower(p.role)) in ('admin', 'dispatcher')
  )
$$;

create or replace function public.rb_current_driver_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select d.id
  from public.drivers d
  where d.profile_id = auth.uid()
  limit 1
$$;

grant execute on function public.rb_current_role() to authenticated;
grant execute on function public.rb_is_admin() to authenticated;
grant execute on function public.rb_is_staff() to authenticated;
grant execute on function public.rb_current_driver_id() to authenticated;

alter table public.notifications
  add column if not exists deleted_by jsonb not null default '[]'::jsonb;

create or replace function public.rb_guard_notification_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.rb_is_staff() then
    return new;
  end if;

  if new.id is distinct from old.id
    or new.target_driver_id is distinct from old.target_driver_id
    or new.target_role is distinct from old.target_role
    or new.type is distinct from old.type
    or new.shift_id is distinct from old.shift_id
    or new.title is distinct from old.title
    or new.body is distinct from old.body
    or new.payload is distinct from old.payload
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Only read_by and deleted_by can be updated on notifications.';
  end if;

  return new;
end;
$$;

drop trigger if exists notifications_guard_update on public.notifications;
create trigger notifications_guard_update
before update on public.notifications
for each row
execute function public.rb_guard_notification_update();

create or replace function public.rb_guard_swap_request_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_driver text := public.rb_current_driver_id();
begin
  if public.rb_is_staff() then
    return new;
  end if;

  if current_driver is null then
    raise exception 'Driver profile is required.';
  end if;

  if old.driver_id = current_driver then
    if old.status not in ('pending', 'accepted')
      or new.status <> 'cancelled'
      or new.id is distinct from old.id
      or new.shift_id is distinct from old.shift_id
      or new.driver_id is distinct from old.driver_id
      or new.target_mode is distinct from old.target_mode
      or new.target_driver_id is distinct from old.target_driver_id
      or new.accepted_by_driver_id is distinct from old.accepted_by_driver_id
      or new.approved_driver_id is distinct from old.approved_driver_id
      or new.reason is distinct from old.reason
      or new.rejected_reason is distinct from old.rejected_reason
      or new.created_at is distinct from old.created_at
      or new.accepted_at is distinct from old.accepted_at
    then
      raise exception 'Driver can only cancel own pending swap request.';
    end if;

    return new;
  end if;

  if old.status = 'pending'
    and (old.target_mode = 'all' or old.target_driver_id = current_driver)
    and new.status = 'accepted'
    and new.accepted_by_driver_id = current_driver
    and new.id is not distinct from old.id
    and new.shift_id is not distinct from old.shift_id
    and new.driver_id is not distinct from old.driver_id
    and new.target_mode is not distinct from old.target_mode
    and new.target_driver_id is not distinct from old.target_driver_id
    and new.approved_driver_id is not distinct from old.approved_driver_id
    and new.reason is not distinct from old.reason
    and new.rejected_reason is not distinct from old.rejected_reason
    and new.created_at is not distinct from old.created_at
    and new.cancelled_at is not distinct from old.cancelled_at
    and new.resolved_at is not distinct from old.resolved_at
  then
    return new;
  end if;

  raise exception 'Driver is not allowed to update this swap request.';
end;
$$;

drop trigger if exists swap_requests_guard_update on public.swap_requests;
create trigger swap_requests_guard_update
before update on public.swap_requests
for each row
execute function public.rb_guard_swap_request_update();

create or replace function public.rb_set_notification_state(
  p_notification_id text,
  p_read boolean default null,
  p_deleted boolean default null
)
returns void
language plpgsql
security invoker
set search_path = public
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
    user_key := 'admin';
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
    set read_by = current_read_by,
        deleted_by = current_deleted_by
  where id = p_notification_id;
end;
$$;

create or replace function public.rb_insert_audit_log(
  p_id text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  insert into public.audit_logs (id, actor_id, action, payload)
  values (
    coalesce(nullif(p_id, ''), 'log_' || gen_random_uuid()::text),
    auth.uid(),
    coalesce(p_action, ''),
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (id) do nothing;
end;
$$;

create or replace function public.rb_request_swap(
  p_id text,
  p_shift_id text,
  p_target_mode text default 'all',
  p_target_driver_id text default null,
  p_reason text default null,
  p_history jsonb default '[]'::jsonb,
  p_created_at timestamptz default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_driver text := public.rb_current_driver_id();
  normalized_mode text := coalesce(nullif(trim(lower(p_target_mode)), ''), 'all');
  shift_driver text;
  shift_status text;
begin
  if current_driver is null then
    raise exception 'Driver profile is required.';
  end if;

  if normalized_mode not in ('all', 'driver', 'open') then
    raise exception 'Unsupported swap target mode.';
  end if;

  select driver_id, status
    into shift_driver, shift_status
  from public.shifts
  where id = p_shift_id;

  if not found then
    raise exception 'Shift not found.';
  end if;

  if normalized_mode = 'open' then
    if shift_status <> 'open' or shift_driver is not null then
      raise exception 'Only open unassigned shifts can receive open-shift interest.';
    end if;
  else
    if shift_driver <> current_driver then
      raise exception 'Driver can request swap only for own shift.';
    end if;
    if normalized_mode = 'driver' and p_target_driver_id is null then
      raise exception 'Target driver is required.';
    end if;
  end if;

  if p_target_driver_id = current_driver then
    raise exception 'Target driver cannot be current driver.';
  end if;

  insert into public.swap_requests (
    id,
    shift_id,
    driver_id,
    target_mode,
    target_driver_id,
    accepted_by_driver_id,
    status,
    reason,
    history,
    created_at,
    accepted_at
  )
  values (
    p_id,
    p_shift_id,
    current_driver,
    normalized_mode,
    nullif(p_target_driver_id, ''),
    case when normalized_mode = 'open' then current_driver else null end,
    'pending',
    p_reason,
    coalesce(p_history, '[]'::jsonb),
    coalesce(p_created_at, now()),
    case when normalized_mode = 'open' then coalesce(p_created_at, now()) else null end
  );

  if normalized_mode <> 'open' then
    update public.shifts
      set swap_request_status = 'pending'
    where id = p_shift_id
      and driver_id = current_driver;
  end if;
end;
$$;

create or replace function public.rb_cancel_swap_request(
  p_id text,
  p_history jsonb default '[]'::jsonb,
  p_cancelled_at timestamptz default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_driver text := public.rb_current_driver_id();
  request_shift_id text;
begin
  if current_driver is null then
    raise exception 'Driver profile is required.';
  end if;

  select shift_id
    into request_shift_id
  from public.swap_requests
  where id = p_id
    and driver_id = current_driver
    and status in ('pending', 'accepted');

  if not found then
    raise exception 'Swap request not found or cannot be cancelled.';
  end if;

  update public.swap_requests
    set status = 'cancelled',
        cancelled_at = coalesce(p_cancelled_at, now()),
        resolved_at = coalesce(p_cancelled_at, now()),
        history = coalesce(p_history, history)
  where id = p_id
    and driver_id = current_driver;

  update public.shifts
    set swap_request_status = 'cancelled'
  where id = request_shift_id
    and driver_id = current_driver;
end;
$$;

create or replace function public.rb_accept_swap_request(
  p_id text,
  p_history jsonb default '[]'::jsonb,
  p_accepted_at timestamptz default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_driver text := public.rb_current_driver_id();
  request_row public.swap_requests%rowtype;
begin
  if current_driver is null then
    raise exception 'Driver profile is required.';
  end if;

  select *
    into request_row
  from public.swap_requests
  where id = p_id
    and status = 'pending';

  if not found then
    raise exception 'Swap request not found or already resolved.';
  end if;

  if request_row.driver_id = current_driver then
    raise exception 'Driver cannot accept own swap request.';
  end if;

  if request_row.target_mode <> 'all' and request_row.target_driver_id <> current_driver then
    raise exception 'Swap request is not targeted to current driver.';
  end if;

  update public.swap_requests
    set status = 'accepted',
        accepted_by_driver_id = current_driver,
        accepted_at = coalesce(p_accepted_at, now()),
        history = coalesce(p_history, history)
  where id = p_id
    and status = 'pending';
end;
$$;

create or replace function public.rb_resolve_swap_request(
  p_id text,
  p_status text,
  p_approved_driver_id text default null,
  p_rejected_reason text default null,
  p_history jsonb default '[]'::jsonb,
  p_resolved_at timestamptz default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  request_row public.swap_requests%rowtype;
  normalized_status text := trim(lower(coalesce(p_status, '')));
  resolved_at_value timestamptz := coalesce(p_resolved_at, now());
  final_driver_id text;
begin
  if not public.rb_is_staff() then
    raise exception 'Only staff can resolve swap requests.';
  end if;

  if normalized_status not in ('approved', 'rejected', 'cancelled') then
    raise exception 'Unsupported swap resolution status.';
  end if;

  select *
    into request_row
  from public.swap_requests
  where id = p_id
    and status in ('pending', 'accepted');

  if not found then
    raise exception 'Swap request not found or already resolved.';
  end if;

  if normalized_status = 'approved' then
    final_driver_id := coalesce(nullif(p_approved_driver_id, ''), nullif(request_row.accepted_by_driver_id, ''), nullif(request_row.target_driver_id, ''));
    if final_driver_id is null then
      raise exception 'Approved driver is required.';
    end if;

    update public.swap_requests
      set status = 'approved',
          approved_driver_id = final_driver_id,
          resolved_at = resolved_at_value,
          rejected_reason = null,
          history = coalesce(p_history, history)
    where id = p_id;

    update public.shifts
      set driver_id = final_driver_id,
          status = 'confirmed',
          decline_reason = null,
          swap_request_status = 'approved'
    where id = request_row.shift_id;
  else
    update public.swap_requests
      set status = normalized_status,
          resolved_at = resolved_at_value,
          cancelled_at = case when normalized_status = 'cancelled' then resolved_at_value else cancelled_at end,
          rejected_reason = case when normalized_status = 'rejected' then coalesce(p_rejected_reason, 'Zamítnuto adminem') else rejected_reason end,
          history = coalesce(p_history, history)
    where id = p_id;

    update public.shifts
      set swap_request_status = normalized_status
    where id = request_row.shift_id;
  end if;
end;
$$;

revoke all on function public.rb_set_notification_state(text, boolean, boolean) from public;
revoke all on function public.rb_insert_audit_log(text, text, jsonb) from public;
revoke all on function public.rb_request_swap(text, text, text, text, text, jsonb, timestamptz) from public;
revoke all on function public.rb_cancel_swap_request(text, jsonb, timestamptz) from public;
revoke all on function public.rb_accept_swap_request(text, jsonb, timestamptz) from public;
revoke all on function public.rb_resolve_swap_request(text, text, text, text, jsonb, timestamptz) from public;

grant execute on function public.rb_set_notification_state(text, boolean, boolean) to authenticated;
grant execute on function public.rb_insert_audit_log(text, text, jsonb) to authenticated;
grant execute on function public.rb_request_swap(text, text, text, text, text, jsonb, timestamptz) to authenticated;
grant execute on function public.rb_cancel_swap_request(text, jsonb, timestamptz) to authenticated;
grant execute on function public.rb_accept_swap_request(text, jsonb, timestamptz) to authenticated;
grant execute on function public.rb_resolve_swap_request(text, text, text, text, jsonb, timestamptz) to authenticated;

drop policy if exists "swap_select_staff_or_involved" on public.swap_requests;
drop policy if exists "swap_insert_signed" on public.swap_requests;
drop policy if exists "swap_update_staff_or_involved" on public.swap_requests;
drop policy if exists "swap_delete_staff" on public.swap_requests;
drop policy if exists "swap_requests_select_authenticated" on public.swap_requests;
drop policy if exists "swap_requests_insert_authenticated" on public.swap_requests;
drop policy if exists "swap_requests_update_authenticated" on public.swap_requests;
drop policy if exists "swap_requests_delete_staff" on public.swap_requests;
drop policy if exists "swap_requests_select_scoped" on public.swap_requests;
drop policy if exists "swap_requests_insert_scoped" on public.swap_requests;
drop policy if exists "swap_requests_update_scoped" on public.swap_requests;

create policy "swap_requests_select_scoped"
on public.swap_requests
for select
to authenticated
using (
  (select public.rb_is_staff())
  or driver_id = (select public.rb_current_driver_id())
  or target_driver_id = (select public.rb_current_driver_id())
  or accepted_by_driver_id = (select public.rb_current_driver_id())
  or target_mode = 'all'
);

create policy "swap_requests_insert_scoped"
on public.swap_requests
for insert
to authenticated
with check (
  (select public.rb_is_staff())
  or driver_id = (select public.rb_current_driver_id())
);

create policy "swap_requests_update_scoped"
on public.swap_requests
for update
to authenticated
using (
  (select public.rb_is_staff())
  or driver_id = (select public.rb_current_driver_id())
  or target_driver_id = (select public.rb_current_driver_id())
  or accepted_by_driver_id = (select public.rb_current_driver_id())
  or target_mode = 'all'
)
with check (
  (select public.rb_is_staff())
  or driver_id = (select public.rb_current_driver_id())
  or accepted_by_driver_id = (select public.rb_current_driver_id())
);

create policy "swap_requests_delete_staff"
on public.swap_requests
for delete
to authenticated
using ((select public.rb_is_staff()));

drop policy if exists "audit_select_staff" on public.audit_logs;
drop policy if exists "audit_insert_signed" on public.audit_logs;
drop policy if exists "audit_logs_select_staff" on public.audit_logs;
drop policy if exists "audit_logs_select_authenticated" on public.audit_logs;
drop policy if exists "audit_logs_insert_authenticated" on public.audit_logs;
drop policy if exists "audit_logs_update_authenticated" on public.audit_logs;
drop policy if exists "audit_logs_delete_staff" on public.audit_logs;
drop policy if exists "audit_logs_select" on public.audit_logs;
drop policy if exists "audit_logs_insert" on public.audit_logs;
drop policy if exists "audit_logs_update" on public.audit_logs;
drop policy if exists "audit_logs_delete" on public.audit_logs;

create policy "audit_logs_select_staff"
on public.audit_logs
for select
to authenticated
using ((select public.rb_is_staff()));

create policy "audit_logs_insert_authenticated"
on public.audit_logs
for insert
to authenticated
with check (auth.uid() is not null);

create policy "audit_logs_update_staff"
on public.audit_logs
for update
to authenticated
using ((select public.rb_is_staff()))
with check ((select public.rb_is_staff()));

create policy "audit_logs_delete_staff"
on public.audit_logs
for delete
to authenticated
using ((select public.rb_is_staff()));
