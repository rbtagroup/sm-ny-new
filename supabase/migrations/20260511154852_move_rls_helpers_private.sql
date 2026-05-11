create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create or replace function private.rb_current_role()
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

create or replace function private.rb_is_admin()
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

create or replace function private.rb_is_staff()
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
  limit 1
$$;

create or replace function private.rb_push_subscription_matches_profile(
  subscription_profile_id uuid,
  subscription_driver_id text,
  subscription_role text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when trim(lower(p.role)) = 'driver' then
        trim(lower(subscription_role)) = 'driver'
        and subscription_driver_id is not null
        and exists (
          select 1
          from public.drivers d
          where d.id = subscription_driver_id
            and d.profile_id = p.id
            and d.active is not false
        )
      when trim(lower(p.role)) in ('admin', 'dispatcher') then
        trim(lower(subscription_role)) = trim(lower(p.role))
        and subscription_driver_id is null
      else false
    end
    from public.profiles p
    where p.id = auth.uid()
      and p.id = subscription_profile_id
    limit 1
  ), false)
$$;

revoke all on function private.rb_current_role() from public;
revoke all on function private.rb_is_admin() from public;
revoke all on function private.rb_is_staff() from public;
revoke all on function private.rb_current_driver_id() from public;
revoke all on function private.rb_push_subscription_matches_profile(uuid, text, text) from public;

grant execute on function private.rb_current_role() to anon, authenticated, service_role;
grant execute on function private.rb_is_admin() to anon, authenticated, service_role;
grant execute on function private.rb_is_staff() to anon, authenticated, service_role;
grant execute on function private.rb_current_driver_id() to anon, authenticated, service_role;
grant execute on function private.rb_push_subscription_matches_profile(uuid, text, text) to anon, authenticated, service_role;

create or replace function public.rb_current_role()
returns text
language sql
stable
security invoker
set search_path = public, private
as $$
  select private.rb_current_role()
$$;

create or replace function public.rb_is_admin()
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$
  select private.rb_is_admin()
$$;

create or replace function public.rb_is_staff()
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$
  select private.rb_is_staff()
$$;

create or replace function public.rb_current_driver_id()
returns text
language sql
stable
security invoker
set search_path = public, private
as $$
  select private.rb_current_driver_id()
$$;

create or replace function public.rb_push_subscription_matches_profile(
  subscription_profile_id uuid,
  subscription_driver_id text,
  subscription_role text
)
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$
  select private.rb_push_subscription_matches_profile(subscription_profile_id, subscription_driver_id, subscription_role)
$$;

grant execute on function public.rb_current_role() to anon, authenticated;
grant execute on function public.rb_is_admin() to anon, authenticated;
grant execute on function public.rb_is_staff() to anon, authenticated;
grant execute on function public.rb_current_driver_id() to anon, authenticated;
grant execute on function public.rb_push_subscription_matches_profile(uuid, text, text) to anon, authenticated;
