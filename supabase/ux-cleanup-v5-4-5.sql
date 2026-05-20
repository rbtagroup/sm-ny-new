-- ============================================================
-- RBSHIFT v5.4.5 – UX CLEANUP / AVAILABILITY DATE PATCH
-- Přidává možnost dostupnosti na konkrétní datum.
-- LEGACY PATCH - DO NOT RUN DIRECTLY on a migration-managed DB.
-- Source of truth: supabase/migrations/. If this behavior is needed again,
-- copy the specific change into a new timestamped migration and verify it.
-- ============================================================

alter table public.availability
  add column if not exists avail_date date;

alter table public.availability
  alter column weekday drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'availability_weekday_or_date_check'
  ) then
    alter table public.availability
      add constraint availability_weekday_or_date_check
      check (
        (avail_date is not null and weekday is null)
        or
        (avail_date is null and weekday between 0 and 6)
      );
  end if;
end $$;
