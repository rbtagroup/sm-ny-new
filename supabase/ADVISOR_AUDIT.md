# Supabase Advisor Audit

Last run: 2026-05-20

## Checks

- `supabase db advisors --linked --level warn --fail-on none`: completed.
- `supabase db lint --linked --level warning --fail-on none`: no schema errors found.
- `supabase migration list --linked`: local and remote migration history matched.
- `supabase/rls-regression-tests.sql`: returned `rls_regression_passed`.
- `supabase db diff --linked --schema public,private,extensions`: completed after Docker Desktop was started; only `pg_net` extension metadata appeared in the diff.
- `supabase db diff --linked --schema public,private`: completed; only `create extension if not exists "pg_net" with schema "public";` appeared in the diff.

## Advisor Findings

### `extension_in_public` for `pg_net`

Status: accepted warning for now.

Supabase reports `pg_net` as installed in the `public` extension namespace, but the extension-owned runtime objects are exposed under the `net` schema and existing scheduler SQL calls `net.http_post`.

Safe rollback tests showed:

- `alter extension pg_net set schema net` fails because the extension contains the `net` schema.
- `alter extension pg_net set schema extensions` fails because `pg_net` does not support `SET SCHEMA`.

Do not drop/recreate `pg_net` casually in production. That could disrupt scheduler/push-related SQL using `net.http_post`. Revisit only during a planned DB maintenance window with a backup and explicit cron/function verification.

### `auth_leaked_password_protection`

Status: manual Supabase Auth setting.

Supabase Advisor reports leaked password protection as disabled. This is an Auth project setting, not a SQL/RLS migration. Enable it in Supabase Dashboard under Auth password/security settings if the project plan supports it.

## Next Safe Step

No application schema drift was found in `public`/`private`; the remaining diff noise is limited to the managed `pg_net` extension metadata.

Keep this warning on the maintenance backlog instead of trying to repair it during normal feature work.
