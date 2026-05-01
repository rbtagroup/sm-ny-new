-- RBSHIFT push subscription hardening
-- Spustit v Supabase SQL editoru.
--
-- Řeší P0:
-- - uživatel nemůže uložit push zařízení s cizím driver_id
-- - řidič nemůže uložit push zařízení s role=admin/dispatcher
-- - existující nevalidní aktivní subscriptions se vypnou

create or replace function public.rb_push_subscription_matches_profile(
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

grant execute on function public.rb_push_subscription_matches_profile(uuid, text, text) to authenticated;

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_select_own_or_staff" on public.push_subscriptions;
drop policy if exists "push_insert_own" on public.push_subscriptions;
drop policy if exists "push_update_own_or_staff" on public.push_subscriptions;
drop policy if exists "push_delete_staff" on public.push_subscriptions;

drop policy if exists "push_subscriptions_select_own_or_staff" on public.push_subscriptions;
drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
drop policy if exists "push_subscriptions_update_own_or_staff" on public.push_subscriptions;
drop policy if exists "push_subscriptions_delete_staff" on public.push_subscriptions;

create policy "push_subscriptions_select_own_or_staff"
on public.push_subscriptions
for select
to authenticated
using (
  profile_id = auth.uid()
  or (select public.rb_is_staff())
);

create policy "push_subscriptions_insert_own"
on public.push_subscriptions
for insert
to authenticated
with check (
  (select public.rb_is_staff())
  or public.rb_push_subscription_matches_profile(profile_id, driver_id, role)
);

create policy "push_subscriptions_update_own_or_staff"
on public.push_subscriptions
for update
to authenticated
using (
  profile_id = auth.uid()
  or (select public.rb_is_staff())
)
with check (
  (select public.rb_is_staff())
  or public.rb_push_subscription_matches_profile(profile_id, driver_id, role)
);

create policy "push_subscriptions_delete_staff"
on public.push_subscriptions
for delete
to authenticated
using (
  (select public.rb_is_staff())
);

update public.push_subscriptions ps
set
  active = false,
  last_seen_at = now()
where ps.active is true
  and (
    not exists (
      select 1
      from public.profiles p
      where p.id = ps.profile_id
    )
    or exists (
      select 1
      from public.profiles p
      where p.id = ps.profile_id
        and (
          (
            trim(lower(p.role)) = 'driver'
            and (
              trim(lower(ps.role)) <> 'driver'
              or ps.driver_id is null
              or not exists (
                select 1
                from public.drivers d
                where d.id = ps.driver_id
                  and d.profile_id = p.id
                  and d.active is not false
              )
            )
          )
          or (
            trim(lower(p.role)) in ('admin', 'dispatcher')
            and (
              trim(lower(ps.role)) <> trim(lower(p.role))
              or ps.driver_id is not null
            )
          )
          or trim(lower(p.role)) not in ('admin', 'dispatcher', 'driver')
        )
    )
  );
