-- ============================================================
-- RBSHIFT – REALTIME LIVE SYNC FIX
-- LEGACY PATCH - DO NOT RUN DIRECTLY on a migration-managed DB.
-- Source of truth: supabase/migrations/. If this behavior is needed again,
-- copy the specific change into a new timestamped migration and verify it.
-- Historická poznámka: vzniklo pro live-sync zpoždění do ručního refresh.
-- ============================================================

alter table public.drivers replica identity full;
alter table public.vehicles replica identity full;
alter table public.shifts replica identity full;
alter table public.absences replica identity full;
alter table public.availability replica identity full;
alter table public.service_blocks replica identity full;
alter table public.swap_requests replica identity full;
alter table public.notifications replica identity full;
alter table public.push_subscriptions replica identity full;
alter table public.audit_logs replica identity full;
alter table public.app_settings replica identity full;

do $$ begin alter publication supabase_realtime add table public.drivers; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.vehicles; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.shifts; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.absences; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.availability; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.service_blocks; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.swap_requests; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.push_subscriptions; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.audit_logs; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.app_settings; exception when duplicate_object then null; end $$;
