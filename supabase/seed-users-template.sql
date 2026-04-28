-- ============================================================
-- RBSHIFT – SEED UŽIVATELŮ, ROLÍ, ŘIDIČŮ A AUT
-- Použití:
-- 1) Nejdřív vytvoř uživatele v Supabase: Authentication → Users → Add user.
-- 2) Tady uprav e-maily, jména, telefony a auta.
-- 3) Spusť v Supabase SQL Editoru.
-- ============================================================

-- ADMIN + DISPEČEŘI
create temporary table rb_staff_seed (
  email text,
  role text,
  full_name text,
  phone text
);

insert into rb_staff_seed (email, role, full_name, phone) values
  ('prace@rbgroup.cz', 'admin', 'Lukáš Blaha', null),
  ('romana@rbgroup.cz', 'dispatcher', 'Romana Blahová', null);

insert into public.profiles (id, role, full_name, phone)
select u.id, s.role, s.full_name, s.phone
from rb_staff_seed s
join auth.users u on lower(u.email) = lower(s.email)
on conflict (id) do update
set role = excluded.role,
    full_name = excluded.full_name,
    phone = excluded.phone;

-- ŘIDIČI
create temporary table rb_driver_seed (
  email text,
  driver_id text,
  full_name text,
  phone text,
  note text
);

insert into rb_driver_seed (email, driver_id, full_name, phone, note) values
  ('ridic1@rbgroup.cz', 'driver_roman', 'Roman', null, null),
  ('ridic2@rbgroup.cz', 'driver_petr', 'Petr', null, null),
  ('ridic3@rbgroup.cz', 'driver_michal', 'Michal', null, null);

insert into public.profiles (id, role, full_name, phone)
select u.id, 'driver', d.full_name, d.phone
from rb_driver_seed d
join auth.users u on lower(u.email) = lower(d.email)
on conflict (id) do update
set role = 'driver',
    full_name = excluded.full_name,
    phone = excluded.phone;

insert into public.drivers (id, profile_id, name, phone, email, active, note)
select d.driver_id, u.id, d.full_name, d.phone, u.email, true, d.note
from rb_driver_seed d
join auth.users u on lower(u.email) = lower(d.email)
on conflict (id) do update
set profile_id = excluded.profile_id,
    name = excluded.name,
    phone = excluded.phone,
    email = excluded.email,
    active = true,
    note = excluded.note,
    updated_at = now();

-- AUTA
insert into public.vehicles (id, name, plate, active, note) values
  ('car_tesla_1', 'Tesla 1', '1BH 0001', true, null),
  ('car_tesla_2', 'Tesla 2', '1BH 0002', true, null),
  ('car_taxi_3', 'Taxi 3', '1BH 0003', true, null)
on conflict (id) do update
set name = excluded.name,
    plate = excluded.plate,
    active = excluded.active,
    note = excluded.note,
    updated_at = now();

-- KONTROLA: chybějící účty v Authentication → Users
select 'CHYBÍ V AUTH USERS' as problem, s.email, s.role, s.full_name
from rb_staff_seed s
left join auth.users u on lower(u.email) = lower(s.email)
where u.id is null
union all
select 'CHYBÍ V AUTH USERS' as problem, d.email, 'driver' as role, d.full_name
from rb_driver_seed d
left join auth.users u on lower(u.email) = lower(d.email)
where u.id is null;

-- KONTROLA: profily a napojení řidičů
select u.email, p.role, p.full_name, d.id as driver_id, d.name as driver_name, d.active
from auth.users u
left join public.profiles p on p.id = u.id
left join public.drivers d on d.profile_id = u.id
order by p.role, p.full_name;
