create or replace function public.rb_cleanup_invalid_push_subscriptions(
  p_min_failures integer default 1
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if not public.rb_is_staff() then
    raise exception 'Only staff can clean up push subscriptions.';
  end if;

  update public.push_subscriptions
  set
    active = false,
    last_seen_at = now()
  where active is true
    and (
      last_error is not null
      or delivery_failures >= greatest(coalesce(p_min_failures, 1), 1)
    );

  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'deactivated', v_count,
    'minFailures', greatest(coalesce(p_min_failures, 1), 1)
  );
end;
$$;

revoke all on function public.rb_cleanup_invalid_push_subscriptions(integer) from public, anon, service_role;
grant execute on function public.rb_cleanup_invalid_push_subscriptions(integer) to authenticated;
