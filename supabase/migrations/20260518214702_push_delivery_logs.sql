create table if not exists public.push_delivery_logs (
  id text primary key,
  notification_id text references public.notifications(id) on delete cascade,
  notification_type text not null default 'info',
  target_driver_id text references public.drivers(id) on delete set null,
  target_role text not null default 'admin',
  requested_by uuid references public.profiles(id) on delete set null,
  recipients integer not null default 0 check (recipients >= 0),
  sent integer not null default 0 check (sent >= 0),
  failed integer not null default 0 check (failed >= 0),
  ok boolean not null default true,
  error text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists push_delivery_logs_notification_id_idx
  on public.push_delivery_logs (notification_id);

create index if not exists push_delivery_logs_created_at_idx
  on public.push_delivery_logs (created_at desc);

create index if not exists push_delivery_logs_target_driver_id_idx
  on public.push_delivery_logs (target_driver_id);

alter table public.push_delivery_logs enable row level security;

drop policy if exists "push_delivery_logs_select_staff" on public.push_delivery_logs;
create policy "push_delivery_logs_select_staff"
on public.push_delivery_logs
for select
using ((select public.rb_is_staff()));

revoke all on table public.push_delivery_logs from anon;
grant select on table public.push_delivery_logs to authenticated;
grant all on table public.push_delivery_logs to service_role;

alter table public.push_delivery_logs replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.push_delivery_logs;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
