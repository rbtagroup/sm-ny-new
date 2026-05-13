create or replace function public.rb_can_driver_notify_driver(
  notice_type text,
  notice_shift_id text,
  notice_target_driver_id text
)
returns boolean
language sql
stable
set search_path = public
as $$
  with me as (
    select public.rb_current_driver_id() as driver_id
  )
  select coalesce((
    select exists (
      select 1
      from me
      where me.driver_id is not null
        and notice_target_driver_id is not null
        and notice_target_driver_id <> me.driver_id
        and exists (
          select 1
          from public.drivers target_driver
          where target_driver.id = notice_target_driver_id
            and target_driver.active is not false
        )
        and (
          (
            notice_type = 'swap-offer'
            and exists (
              select 1
              from public.swap_requests sr
              join public.shifts sh on sh.id = sr.shift_id
              where sr.shift_id = notice_shift_id
                and sh.driver_id = me.driver_id
                and sr.driver_id = me.driver_id
                and sr.status = 'pending'
                and (
                  sr.target_mode = 'all'
                  or sr.target_driver_id = notice_target_driver_id
                )
            )
          )
          or (
            notice_type = 'swap-accepted'
            and exists (
              select 1
              from public.swap_requests sr
              where sr.shift_id = notice_shift_id
                and sr.status = 'accepted'
                and sr.accepted_by_driver_id = me.driver_id
                and sr.driver_id = notice_target_driver_id
            )
          )
          or (
            notice_type = 'swap-rejected'
            and exists (
              select 1
              from public.swap_requests sr
              where sr.shift_id = notice_shift_id
                and sr.status = 'rejected'
                and sr.target_mode = 'driver'
                and sr.target_driver_id = me.driver_id
                and sr.driver_id = notice_target_driver_id
            )
          )
        )
    )
  ), false)
$$;

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

  if old.status = 'pending'
    and old.target_mode = 'driver'
    and old.target_driver_id = current_driver
    and new.status = 'rejected'
    and new.id is not distinct from old.id
    and new.shift_id is not distinct from old.shift_id
    and new.driver_id is not distinct from old.driver_id
    and new.target_mode is not distinct from old.target_mode
    and new.target_driver_id is not distinct from old.target_driver_id
    and new.accepted_by_driver_id is not distinct from old.accepted_by_driver_id
    and new.approved_driver_id is not distinct from old.approved_driver_id
    and new.reason is not distinct from old.reason
    and new.created_at is not distinct from old.created_at
    and new.accepted_at is not distinct from old.accepted_at
    and new.cancelled_at is not distinct from old.cancelled_at
  then
    return new;
  end if;

  raise exception 'Driver is not allowed to update this swap request.';
end;
$$;

create or replace function private.rb_decline_swap_request(
  p_id text,
  p_history jsonb default '[]'::jsonb,
  p_rejected_reason text default null,
  p_resolved_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_driver text;
  request_row public.swap_requests%rowtype;
  resolved_at_value timestamptz := coalesce(p_resolved_at, now());
begin
  select d.id
    into current_driver
  from public.drivers d
  where d.profile_id = auth.uid()
  limit 1;

  if current_driver is null then
    raise exception 'Driver profile is required.';
  end if;

  select *
    into request_row
  from public.swap_requests
  where id = p_id
    and status = 'pending'
  for update;

  if not found then
    raise exception 'Swap request not found or already resolved.';
  end if;

  if request_row.target_mode is distinct from 'driver' or request_row.target_driver_id is distinct from current_driver then
    raise exception 'Only targeted swap offers can be declined by the target driver.';
  end if;

  update public.swap_requests
    set status = 'rejected',
        rejected_reason = coalesce(nullif(p_rejected_reason, ''), 'Odmítnuto řidičem'),
        resolved_at = resolved_at_value,
        history = coalesce(p_history, history)
  where id = p_id;
end;
$$;

revoke all on function private.rb_decline_swap_request(text, jsonb, text, timestamptz) from public;
revoke all on function private.rb_decline_swap_request(text, jsonb, text, timestamptz) from anon;
revoke all on function private.rb_decline_swap_request(text, jsonb, text, timestamptz) from service_role;
grant execute on function private.rb_decline_swap_request(text, jsonb, text, timestamptz) to authenticated;

create or replace function public.rb_decline_swap_request(
  p_id text,
  p_history jsonb default '[]'::jsonb,
  p_rejected_reason text default null,
  p_resolved_at timestamptz default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.rb_decline_swap_request(p_id, p_history, p_rejected_reason, p_resolved_at)
$$;

revoke all on function public.rb_decline_swap_request(text, jsonb, text, timestamptz) from public;
revoke all on function public.rb_decline_swap_request(text, jsonb, text, timestamptz) from anon;
revoke all on function public.rb_decline_swap_request(text, jsonb, text, timestamptz) from service_role;
grant execute on function public.rb_decline_swap_request(text, jsonb, text, timestamptz) to authenticated;
