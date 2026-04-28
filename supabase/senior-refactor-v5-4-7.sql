-- ============================================================
-- RBSHIFT v5.4.7 – SENIOR REFACTOR PATCH
-- Přidává DateTime Range dostupnost řidičů.
-- Spusť po nasazení v5.4.7.
-- ============================================================

alter table public.availability
  add column if not exists from_at timestamptz,
  add column if not exists to_at timestamptz;

alter table public.availability
  alter column weekday drop not null;

alter table public.availability
  alter column avail_date drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'availability_datetime_range_check'
  ) then
    alter table public.availability
      add constraint availability_datetime_range_check
      check (
        (from_at is not null and to_at is not null and to_at > from_at)
        or
        (from_at is null and to_at is null)
      );
  end if;
end $$;
