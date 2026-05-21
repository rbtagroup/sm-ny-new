-- If a shift is reassigned while an open settlement already exists, make sure
-- the new driver can review and submit their own editable settlement.

update public.shift_settlements as settlement
set
  inputs = jsonb_set(
    jsonb_set(
      coalesce(settlement.inputs, '{}'::jsonb),
      '{driver}',
      to_jsonb(coalesce(driver_row.name, '')),
      true
    ),
    '{rz}',
    to_jsonb(coalesce(vehicle_row.plate, '')),
    true
  ),
  status = case when settlement.status = 'submitted' then 'returned' else settlement.status end,
  submitted_at = case when settlement.status = 'submitted' then null else settlement.submitted_at end,
  returned_reason = case
    when settlement.status = 'submitted' then 'Výčetka byla vrácena kvůli změně přiřazeného řidiče. Zkontroluj údaje a odešli znovu.'
    else settlement.returned_reason
  end,
  updated_at = now()
from public.shifts as shift_row
left join public.drivers as driver_row on driver_row.id = shift_row.driver_id
left join public.vehicles as vehicle_row on vehicle_row.id = shift_row.vehicle_id
where settlement.shift_id = shift_row.id
  and settlement.status <> 'approved'
  and (
    nullif(settlement.inputs->>'driver', '') is distinct from driver_row.name
    or nullif(settlement.inputs->>'rz', '') is distinct from vehicle_row.plate
  );

create or replace function public.rb_sync_open_settlement_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_driver_name text := '';
  next_vehicle_plate text := '';
begin
  if new.driver_id is distinct from old.driver_id
    or new.vehicle_id is distinct from old.vehicle_id
  then
    select coalesce(name, '')
    into next_driver_name
    from public.drivers
    where id = new.driver_id;

    select coalesce(plate, '')
    into next_vehicle_plate
    from public.vehicles
    where id = new.vehicle_id;

    update public.shift_settlements
    set
      driver_id = new.driver_id,
      vehicle_id = new.vehicle_id,
      inputs = jsonb_set(
        jsonb_set(
          coalesce(inputs, '{}'::jsonb),
          '{driver}',
          to_jsonb(next_driver_name),
          true
        ),
        '{rz}',
        to_jsonb(next_vehicle_plate),
        true
      ),
      status = case when status = 'submitted' then 'returned' else status end,
      submitted_at = case when status = 'submitted' then null else submitted_at end,
      returned_reason = case
        when status = 'submitted' then 'Výčetka byla vrácena kvůli změně přiřazeného řidiče. Zkontroluj údaje a odešli znovu.'
        else returned_reason
      end,
      updated_at = now()
    where shift_id = new.id
      and status <> 'approved'
      and (
        driver_id is distinct from new.driver_id
        or vehicle_id is distinct from new.vehicle_id
        or nullif(inputs->>'driver', '') is distinct from next_driver_name
        or nullif(inputs->>'rz', '') is distinct from next_vehicle_plate
      );
  end if;

  return new;
end;
$$;

revoke all on function public.rb_sync_open_settlement_assignment() from public;
revoke all on function public.rb_sync_open_settlement_assignment() from anon;
revoke all on function public.rb_sync_open_settlement_assignment() from authenticated;
