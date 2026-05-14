drop policy if exists "audit_logs_insert_authenticated" on public.audit_logs;

create policy "audit_logs_insert_authenticated"
on public.audit_logs
for insert
to authenticated
with check ((select auth.uid()) is not null);
