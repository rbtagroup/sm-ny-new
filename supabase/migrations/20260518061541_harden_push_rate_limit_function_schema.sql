create schema if not exists private;

create or replace function private.rb_check_push_rate_limit(
  bucket_key text,
  weight integer default 1,
  max_count integer default 30,
  window_seconds integer default 60
)
returns table (
  ok boolean,
  retry_after integer,
  used_count integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_key text := nullif(trim(bucket_key), '');
  safe_weight integer := greatest(1, coalesce(weight, 1));
  safe_max integer := greatest(1, coalesce(max_count, 30));
  safe_window integer := greatest(1, coalesce(window_seconds, 60));
  current_count integer;
  current_reset timestamptz;
begin
  if normalized_key is null then
    ok := false;
    retry_after := safe_window;
    used_count := safe_weight;
    reset_at := now() + make_interval(secs => safe_window);
    return next;
    return;
  end if;

  delete from private.push_rate_limits
  where private.push_rate_limits.reset_at < now() - interval '1 hour';

  insert into private.push_rate_limits (bucket_key, count, reset_at, updated_at)
  values (normalized_key, safe_weight, now() + make_interval(secs => safe_window), now())
  on conflict (bucket_key) do update
  set
    count = case
      when private.push_rate_limits.reset_at <= now() then excluded.count
      else private.push_rate_limits.count + excluded.count
    end,
    reset_at = case
      when private.push_rate_limits.reset_at <= now() then excluded.reset_at
      else private.push_rate_limits.reset_at
    end,
    updated_at = now()
  returning private.push_rate_limits.count, private.push_rate_limits.reset_at
  into current_count, current_reset;

  ok := current_count <= safe_max;
  retry_after := greatest(1, ceil(extract(epoch from (current_reset - now())))::integer);
  used_count := current_count;
  reset_at := current_reset;
  return next;
end;
$$;

create or replace function public.rb_check_push_rate_limit(
  bucket_key text,
  weight integer default 1,
  max_count integer default 30,
  window_seconds integer default 60
)
returns table (
  ok boolean,
  retry_after integer,
  used_count integer,
  reset_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.rb_check_push_rate_limit(bucket_key, weight, max_count, window_seconds);
$$;

revoke all on function private.rb_check_push_rate_limit(text, integer, integer, integer) from public;
revoke all on function private.rb_check_push_rate_limit(text, integer, integer, integer) from anon;
revoke all on function private.rb_check_push_rate_limit(text, integer, integer, integer) from authenticated;
grant execute on function private.rb_check_push_rate_limit(text, integer, integer, integer) to service_role;

revoke all on function public.rb_check_push_rate_limit(text, integer, integer, integer) from public;
revoke all on function public.rb_check_push_rate_limit(text, integer, integer, integer) from anon;
revoke all on function public.rb_check_push_rate_limit(text, integer, integer, integer) from authenticated;
grant execute on function public.rb_check_push_rate_limit(text, integer, integer, integer) to service_role;
