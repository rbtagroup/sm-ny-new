-- The only legacy shift with an implausible date (year 0005, a duplicate of a confirmed shift) was removed,
-- so the date check now covers every existing shift as well.
alter table public.shifts validate constraint shifts_shift_date_plausible;
