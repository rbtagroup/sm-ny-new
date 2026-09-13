-- Drivers see colleagues only through a name directory, not their phone, e-mail or dispatch notes.

create or replace function private.rb_driver_directory()
returns table (id text, name text, active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.name, d.active
  from public.drivers d
  where private.rb_has_app_access()
  order by d.name, d.id
$$;

revoke all on function private.rb_driver_directory() from public, anon, service_role;
grant execute on function private.rb_driver_directory() to authenticated;

create or replace function public.rb_driver_directory()
returns table (id text, name text, active boolean)
language sql
stable
set search_path = ''
as $$
  select directory.id, directory.name, directory.active
  from private.rb_driver_directory() as directory
$$;

revoke all on function public.rb_driver_directory() from public, anon, service_role;
grant execute on function public.rb_driver_directory() to authenticated;

alter policy "drivers_select_signed" on public.drivers
  using ((select public.rb_is_staff()) or profile_id = (select auth.uid()));

-- Colleague checks in notification policies can no longer read other driver rows directly.
create or replace function private.rb_driver_is_active(p_driver_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.drivers d
    where d.id = p_driver_id
      and d.active is not false
  )
$$;

revoke all on function private.rb_driver_is_active(text) from public, anon, service_role;
grant execute on function private.rb_driver_is_active(text) to authenticated;

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
        and private.rb_driver_is_active(notice_target_driver_id)
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
                and (sr.target_mode = 'all' or sr.target_driver_id = notice_target_driver_id)
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
