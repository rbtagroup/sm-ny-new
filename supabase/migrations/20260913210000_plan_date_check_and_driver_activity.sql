-- Shift dates must be plausible even when an older cached app version writes them.
-- NOT VALID checks every new or changed row but keeps the one legacy row (year 0005) until dispatch fixes it.
alter table public.shifts
  add constraint shifts_shift_date_plausible
  check (shift_date between date '2020-01-01' and date '2100-12-31') not valid;

-- Staff overview for inviting drivers: whether the driver has a login and when it was last active.
-- Password sign-in alone is misleading for home-screen apps that stay signed in, so session refreshes count too.
create or replace function private.rb_driver_activity()
returns table (driver_id text, has_login boolean, last_active_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.id,
    u.id is not null,
    (
      select max(activity.at)
      from (
        select u.last_sign_in_at as at
        union all
        select coalesce(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at)
        from auth.sessions s
        where s.user_id = u.id
      ) as activity
    )
  from public.drivers d
  left join auth.users u on u.id = d.profile_id
  where private.rb_is_staff()
$$;

revoke all on function private.rb_driver_activity() from public, anon, service_role;
grant execute on function private.rb_driver_activity() to authenticated;

create or replace function public.rb_driver_activity()
returns table (driver_id text, has_login boolean, last_active_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select activity.driver_id, activity.has_login, activity.last_active_at
  from private.rb_driver_activity() as activity
$$;

revoke all on function public.rb_driver_activity() from public, anon, service_role;
grant execute on function public.rb_driver_activity() to authenticated;
