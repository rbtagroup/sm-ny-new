-- Keep open shift settlements assigned to the same driver/vehicle as their
-- source shift. Approved settlements stay frozen as closed accounting records.

update public.shift_settlements as settlement
set
  driver_id = shift_row.driver_id,
  vehicle_id = shift_row.vehicle_id,
  updated_at = now()
from public.shifts as shift_row
where settlement.shift_id = shift_row.id
  and settlement.status <> 'approved'
  and (
    settlement.driver_id is distinct from shift_row.driver_id
    or settlement.vehicle_id is distinct from shift_row.vehicle_id
  );

create or replace function public.rb_sync_open_settlement_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.driver_id is distinct from old.driver_id
    or new.vehicle_id is distinct from old.vehicle_id
  then
    update public.shift_settlements
    set
      driver_id = new.driver_id,
      vehicle_id = new.vehicle_id,
      updated_at = now()
    where shift_id = new.id
      and status <> 'approved'
      and (
        driver_id is distinct from new.driver_id
        or vehicle_id is distinct from new.vehicle_id
      );
  end if;

  return new;
end;
$$;

drop trigger if exists shifts_sync_open_settlement_assignment on public.shifts;

create trigger shifts_sync_open_settlement_assignment
after update of driver_id, vehicle_id on public.shifts
for each row
execute function public.rb_sync_open_settlement_assignment();

revoke all on function public.rb_sync_open_settlement_assignment() from public;
revoke all on function public.rb_sync_open_settlement_assignment() from anon;
revoke all on function public.rb_sync_open_settlement_assignment() from authenticated;
