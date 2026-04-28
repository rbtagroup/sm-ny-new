-- ============================================================
-- RBSHIFT v5.4.2 – hard delete směn
-- Spusť pouze pokud Supabase při trvalém smazání hlásí RLS chybu.
-- Umožní adminovi/dispečerovi mazat směny, související výměny a notifikace.
-- ============================================================

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

grant execute on function public.rb_is_staff() to authenticated;

drop policy if exists "shifts_delete_staff" on public.shifts;
create policy "shifts_delete_staff"
on public.shifts
for delete
to authenticated
using ((select public.rb_is_staff()));

drop policy if exists "swap_requests_delete_staff" on public.swap_requests;
create policy "swap_requests_delete_staff"
on public.swap_requests
for delete
to authenticated
using ((select public.rb_is_staff()));

drop policy if exists "notifications_delete_staff" on public.notifications;
create policy "notifications_delete_staff"
on public.notifications
for delete
to authenticated
using ((select public.rb_is_staff()));
