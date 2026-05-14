alter table public.push_subscriptions
  add column if not exists last_delivery_at timestamptz,
  add column if not exists last_error text,
  add column if not exists delivery_failures integer not null default 0;

create or replace function private.rb_can_driver_notify_driver_for(
  p_current_driver_id text,
  p_notice_type text,
  p_notice_shift_id text,
  p_notice_target_driver_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select exists (
      select 1
      from public.drivers target_driver
      where p_current_driver_id is not null
        and p_notice_target_driver_id is not null
        and p_notice_target_driver_id <> p_current_driver_id
        and target_driver.id = p_notice_target_driver_id
        and target_driver.active is not false
        and (
          (
            p_notice_type = 'swap-offer'
            and exists (
              select 1
              from public.swap_requests sr
              join public.shifts sh on sh.id = sr.shift_id
              where sr.shift_id = p_notice_shift_id
                and sh.driver_id = p_current_driver_id
                and sr.driver_id = p_current_driver_id
                and sr.status = 'pending'
                and (
                  sr.target_mode = 'all'
                  or sr.target_driver_id = p_notice_target_driver_id
                )
            )
          )
          or (
            p_notice_type = 'swap-accepted'
            and exists (
              select 1
              from public.swap_requests sr
              where sr.shift_id = p_notice_shift_id
                and sr.status = 'accepted'
                and sr.accepted_by_driver_id = p_current_driver_id
                and sr.driver_id = p_notice_target_driver_id
            )
          )
          or (
            p_notice_type = 'swap-rejected'
            and exists (
              select 1
              from public.swap_requests sr
              where sr.shift_id = p_notice_shift_id
                and sr.status = 'rejected'
                and sr.target_mode = 'driver'
                and sr.target_driver_id = p_current_driver_id
                and sr.driver_id = p_notice_target_driver_id
            )
          )
          or (
            p_notice_type = 'swap-cancelled'
            and exists (
              select 1
              from public.swap_requests sr
              where sr.shift_id = p_notice_shift_id
                and sr.status = 'cancelled'
                and sr.driver_id = p_current_driver_id
                and (
                  sr.target_driver_id = p_notice_target_driver_id
                  or sr.accepted_by_driver_id = p_notice_target_driver_id
                )
            )
          )
        )
    )
  ), false)
$$;

create or replace function private.rb_insert_notifications(
  p_notifications jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  notice jsonb;
  current_driver text := private.rb_current_driver_id();
  is_staff boolean := private.rb_is_staff();
  notice_id text;
  target_driver_id text;
  target_role text;
  notice_type text;
  shift_id text;
  read_by jsonb;
  deleted_by jsonb;
  payload jsonb;
  created_at_value timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if coalesce(jsonb_typeof(p_notifications), 'array') <> 'array' then
    raise exception 'Notifications payload must be an array.';
  end if;

  for notice in
    select value
    from jsonb_array_elements(coalesce(p_notifications, '[]'::jsonb)) as items(value)
  loop
    notice_id := coalesce(nullif(notice->>'id', ''), 'ntf_' || pg_catalog.gen_random_uuid()::text);
    target_driver_id := nullif(coalesce(notice->>'target_driver_id', notice->>'targetDriverId'), '');
    target_role := lower(nullif(coalesce(notice->>'target_role', notice->>'targetRole'), ''));
    if target_driver_id is not null then
      target_role := 'driver';
    elsif target_role is null then
      target_role := 'admin';
    end if;
    notice_type := coalesce(nullif(notice->>'type', ''), 'info');
    shift_id := nullif(coalesce(notice->>'shift_id', notice->>'shiftId'), '');
    read_by := coalesce(notice->'read_by', notice->'readBy', '[]'::jsonb);
    deleted_by := coalesce(notice->'deleted_by', notice->'deletedBy', '[]'::jsonb);
    payload := coalesce(notice->'payload', '{}'::jsonb);
    created_at_value := coalesce(
      nullif(coalesce(notice->>'created_at', notice->>'createdAt', notice->>'at'), '')::timestamptz,
      now()
    );

    if jsonb_typeof(read_by) <> 'array' then
      read_by := '[]'::jsonb;
    end if;
    if jsonb_typeof(deleted_by) <> 'array' then
      deleted_by := '[]'::jsonb;
    end if;
    if jsonb_typeof(payload) <> 'object' then
      payload := '{}'::jsonb;
    end if;

    if not is_staff then
      if current_driver is null then
        raise exception 'Driver profile is required.';
      end if;

      if not (
        (target_driver_id is null and target_role in ('admin', 'dispatcher'))
        or target_driver_id = current_driver
        or (
          target_role = 'driver'
          and private.rb_can_driver_notify_driver_for(current_driver, notice_type, shift_id, target_driver_id)
        )
      ) then
        raise exception 'Driver is not allowed to create this notification.';
      end if;
    end if;

    insert into public.notifications (
      id,
      target_driver_id,
      target_role,
      type,
      shift_id,
      title,
      body,
      payload,
      read_by,
      deleted_by,
      created_at
    )
    values (
      notice_id,
      target_driver_id,
      target_role,
      notice_type,
      shift_id,
      coalesce(notice->>'title', ''),
      nullif(coalesce(notice->>'body', ''), ''),
      payload,
      read_by,
      deleted_by,
      created_at_value
    )
    on conflict (id) do nothing;
  end loop;
end;
$$;

create or replace function public.rb_insert_notifications(
  p_notifications jsonb default '[]'::jsonb
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.rb_insert_notifications(p_notifications)
$$;

create or replace function public.rb_insert_audit_logs(
  p_audit_rows jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  audit_row jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if coalesce(jsonb_typeof(p_audit_rows), 'array') <> 'array' then
    raise exception 'Audit payload must be an array.';
  end if;

  for audit_row in
    select value
    from jsonb_array_elements(coalesce(p_audit_rows, '[]'::jsonb)) as items(value)
  loop
    perform public.rb_insert_audit_log(
      coalesce(audit_row->>'id', ''),
      coalesce(audit_row->>'text', audit_row->>'action', ''),
      coalesce(audit_row->'payload', '{}'::jsonb)
    );
  end loop;
end;
$$;

create or replace function public.rb_request_swap_with_notifications(
  p_id text,
  p_shift_id text,
  p_target_mode text default 'all',
  p_target_driver_id text default null,
  p_reason text default null,
  p_history jsonb default '[]'::jsonb,
  p_created_at timestamptz default null,
  p_notifications jsonb default '[]'::jsonb,
  p_audit_rows jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.rb_request_swap(p_id, p_shift_id, p_target_mode, p_target_driver_id, p_reason, p_history, p_created_at);
  perform public.rb_insert_notifications(p_notifications);
  perform public.rb_insert_audit_logs(p_audit_rows);
end;
$$;

create or replace function public.rb_cancel_swap_request_with_notifications(
  p_id text,
  p_history jsonb default '[]'::jsonb,
  p_cancelled_at timestamptz default null,
  p_notifications jsonb default '[]'::jsonb,
  p_audit_rows jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.rb_cancel_swap_request(p_id, p_history, p_cancelled_at);
  perform public.rb_insert_notifications(p_notifications);
  perform public.rb_insert_audit_logs(p_audit_rows);
end;
$$;

create or replace function public.rb_accept_swap_request_with_notifications(
  p_id text,
  p_history jsonb default '[]'::jsonb,
  p_accepted_at timestamptz default null,
  p_notifications jsonb default '[]'::jsonb,
  p_audit_rows jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.rb_accept_swap_request(p_id, p_history, p_accepted_at);
  perform public.rb_insert_notifications(p_notifications);
  perform public.rb_insert_audit_logs(p_audit_rows);
end;
$$;

create or replace function public.rb_decline_swap_request_with_notifications(
  p_id text,
  p_history jsonb default '[]'::jsonb,
  p_rejected_reason text default null,
  p_resolved_at timestamptz default null,
  p_notifications jsonb default '[]'::jsonb,
  p_audit_rows jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.rb_decline_swap_request(p_id, p_history, p_rejected_reason, p_resolved_at);
  perform public.rb_insert_notifications(p_notifications);
  perform public.rb_insert_audit_logs(p_audit_rows);
end;
$$;

create or replace function public.rb_resolve_swap_request_with_notifications(
  p_id text,
  p_status text,
  p_approved_driver_id text default null,
  p_rejected_reason text default null,
  p_history jsonb default '[]'::jsonb,
  p_resolved_at timestamptz default null,
  p_notifications jsonb default '[]'::jsonb,
  p_audit_rows jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.rb_resolve_swap_request(p_id, p_status, p_approved_driver_id, p_rejected_reason, p_history, p_resolved_at);
  perform public.rb_insert_notifications(p_notifications);
  perform public.rb_insert_audit_logs(p_audit_rows);
end;
$$;

create or replace function public.rb_push_diagnostics()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select case
    when not public.rb_is_staff() then
      jsonb_build_object('error', 'Only staff can view push diagnostics.')
    else
      coalesce((
        select jsonb_build_object(
          'total', count(*),
          'active', count(*) filter (where active is true),
          'inactive', count(*) filter (where active is not true),
          'driversActive', count(distinct driver_id) filter (where active is true and driver_id is not null),
          'staffActive', count(*) filter (where active is true and role in ('admin', 'dispatcher')),
          'lastSeenAt', max(last_seen_at),
          'lastDeliveryAt', max(last_delivery_at),
          'failedActive', count(*) filter (where active is true and last_error is not null),
          'platforms', coalesce(jsonb_object_agg(platform_label, platform_count), '{}'::jsonb)
        )
        from public.push_subscriptions ps
        cross join lateral (
          select coalesce(nullif(split_part(coalesce(ps.platform, 'Neznámé zařízení'), ' ', 1), ''), 'Neznámé') as platform_label
        ) platform
        cross join lateral (
          select count(*) as platform_count
          from public.push_subscriptions inner_ps
          where coalesce(nullif(split_part(coalesce(inner_ps.platform, 'Neznámé zařízení'), ' ', 1), ''), 'Neznámé') = platform.platform_label
        ) platform_counts
      ), jsonb_build_object(
        'total', 0,
        'active', 0,
        'inactive', 0,
        'driversActive', 0,
        'staffActive', 0,
        'failedActive', 0,
        'platforms', '{}'::jsonb
      ))
  end
$$;

revoke all on function private.rb_can_driver_notify_driver_for(text, text, text, text) from public;
revoke all on function private.rb_insert_notifications(jsonb) from public;
revoke all on function public.rb_insert_notifications(jsonb) from public, anon, service_role;
revoke all on function public.rb_insert_audit_logs(jsonb) from public, anon, service_role;
revoke all on function public.rb_request_swap_with_notifications(text, text, text, text, text, jsonb, timestamptz, jsonb, jsonb) from public, anon, service_role;
revoke all on function public.rb_cancel_swap_request_with_notifications(text, jsonb, timestamptz, jsonb, jsonb) from public, anon, service_role;
revoke all on function public.rb_accept_swap_request_with_notifications(text, jsonb, timestamptz, jsonb, jsonb) from public, anon, service_role;
revoke all on function public.rb_decline_swap_request_with_notifications(text, jsonb, text, timestamptz, jsonb, jsonb) from public, anon, service_role;
revoke all on function public.rb_resolve_swap_request_with_notifications(text, text, text, text, jsonb, timestamptz, jsonb, jsonb) from public, anon, service_role;
revoke all on function public.rb_push_diagnostics() from public, anon, service_role;

grant execute on function private.rb_can_driver_notify_driver_for(text, text, text, text) to authenticated;
grant execute on function private.rb_insert_notifications(jsonb) to authenticated;
grant execute on function public.rb_insert_notifications(jsonb) to authenticated;
grant execute on function public.rb_insert_audit_logs(jsonb) to authenticated;
grant execute on function public.rb_request_swap_with_notifications(text, text, text, text, text, jsonb, timestamptz, jsonb, jsonb) to authenticated;
grant execute on function public.rb_cancel_swap_request_with_notifications(text, jsonb, timestamptz, jsonb, jsonb) to authenticated;
grant execute on function public.rb_accept_swap_request_with_notifications(text, jsonb, timestamptz, jsonb, jsonb) to authenticated;
grant execute on function public.rb_decline_swap_request_with_notifications(text, jsonb, text, timestamptz, jsonb, jsonb) to authenticated;
grant execute on function public.rb_resolve_swap_request_with_notifications(text, text, text, text, jsonb, timestamptz, jsonb, jsonb) to authenticated;
grant execute on function public.rb_push_diagnostics() to authenticated;
