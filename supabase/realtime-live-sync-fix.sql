-- ============================================================
-- RBSHIFT – REALTIME LIVE SYNC FIX
-- Spusť v Supabase SQL Editoru, pokud se změny směn zobrazují
-- ostatním uživatelům až po ručním refresh aplikace.
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
