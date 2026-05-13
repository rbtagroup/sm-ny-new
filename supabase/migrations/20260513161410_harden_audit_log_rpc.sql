create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.rb_insert_audit_log(
  p_id text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  insert into public.audit_logs (id, actor_id, action, payload)
  values (
    coalesce(nullif(p_id, ''), 'log_' || pg_catalog.gen_random_uuid()::text),
    auth.uid(),
    coalesce(p_action, ''),
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (id) do nothing;
end;
$$;

create or replace function public.rb_insert_audit_log(
  p_id text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.rb_insert_audit_log(p_id, p_action, p_payload)
$$;

revoke all on function private.rb_insert_audit_log(text, text, jsonb) from public;
revoke all on function public.rb_insert_audit_log(text, text, jsonb) from public;
revoke all on function public.rb_insert_audit_log(text, text, jsonb) from anon;
revoke all on function public.rb_insert_audit_log(text, text, jsonb) from service_role;

grant execute on function private.rb_insert_audit_log(text, text, jsonb) to authenticated;
grant execute on function public.rb_insert_audit_log(text, text, jsonb) to authenticated;
