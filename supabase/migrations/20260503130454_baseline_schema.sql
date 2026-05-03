create extension if not exists "pg_net" with schema "public";


  create table "public"."absences" (
    "id" text not null,
    "driver_id" text not null,
    "from_date" date not null,
    "to_date" date not null,
    "reason" text,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."absences" enable row level security;


  create table "public"."app_settings" (
    "id" text not null default 'default'::text,
    "payload" jsonb not null default '{}'::jsonb,
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."app_settings" enable row level security;


  create table "public"."audit_logs" (
    "id" text not null,
    "actor_id" uuid,
    "action" text not null,
    "payload" jsonb,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."audit_logs" enable row level security;


  create table "public"."availability" (
    "id" text not null,
    "driver_id" text not null,
    "weekday" integer,
    "start_time" time without time zone not null,
    "end_time" time without time zone not null,
    "note" text,
    "created_at" timestamp with time zone not null default now(),
    "avail_date" date,
    "from_at" timestamp with time zone,
    "to_at" timestamp with time zone
      );


alter table "public"."availability" enable row level security;


  create table "public"."drivers" (
    "id" text not null,
    "profile_id" uuid,
    "name" text not null,
    "phone" text,
    "email" text,
    "active" boolean not null default true,
    "note" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."drivers" enable row level security;


  create table "public"."notifications" (
    "id" text not null,
    "target_driver_id" text,
    "target_role" text not null default 'admin'::text,
    "type" text not null default 'info'::text,
    "shift_id" text,
    "title" text not null,
    "body" text,
    "read_by" jsonb not null default '[]'::jsonb,
    "created_at" timestamp with time zone not null default now(),
    "payload" jsonb not null default '{}'::jsonb
      );


alter table "public"."notifications" enable row level security;


  create table "public"."profiles" (
    "id" uuid not null,
    "role" text not null default 'driver'::text,
    "full_name" text not null,
    "phone" text,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."profiles" enable row level security;


  create table "public"."push_subscriptions" (
    "id" text not null,
    "profile_id" uuid,
    "driver_id" text,
    "role" text not null default 'driver'::text,
    "endpoint" text not null,
    "subscription" jsonb not null,
    "platform" text,
    "active" boolean not null default true,
    "created_at" timestamp with time zone not null default now(),
    "last_seen_at" timestamp with time zone not null default now()
      );


alter table "public"."push_subscriptions" enable row level security;


  create table "public"."service_blocks" (
    "id" text not null,
    "vehicle_id" text not null,
    "from_date" date not null,
    "to_date" date not null,
    "reason" text,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."service_blocks" enable row level security;


  create table "public"."shift_settlements" (
    "id" text not null,
    "shift_id" text not null,
    "driver_id" text,
    "vehicle_id" text,
    "status" text not null default 'draft'::text,
    "inputs" jsonb not null default '{}'::jsonb,
    "metrics" jsonb not null default '{}'::jsonb,
    "config" jsonb not null default '{}'::jsonb,
    "note" text,
    "submitted_at" timestamp with time zone,
    "approved_at" timestamp with time zone,
    "approved_by" text,
    "returned_reason" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."shift_settlements" enable row level security;


  create table "public"."shifts" (
    "id" text not null,
    "shift_date" date not null,
    "start_time" time without time zone not null,
    "end_time" time without time zone not null,
    "driver_id" text,
    "vehicle_id" text,
    "type" text not null default 'day'::text,
    "status" text not null default 'assigned'::text,
    "note" text,
    "instruction" text,
    "decline_reason" text,
    "actual_start_at" timestamp with time zone,
    "actual_end_at" timestamp with time zone,
    "swap_request_status" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."shifts" enable row level security;


  create table "public"."swap_requests" (
    "id" text not null,
    "shift_id" text,
    "driver_id" text,
    "target_mode" text not null default 'all'::text,
    "target_driver_id" text,
    "accepted_by_driver_id" text,
    "approved_driver_id" text,
    "status" text not null default 'pending'::text,
    "reason" text,
    "rejected_reason" text,
    "history" jsonb not null default '[]'::jsonb,
    "created_at" timestamp with time zone not null default now(),
    "accepted_at" timestamp with time zone,
    "resolved_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone
      );


alter table "public"."swap_requests" enable row level security;


  create table "public"."vehicles" (
    "id" text not null,
    "name" text not null,
    "plate" text not null,
    "active" boolean not null default true,
    "note" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."vehicles" enable row level security;

CREATE UNIQUE INDEX absences_pkey ON public.absences USING btree (id);

CREATE UNIQUE INDEX app_settings_pkey ON public.app_settings USING btree (id);

CREATE UNIQUE INDEX audit_logs_pkey ON public.audit_logs USING btree (id);

CREATE UNIQUE INDEX availability_pkey ON public.availability USING btree (id);

CREATE UNIQUE INDEX drivers_pkey ON public.drivers USING btree (id);

CREATE INDEX idx_absences_driver_id ON public.absences USING btree (driver_id);

CREATE INDEX idx_audit_logs_actor_id ON public.audit_logs USING btree (actor_id);

CREATE INDEX idx_availability_driver_id ON public.availability USING btree (driver_id);

CREATE INDEX idx_drivers_profile_id ON public.drivers USING btree (profile_id);

CREATE INDEX idx_notifications_shift_id ON public.notifications USING btree (shift_id);

CREATE INDEX idx_notifications_target_driver_id ON public.notifications USING btree (target_driver_id);

CREATE INDEX idx_push_subscriptions_driver_id ON public.push_subscriptions USING btree (driver_id);

CREATE INDEX idx_push_subscriptions_profile_id ON public.push_subscriptions USING btree (profile_id);

CREATE INDEX idx_service_blocks_vehicle_id ON public.service_blocks USING btree (vehicle_id);

CREATE INDEX idx_shift_settlements_vehicle_id ON public.shift_settlements USING btree (vehicle_id);

CREATE INDEX idx_shifts_driver_id ON public.shifts USING btree (driver_id);

CREATE INDEX idx_shifts_vehicle_id ON public.shifts USING btree (vehicle_id);

CREATE INDEX idx_swap_requests_accepted_by_driver_id ON public.swap_requests USING btree (accepted_by_driver_id);

CREATE INDEX idx_swap_requests_approved_driver_id ON public.swap_requests USING btree (approved_driver_id);

CREATE INDEX idx_swap_requests_driver_id ON public.swap_requests USING btree (driver_id);

CREATE INDEX idx_swap_requests_shift_id ON public.swap_requests USING btree (shift_id);

CREATE INDEX idx_swap_requests_target_driver_id ON public.swap_requests USING btree (target_driver_id);

CREATE UNIQUE INDEX notifications_daily_coverage_once ON public.notifications USING btree (type, target_role) WHERE (("left"(type, 15) = 'daily-coverage:'::text) AND (target_role = 'admin'::text));

CREATE UNIQUE INDEX notifications_driver_reminder_once ON public.notifications USING btree (type, target_driver_id) WHERE (("left"(type, 23) = 'driver-signup-reminder:'::text) AND (target_driver_id IS NOT NULL));

CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id);

CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id);

CREATE UNIQUE INDEX push_subscriptions_endpoint_key ON public.push_subscriptions USING btree (endpoint);

CREATE UNIQUE INDEX push_subscriptions_pkey ON public.push_subscriptions USING btree (id);

CREATE UNIQUE INDEX service_blocks_pkey ON public.service_blocks USING btree (id);

CREATE INDEX shift_settlements_driver_id_idx ON public.shift_settlements USING btree (driver_id);

CREATE UNIQUE INDEX shift_settlements_pkey ON public.shift_settlements USING btree (id);

CREATE UNIQUE INDEX shift_settlements_shift_id_key ON public.shift_settlements USING btree (shift_id);

CREATE INDEX shift_settlements_status_idx ON public.shift_settlements USING btree (status);

CREATE INDEX shift_settlements_submitted_at_idx ON public.shift_settlements USING btree (submitted_at DESC);

CREATE UNIQUE INDEX shifts_pkey ON public.shifts USING btree (id);

CREATE UNIQUE INDEX swap_requests_pkey ON public.swap_requests USING btree (id);

CREATE UNIQUE INDEX vehicles_pkey ON public.vehicles USING btree (id);

alter table "public"."absences" add constraint "absences_pkey" PRIMARY KEY using index "absences_pkey";

alter table "public"."app_settings" add constraint "app_settings_pkey" PRIMARY KEY using index "app_settings_pkey";

alter table "public"."audit_logs" add constraint "audit_logs_pkey" PRIMARY KEY using index "audit_logs_pkey";

alter table "public"."availability" add constraint "availability_pkey" PRIMARY KEY using index "availability_pkey";

alter table "public"."drivers" add constraint "drivers_pkey" PRIMARY KEY using index "drivers_pkey";

alter table "public"."notifications" add constraint "notifications_pkey" PRIMARY KEY using index "notifications_pkey";

alter table "public"."profiles" add constraint "profiles_pkey" PRIMARY KEY using index "profiles_pkey";

alter table "public"."push_subscriptions" add constraint "push_subscriptions_pkey" PRIMARY KEY using index "push_subscriptions_pkey";

alter table "public"."service_blocks" add constraint "service_blocks_pkey" PRIMARY KEY using index "service_blocks_pkey";

alter table "public"."shift_settlements" add constraint "shift_settlements_pkey" PRIMARY KEY using index "shift_settlements_pkey";

alter table "public"."shifts" add constraint "shifts_pkey" PRIMARY KEY using index "shifts_pkey";

alter table "public"."swap_requests" add constraint "swap_requests_pkey" PRIMARY KEY using index "swap_requests_pkey";

alter table "public"."vehicles" add constraint "vehicles_pkey" PRIMARY KEY using index "vehicles_pkey";

alter table "public"."absences" add constraint "absences_driver_id_fkey" FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE not valid;

alter table "public"."absences" validate constraint "absences_driver_id_fkey";

alter table "public"."audit_logs" add constraint "audit_logs_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL not valid;

alter table "public"."audit_logs" validate constraint "audit_logs_actor_id_fkey";

alter table "public"."availability" add constraint "availability_datetime_range_check" CHECK ((((from_at IS NOT NULL) AND (to_at IS NOT NULL) AND (to_at > from_at)) OR ((from_at IS NULL) AND (to_at IS NULL)))) not valid;

alter table "public"."availability" validate constraint "availability_datetime_range_check";

alter table "public"."availability" add constraint "availability_driver_id_fkey" FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE not valid;

alter table "public"."availability" validate constraint "availability_driver_id_fkey";

alter table "public"."availability" add constraint "availability_weekday_check" CHECK (((weekday >= 0) AND (weekday <= 6))) not valid;

alter table "public"."availability" validate constraint "availability_weekday_check";

alter table "public"."availability" add constraint "availability_weekday_or_date_check" CHECK ((((avail_date IS NOT NULL) AND (weekday IS NULL)) OR ((avail_date IS NULL) AND ((weekday >= 0) AND (weekday <= 6))))) not valid;

alter table "public"."availability" validate constraint "availability_weekday_or_date_check";

alter table "public"."drivers" add constraint "drivers_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL not valid;

alter table "public"."drivers" validate constraint "drivers_profile_id_fkey";

alter table "public"."notifications" add constraint "notifications_shift_id_fkey" FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE SET NULL not valid;

alter table "public"."notifications" validate constraint "notifications_shift_id_fkey";

alter table "public"."notifications" add constraint "notifications_target_driver_id_fkey" FOREIGN KEY (target_driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE not valid;

alter table "public"."notifications" validate constraint "notifications_target_driver_id_fkey";

alter table "public"."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."profiles" validate constraint "profiles_id_fkey";

alter table "public"."profiles" add constraint "profiles_role_check" CHECK ((role = ANY (ARRAY['driver'::text, 'dispatcher'::text, 'admin'::text]))) not valid;

alter table "public"."profiles" validate constraint "profiles_role_check";

alter table "public"."push_subscriptions" add constraint "push_subscriptions_driver_id_fkey" FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE not valid;

alter table "public"."push_subscriptions" validate constraint "push_subscriptions_driver_id_fkey";

alter table "public"."push_subscriptions" add constraint "push_subscriptions_endpoint_key" UNIQUE using index "push_subscriptions_endpoint_key";

alter table "public"."push_subscriptions" add constraint "push_subscriptions_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."push_subscriptions" validate constraint "push_subscriptions_profile_id_fkey";

alter table "public"."service_blocks" add constraint "service_blocks_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE not valid;

alter table "public"."service_blocks" validate constraint "service_blocks_vehicle_id_fkey";

alter table "public"."shift_settlements" add constraint "shift_settlements_driver_id_fkey" FOREIGN KEY (driver_id) REFERENCES public.drivers(id) not valid;

alter table "public"."shift_settlements" validate constraint "shift_settlements_driver_id_fkey";

alter table "public"."shift_settlements" add constraint "shift_settlements_shift_id_fkey" FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE not valid;

alter table "public"."shift_settlements" validate constraint "shift_settlements_shift_id_fkey";

alter table "public"."shift_settlements" add constraint "shift_settlements_shift_id_key" UNIQUE using index "shift_settlements_shift_id_key";

alter table "public"."shift_settlements" add constraint "shift_settlements_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'approved'::text, 'returned'::text]))) not valid;

alter table "public"."shift_settlements" validate constraint "shift_settlements_status_check";

alter table "public"."shift_settlements" add constraint "shift_settlements_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) not valid;

alter table "public"."shift_settlements" validate constraint "shift_settlements_vehicle_id_fkey";

alter table "public"."shifts" add constraint "shifts_driver_id_fkey" FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL not valid;

alter table "public"."shifts" validate constraint "shifts_driver_id_fkey";

alter table "public"."shifts" add constraint "shifts_status_check" CHECK ((status = ANY (ARRAY['open'::text, 'draft'::text, 'assigned'::text, 'confirmed'::text, 'declined'::text, 'completed'::text, 'cancelled'::text]))) not valid;

alter table "public"."shifts" validate constraint "shifts_status_check";

alter table "public"."shifts" add constraint "shifts_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL not valid;

alter table "public"."shifts" validate constraint "shifts_vehicle_id_fkey";

alter table "public"."swap_requests" add constraint "swap_requests_accepted_by_driver_id_fkey" FOREIGN KEY (accepted_by_driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL not valid;

alter table "public"."swap_requests" validate constraint "swap_requests_accepted_by_driver_id_fkey";

alter table "public"."swap_requests" add constraint "swap_requests_approved_driver_id_fkey" FOREIGN KEY (approved_driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL not valid;

alter table "public"."swap_requests" validate constraint "swap_requests_approved_driver_id_fkey";

alter table "public"."swap_requests" add constraint "swap_requests_driver_id_fkey" FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE not valid;

alter table "public"."swap_requests" validate constraint "swap_requests_driver_id_fkey";

alter table "public"."swap_requests" add constraint "swap_requests_shift_id_fkey" FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE not valid;

alter table "public"."swap_requests" validate constraint "swap_requests_shift_id_fkey";

alter table "public"."swap_requests" add constraint "swap_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text]))) not valid;

alter table "public"."swap_requests" validate constraint "swap_requests_status_check";

alter table "public"."swap_requests" add constraint "swap_requests_target_driver_id_fkey" FOREIGN KEY (target_driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL not valid;

alter table "public"."swap_requests" validate constraint "swap_requests_target_driver_id_fkey";

alter table "public"."swap_requests" add constraint "swap_requests_target_mode_check" CHECK ((target_mode = ANY (ARRAY['all'::text, 'driver'::text, 'open'::text]))) not valid;

alter table "public"."swap_requests" validate constraint "swap_requests_target_mode_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.rb_can_driver_notify_driver(notice_type text, notice_shift_id text, notice_target_driver_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with me as (
    select public.rb_current_driver_id() as driver_id
  )
  select coalesce((
    select exists (
      select 1
      from me
      where me.driver_id is not null
        and notice_target_driver_id is not null
        and notice_target_driver_id <> me.driver_id
        and exists (
          select 1
          from public.drivers target_driver
          where target_driver.id = notice_target_driver_id
            and target_driver.active is not false
        )
        and (
          (
            notice_type = 'swap-offer'
            and exists (
              select 1
              from public.swap_requests sr
              join public.shifts sh on sh.id = sr.shift_id
              where sr.shift_id = notice_shift_id
                and sh.driver_id = me.driver_id
                and sr.driver_id = me.driver_id
                and sr.status = 'pending'
                and (
                  sr.target_mode = 'all'
                  or sr.target_driver_id = notice_target_driver_id
                )
            )
          )
          or (
            notice_type = 'swap-accepted'
            and exists (
              select 1
              from public.swap_requests sr
              where sr.shift_id = notice_shift_id
                and sr.status = 'accepted'
                and sr.accepted_by_driver_id = me.driver_id
                and sr.driver_id = notice_target_driver_id
            )
          )
        )
    )
  ), false)
$function$
;

CREATE OR REPLACE FUNCTION public.rb_current_driver_id()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select d.id
  from public.drivers d
  where d.profile_id = auth.uid()
  limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.rb_current_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.rb_guard_notification_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.rb_is_staff() then
    return new;
  end if;

  if new.id is distinct from old.id
    or new.target_driver_id is distinct from old.target_driver_id
    or new.target_role is distinct from old.target_role
    or new.type is distinct from old.type
    or new.shift_id is distinct from old.shift_id
    or new.title is distinct from old.title
    or new.body is distinct from old.body
    or new.payload is distinct from old.payload
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Only read_by can be updated on notifications.';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rb_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and trim(lower(p.role)) = 'admin'
  )
$function$
;

CREATE OR REPLACE FUNCTION public.rb_is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and trim(lower(p.role)) in ('admin', 'dispatcher')
  )
$function$
;

CREATE OR REPLACE FUNCTION public.rb_push_subscription_matches_profile(subscription_profile_id uuid, subscription_driver_id text, subscription_role text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select case
      when trim(lower(p.role)) = 'driver' then
        trim(lower(subscription_role)) = 'driver'
        and subscription_driver_id is not null
        and exists (
          select 1
          from public.drivers d
          where d.id = subscription_driver_id
            and d.profile_id = p.id
            and d.active is not false
        )
      when trim(lower(p.role)) in ('admin', 'dispatcher') then
        trim(lower(subscription_role)) = trim(lower(p.role))
        and subscription_driver_id is null
      else false
    end
    from public.profiles p
    where p.id = auth.uid()
      and p.id = subscription_profile_id
    limit 1
  ), false)
$function$
;

CREATE OR REPLACE FUNCTION public.rb_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_driver_reminder_cron()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cron_expr text;
  cron_schedule text;
  cron_parts text[];
  cron_minute text;
  cron_hour text;
  cron_dom text;
  cron_month text;
  cron_dow text;
  expected_hour integer;
  expected_weekday text;
  summer_utc_hour integer;
  winter_utc_hour integer;
begin
  select coalesce(payload->>'driverReminderSchedule', '0 18 * * 3')
  into cron_expr
  from public.app_settings
  where id = 'default';

  cron_expr := coalesce(nullif(trim(cron_expr), ''), '0 18 * * 3');
  cron_parts := string_to_array(regexp_replace(cron_expr, '\s+', ' ', 'g'), ' ');
  if array_length(cron_parts, 1) <> 5 then
    raise exception 'driverReminderSchedule must be a 5-field cron expression.';
  end if;

  cron_minute := cron_parts[1];
  cron_hour   := cron_parts[2];
  cron_dom    := cron_parts[3];
  cron_month  := cron_parts[4];
  cron_dow    := cron_parts[5];

  if cron_minute !~ '^\d{1,2}$' or cron_hour !~ '^\d{1,2}$' then
    raise exception 'driverReminderSchedule must use one fixed minute and one fixed local hour.';
  end if;

  expected_hour := cron_hour::integer;
  if cron_minute::integer not between 0 and 59 or expected_hour not between 0 and 23 then
    raise exception 'driverReminderSchedule contains an invalid minute or hour.';
  end if;

  expected_weekday := case trim(lower(cron_dow))
    when '*'   then ''
    when '0'   then 'Sun' when '7'   then 'Sun' when 'sun' then 'Sun'
    when '1'   then 'Mon' when 'mon' then 'Mon'
    when '2'   then 'Tue' when 'tue' then 'Tue'
    when '3'   then 'Wed' when 'wed' then 'Wed'
    when '4'   then 'Thu' when 'thu' then 'Thu'
    when '5'   then 'Fri' when 'fri' then 'Fri'
    when '6'   then 'Sat' when 'sat' then 'Sat'
    else null
  end;
  if expected_weekday is null then
    raise exception 'driverReminderSchedule must use one weekday or *.';
  end if;

  summer_utc_hour := (expected_hour + 22) % 24;
  winter_utc_hour := (expected_hour + 23) % 24;
  cron_schedule := case
    when expected_hour < 2
      then format('%s %s,%s %s %s *',  cron_minute, summer_utc_hour, winter_utc_hour, cron_dom, cron_month)
      else format('%s %s,%s %s %s %s', cron_minute, summer_utc_hour, winter_utc_hour, cron_dom, cron_month, cron_dow)
  end;

  if exists (select 1 from cron.job where jobname = 'rbshift-driver-signup-reminder') then
    perform cron.unschedule('rbshift-driver-signup-reminder');
  end if;

  perform cron.schedule(
    'rbshift-driver-signup-reminder',
    cron_schedule,
    format($job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/driver-reminder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-driver-reminder-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'driver_reminder_secret')
      ),
      body := jsonb_build_object(
        'job', 'driver-signup-reminder',
        'source', 'pg_cron',
        'expectedLocalHour', %s,
        'expectedLocalWeekday', %L,
        'time', now()
      )
    ) as request_id;
    $job$, expected_hour, expected_weekday)
  );

  return cron_expr;
end;
$function$
;

grant delete on table "public"."absences" to "anon";

grant insert on table "public"."absences" to "anon";

grant references on table "public"."absences" to "anon";

grant select on table "public"."absences" to "anon";

grant trigger on table "public"."absences" to "anon";

grant truncate on table "public"."absences" to "anon";

grant update on table "public"."absences" to "anon";

grant delete on table "public"."absences" to "authenticated";

grant insert on table "public"."absences" to "authenticated";

grant references on table "public"."absences" to "authenticated";

grant select on table "public"."absences" to "authenticated";

grant trigger on table "public"."absences" to "authenticated";

grant truncate on table "public"."absences" to "authenticated";

grant update on table "public"."absences" to "authenticated";

grant delete on table "public"."absences" to "service_role";

grant insert on table "public"."absences" to "service_role";

grant references on table "public"."absences" to "service_role";

grant select on table "public"."absences" to "service_role";

grant trigger on table "public"."absences" to "service_role";

grant truncate on table "public"."absences" to "service_role";

grant update on table "public"."absences" to "service_role";

grant delete on table "public"."app_settings" to "anon";

grant insert on table "public"."app_settings" to "anon";

grant references on table "public"."app_settings" to "anon";

grant select on table "public"."app_settings" to "anon";

grant trigger on table "public"."app_settings" to "anon";

grant truncate on table "public"."app_settings" to "anon";

grant update on table "public"."app_settings" to "anon";

grant delete on table "public"."app_settings" to "authenticated";

grant insert on table "public"."app_settings" to "authenticated";

grant references on table "public"."app_settings" to "authenticated";

grant select on table "public"."app_settings" to "authenticated";

grant trigger on table "public"."app_settings" to "authenticated";

grant truncate on table "public"."app_settings" to "authenticated";

grant update on table "public"."app_settings" to "authenticated";

grant delete on table "public"."app_settings" to "service_role";

grant insert on table "public"."app_settings" to "service_role";

grant references on table "public"."app_settings" to "service_role";

grant select on table "public"."app_settings" to "service_role";

grant trigger on table "public"."app_settings" to "service_role";

grant truncate on table "public"."app_settings" to "service_role";

grant update on table "public"."app_settings" to "service_role";

grant delete on table "public"."audit_logs" to "anon";

grant insert on table "public"."audit_logs" to "anon";

grant references on table "public"."audit_logs" to "anon";

grant select on table "public"."audit_logs" to "anon";

grant trigger on table "public"."audit_logs" to "anon";

grant truncate on table "public"."audit_logs" to "anon";

grant update on table "public"."audit_logs" to "anon";

grant delete on table "public"."audit_logs" to "authenticated";

grant insert on table "public"."audit_logs" to "authenticated";

grant references on table "public"."audit_logs" to "authenticated";

grant select on table "public"."audit_logs" to "authenticated";

grant trigger on table "public"."audit_logs" to "authenticated";

grant truncate on table "public"."audit_logs" to "authenticated";

grant update on table "public"."audit_logs" to "authenticated";

grant delete on table "public"."audit_logs" to "service_role";

grant insert on table "public"."audit_logs" to "service_role";

grant references on table "public"."audit_logs" to "service_role";

grant select on table "public"."audit_logs" to "service_role";

grant trigger on table "public"."audit_logs" to "service_role";

grant truncate on table "public"."audit_logs" to "service_role";

grant update on table "public"."audit_logs" to "service_role";

grant delete on table "public"."availability" to "anon";

grant insert on table "public"."availability" to "anon";

grant references on table "public"."availability" to "anon";

grant select on table "public"."availability" to "anon";

grant trigger on table "public"."availability" to "anon";

grant truncate on table "public"."availability" to "anon";

grant update on table "public"."availability" to "anon";

grant delete on table "public"."availability" to "authenticated";

grant insert on table "public"."availability" to "authenticated";

grant references on table "public"."availability" to "authenticated";

grant select on table "public"."availability" to "authenticated";

grant trigger on table "public"."availability" to "authenticated";

grant truncate on table "public"."availability" to "authenticated";

grant update on table "public"."availability" to "authenticated";

grant delete on table "public"."availability" to "service_role";

grant insert on table "public"."availability" to "service_role";

grant references on table "public"."availability" to "service_role";

grant select on table "public"."availability" to "service_role";

grant trigger on table "public"."availability" to "service_role";

grant truncate on table "public"."availability" to "service_role";

grant update on table "public"."availability" to "service_role";

grant delete on table "public"."drivers" to "anon";

grant insert on table "public"."drivers" to "anon";

grant references on table "public"."drivers" to "anon";

grant select on table "public"."drivers" to "anon";

grant trigger on table "public"."drivers" to "anon";

grant truncate on table "public"."drivers" to "anon";

grant update on table "public"."drivers" to "anon";

grant delete on table "public"."drivers" to "authenticated";

grant insert on table "public"."drivers" to "authenticated";

grant references on table "public"."drivers" to "authenticated";

grant select on table "public"."drivers" to "authenticated";

grant trigger on table "public"."drivers" to "authenticated";

grant truncate on table "public"."drivers" to "authenticated";

grant update on table "public"."drivers" to "authenticated";

grant delete on table "public"."drivers" to "service_role";

grant insert on table "public"."drivers" to "service_role";

grant references on table "public"."drivers" to "service_role";

grant select on table "public"."drivers" to "service_role";

grant trigger on table "public"."drivers" to "service_role";

grant truncate on table "public"."drivers" to "service_role";

grant update on table "public"."drivers" to "service_role";

grant delete on table "public"."notifications" to "anon";

grant insert on table "public"."notifications" to "anon";

grant references on table "public"."notifications" to "anon";

grant select on table "public"."notifications" to "anon";

grant trigger on table "public"."notifications" to "anon";

grant truncate on table "public"."notifications" to "anon";

grant update on table "public"."notifications" to "anon";

grant delete on table "public"."notifications" to "authenticated";

grant insert on table "public"."notifications" to "authenticated";

grant references on table "public"."notifications" to "authenticated";

grant select on table "public"."notifications" to "authenticated";

grant trigger on table "public"."notifications" to "authenticated";

grant truncate on table "public"."notifications" to "authenticated";

grant update on table "public"."notifications" to "authenticated";

grant delete on table "public"."notifications" to "service_role";

grant insert on table "public"."notifications" to "service_role";

grant references on table "public"."notifications" to "service_role";

grant select on table "public"."notifications" to "service_role";

grant trigger on table "public"."notifications" to "service_role";

grant truncate on table "public"."notifications" to "service_role";

grant update on table "public"."notifications" to "service_role";

grant delete on table "public"."profiles" to "anon";

grant insert on table "public"."profiles" to "anon";

grant references on table "public"."profiles" to "anon";

grant select on table "public"."profiles" to "anon";

grant trigger on table "public"."profiles" to "anon";

grant truncate on table "public"."profiles" to "anon";

grant update on table "public"."profiles" to "anon";

grant delete on table "public"."profiles" to "authenticated";

grant insert on table "public"."profiles" to "authenticated";

grant references on table "public"."profiles" to "authenticated";

grant select on table "public"."profiles" to "authenticated";

grant trigger on table "public"."profiles" to "authenticated";

grant truncate on table "public"."profiles" to "authenticated";

grant update on table "public"."profiles" to "authenticated";

grant delete on table "public"."profiles" to "service_role";

grant insert on table "public"."profiles" to "service_role";

grant references on table "public"."profiles" to "service_role";

grant select on table "public"."profiles" to "service_role";

grant trigger on table "public"."profiles" to "service_role";

grant truncate on table "public"."profiles" to "service_role";

grant update on table "public"."profiles" to "service_role";

grant delete on table "public"."push_subscriptions" to "anon";

grant insert on table "public"."push_subscriptions" to "anon";

grant references on table "public"."push_subscriptions" to "anon";

grant select on table "public"."push_subscriptions" to "anon";

grant trigger on table "public"."push_subscriptions" to "anon";

grant truncate on table "public"."push_subscriptions" to "anon";

grant update on table "public"."push_subscriptions" to "anon";

grant delete on table "public"."push_subscriptions" to "authenticated";

grant insert on table "public"."push_subscriptions" to "authenticated";

grant references on table "public"."push_subscriptions" to "authenticated";

grant select on table "public"."push_subscriptions" to "authenticated";

grant trigger on table "public"."push_subscriptions" to "authenticated";

grant truncate on table "public"."push_subscriptions" to "authenticated";

grant update on table "public"."push_subscriptions" to "authenticated";

grant delete on table "public"."push_subscriptions" to "service_role";

grant insert on table "public"."push_subscriptions" to "service_role";

grant references on table "public"."push_subscriptions" to "service_role";

grant select on table "public"."push_subscriptions" to "service_role";

grant trigger on table "public"."push_subscriptions" to "service_role";

grant truncate on table "public"."push_subscriptions" to "service_role";

grant update on table "public"."push_subscriptions" to "service_role";

grant delete on table "public"."service_blocks" to "anon";

grant insert on table "public"."service_blocks" to "anon";

grant references on table "public"."service_blocks" to "anon";

grant select on table "public"."service_blocks" to "anon";

grant trigger on table "public"."service_blocks" to "anon";

grant truncate on table "public"."service_blocks" to "anon";

grant update on table "public"."service_blocks" to "anon";

grant delete on table "public"."service_blocks" to "authenticated";

grant insert on table "public"."service_blocks" to "authenticated";

grant references on table "public"."service_blocks" to "authenticated";

grant select on table "public"."service_blocks" to "authenticated";

grant trigger on table "public"."service_blocks" to "authenticated";

grant truncate on table "public"."service_blocks" to "authenticated";

grant update on table "public"."service_blocks" to "authenticated";

grant delete on table "public"."service_blocks" to "service_role";

grant insert on table "public"."service_blocks" to "service_role";

grant references on table "public"."service_blocks" to "service_role";

grant select on table "public"."service_blocks" to "service_role";

grant trigger on table "public"."service_blocks" to "service_role";

grant truncate on table "public"."service_blocks" to "service_role";

grant update on table "public"."service_blocks" to "service_role";

grant delete on table "public"."shift_settlements" to "anon";

grant insert on table "public"."shift_settlements" to "anon";

grant references on table "public"."shift_settlements" to "anon";

grant select on table "public"."shift_settlements" to "anon";

grant trigger on table "public"."shift_settlements" to "anon";

grant truncate on table "public"."shift_settlements" to "anon";

grant update on table "public"."shift_settlements" to "anon";

grant delete on table "public"."shift_settlements" to "authenticated";

grant insert on table "public"."shift_settlements" to "authenticated";

grant references on table "public"."shift_settlements" to "authenticated";

grant select on table "public"."shift_settlements" to "authenticated";

grant trigger on table "public"."shift_settlements" to "authenticated";

grant truncate on table "public"."shift_settlements" to "authenticated";

grant update on table "public"."shift_settlements" to "authenticated";

grant delete on table "public"."shift_settlements" to "service_role";

grant insert on table "public"."shift_settlements" to "service_role";

grant references on table "public"."shift_settlements" to "service_role";

grant select on table "public"."shift_settlements" to "service_role";

grant trigger on table "public"."shift_settlements" to "service_role";

grant truncate on table "public"."shift_settlements" to "service_role";

grant update on table "public"."shift_settlements" to "service_role";

grant delete on table "public"."shifts" to "anon";

grant insert on table "public"."shifts" to "anon";

grant references on table "public"."shifts" to "anon";

grant select on table "public"."shifts" to "anon";

grant trigger on table "public"."shifts" to "anon";

grant truncate on table "public"."shifts" to "anon";

grant update on table "public"."shifts" to "anon";

grant delete on table "public"."shifts" to "authenticated";

grant insert on table "public"."shifts" to "authenticated";

grant references on table "public"."shifts" to "authenticated";

grant select on table "public"."shifts" to "authenticated";

grant trigger on table "public"."shifts" to "authenticated";

grant truncate on table "public"."shifts" to "authenticated";

grant update on table "public"."shifts" to "authenticated";

grant delete on table "public"."shifts" to "service_role";

grant insert on table "public"."shifts" to "service_role";

grant references on table "public"."shifts" to "service_role";

grant select on table "public"."shifts" to "service_role";

grant trigger on table "public"."shifts" to "service_role";

grant truncate on table "public"."shifts" to "service_role";

grant update on table "public"."shifts" to "service_role";

grant delete on table "public"."swap_requests" to "anon";

grant insert on table "public"."swap_requests" to "anon";

grant references on table "public"."swap_requests" to "anon";

grant select on table "public"."swap_requests" to "anon";

grant trigger on table "public"."swap_requests" to "anon";

grant truncate on table "public"."swap_requests" to "anon";

grant update on table "public"."swap_requests" to "anon";

grant delete on table "public"."swap_requests" to "authenticated";

grant insert on table "public"."swap_requests" to "authenticated";

grant references on table "public"."swap_requests" to "authenticated";

grant select on table "public"."swap_requests" to "authenticated";

grant trigger on table "public"."swap_requests" to "authenticated";

grant truncate on table "public"."swap_requests" to "authenticated";

grant update on table "public"."swap_requests" to "authenticated";

grant delete on table "public"."swap_requests" to "service_role";

grant insert on table "public"."swap_requests" to "service_role";

grant references on table "public"."swap_requests" to "service_role";

grant select on table "public"."swap_requests" to "service_role";

grant trigger on table "public"."swap_requests" to "service_role";

grant truncate on table "public"."swap_requests" to "service_role";

grant update on table "public"."swap_requests" to "service_role";

grant delete on table "public"."vehicles" to "anon";

grant insert on table "public"."vehicles" to "anon";

grant references on table "public"."vehicles" to "anon";

grant select on table "public"."vehicles" to "anon";

grant trigger on table "public"."vehicles" to "anon";

grant truncate on table "public"."vehicles" to "anon";

grant update on table "public"."vehicles" to "anon";

grant delete on table "public"."vehicles" to "authenticated";

grant insert on table "public"."vehicles" to "authenticated";

grant references on table "public"."vehicles" to "authenticated";

grant select on table "public"."vehicles" to "authenticated";

grant trigger on table "public"."vehicles" to "authenticated";

grant truncate on table "public"."vehicles" to "authenticated";

grant update on table "public"."vehicles" to "authenticated";

grant delete on table "public"."vehicles" to "service_role";

grant insert on table "public"."vehicles" to "service_role";

grant references on table "public"."vehicles" to "service_role";

grant select on table "public"."vehicles" to "service_role";

grant trigger on table "public"."vehicles" to "service_role";

grant truncate on table "public"."vehicles" to "service_role";

grant update on table "public"."vehicles" to "service_role";


  create policy "absences_delete"
  on "public"."absences"
  as permissive
  for delete
  to public
using ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id))));



  create policy "absences_insert_staff_or_own"
  on "public"."absences"
  as permissive
  for insert
  to public
with check ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id))));



  create policy "absences_select_staff_or_own"
  on "public"."absences"
  as permissive
  for select
  to public
using ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id))));



  create policy "absences_update"
  on "public"."absences"
  as permissive
  for update
  to public
using ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id))))
with check ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id))));



  create policy "settings_delete"
  on "public"."app_settings"
  as permissive
  for delete
  to public
using (( SELECT public.rb_is_staff() AS rb_is_staff));



  create policy "settings_insert"
  on "public"."app_settings"
  as permissive
  for insert
  to public
with check (( SELECT public.rb_is_staff() AS rb_is_staff));



  create policy "settings_select_signed"
  on "public"."app_settings"
  as permissive
  for select
  to public
using ((( SELECT auth.uid() AS uid) IS NOT NULL));



  create policy "settings_update"
  on "public"."app_settings"
  as permissive
  for update
  to public
using (( SELECT public.rb_is_staff() AS rb_is_staff))
with check (( SELECT public.rb_is_staff() AS rb_is_staff));



  create policy "audit_logs_delete_staff"
  on "public"."audit_logs"
  as permissive
  for delete
  to public
using (( SELECT public.rb_is_staff() AS rb_is_staff));



  create policy "audit_logs_insert_authenticated"
  on "public"."audit_logs"
  as permissive
  for insert
  to public
with check ((( SELECT auth.uid() AS uid) IS NOT NULL));



  create policy "audit_logs_select_authenticated"
  on "public"."audit_logs"
  as permissive
  for select
  to public
using ((( SELECT auth.uid() AS uid) IS NOT NULL));



  create policy "audit_logs_update_authenticated"
  on "public"."audit_logs"
  as permissive
  for update
  to public
using ((( SELECT auth.uid() AS uid) IS NOT NULL))
with check ((( SELECT auth.uid() AS uid) IS NOT NULL));



  create policy "availability_delete"
  on "public"."availability"
  as permissive
  for delete
  to public
using ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id))));



  create policy "availability_insert_staff_or_own"
  on "public"."availability"
  as permissive
  for insert
  to public
with check ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id))));



  create policy "availability_select_staff_or_own"
  on "public"."availability"
  as permissive
  for select
  to public
using ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id))));



  create policy "availability_update"
  on "public"."availability"
  as permissive
  for update
  to public
using ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id))))
with check ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id))));



  create policy "drivers_delete"
  on "public"."drivers"
  as permissive
  for delete
  to public
using (( SELECT public.rb_is_staff() AS rb_is_staff));



  create policy "drivers_insert"
  on "public"."drivers"
  as permissive
  for insert
  to public
with check (( SELECT public.rb_is_staff() AS rb_is_staff));



  create policy "drivers_select_signed"
  on "public"."drivers"
  as permissive
  for select
  to public
using ((( SELECT auth.uid() AS uid) IS NOT NULL));



  create policy "drivers_update"
  on "public"."drivers"
  as permissive
  for update
  to public
using (((profile_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.rb_is_staff() AS rb_is_staff)))
with check (((profile_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.rb_is_staff() AS rb_is_staff)));



  create policy "notifications_delete_staff"
  on "public"."notifications"
  as permissive
  for delete
  to public
using (( SELECT public.rb_is_staff() AS rb_is_staff));



  create policy "notifications_insert_allowed"
  on "public"."notifications"
  as permissive
  for insert
  to public
with check ((( SELECT public.rb_is_staff() AS rb_is_staff) OR ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (((target_driver_id IS NULL) AND (target_role = ANY (ARRAY['admin'::text, 'dispatcher'::text]))) OR (target_driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id)) OR ((target_role = 'driver'::text) AND public.rb_can_driver_notify_driver(type, shift_id, target_driver_id))))));



  create policy "notifications_select_visible"
  on "public"."notifications"
  as permissive
  for select
  to authenticated
using ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (target_role = ANY (ARRAY['all'::text, 'driver_all'::text])) OR (target_driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id))));



  create policy "notifications_update_visible"
  on "public"."notifications"
  as permissive
  for update
  to authenticated
using ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (target_role = ANY (ARRAY['all'::text, 'driver_all'::text])) OR (target_driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id))))
with check ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (target_role = ANY (ARRAY['all'::text, 'driver_all'::text])) OR (target_driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id))));



  create policy "profiles_delete"
  on "public"."profiles"
  as permissive
  for delete
  to public
using (( SELECT public.rb_is_admin() AS rb_is_admin));



  create policy "profiles_insert"
  on "public"."profiles"
  as permissive
  for insert
  to public
with check ((((id = ( SELECT auth.uid() AS uid)) AND (TRIM(BOTH FROM lower(role)) = 'driver'::text)) OR ( SELECT public.rb_is_admin() AS rb_is_admin)));



  create policy "profiles_select"
  on "public"."profiles"
  as permissive
  for select
  to public
using (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.rb_is_staff() AS rb_is_staff)));



  create policy "profiles_update"
  on "public"."profiles"
  as permissive
  for update
  to public
using (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.rb_is_admin() AS rb_is_admin)))
with check (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.rb_is_admin() AS rb_is_admin)));



  create policy "push_subscriptions_delete_staff"
  on "public"."push_subscriptions"
  as permissive
  for delete
  to authenticated
using (( SELECT public.rb_is_staff() AS rb_is_staff));



  create policy "push_subscriptions_insert_own"
  on "public"."push_subscriptions"
  as permissive
  for insert
  to authenticated
with check ((( SELECT public.rb_is_staff() AS rb_is_staff) OR public.rb_push_subscription_matches_profile(profile_id, driver_id, role)));



  create policy "push_subscriptions_select_own_or_staff"
  on "public"."push_subscriptions"
  as permissive
  for select
  to public
using (((profile_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.rb_is_staff() AS rb_is_staff)));



  create policy "push_subscriptions_update_own_or_staff"
  on "public"."push_subscriptions"
  as permissive
  for update
  to public
using (((profile_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.rb_is_staff() AS rb_is_staff)))
with check ((( SELECT public.rb_is_staff() AS rb_is_staff) OR public.rb_push_subscription_matches_profile(profile_id, driver_id, role)));



  create policy "service_blocks_delete"
  on "public"."service_blocks"
  as permissive
  for delete
  to public
using (( SELECT public.rb_is_staff() AS rb_is_staff));



  create policy "service_blocks_insert"
  on "public"."service_blocks"
  as permissive
  for insert
  to public
with check (( SELECT public.rb_is_staff() AS rb_is_staff));



  create policy "service_blocks_select_signed"
  on "public"."service_blocks"
  as permissive
  for select
  to public
using ((( SELECT auth.uid() AS uid) IS NOT NULL));



  create policy "service_blocks_update"
  on "public"."service_blocks"
  as permissive
  for update
  to public
using (( SELECT public.rb_is_staff() AS rb_is_staff))
with check (( SELECT public.rb_is_staff() AS rb_is_staff));



  create policy "shift_settlements_delete_staff"
  on "public"."shift_settlements"
  as permissive
  for delete
  to authenticated
using (( SELECT public.rb_is_staff() AS rb_is_staff));



  create policy "shift_settlements_insert_own_or_staff"
  on "public"."shift_settlements"
  as permissive
  for insert
  to authenticated
with check ((( SELECT public.rb_is_staff() AS rb_is_staff) OR ((driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id)) AND (status = ANY (ARRAY['draft'::text, 'submitted'::text])) AND (EXISTS ( SELECT 1
   FROM public.shifts sh
  WHERE ((sh.id = shift_settlements.shift_id) AND (sh.driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id))))))));



  create policy "shift_settlements_select_own_or_staff"
  on "public"."shift_settlements"
  as permissive
  for select
  to authenticated
using ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id))));



  create policy "shift_settlements_update_own_or_staff"
  on "public"."shift_settlements"
  as permissive
  for update
  to authenticated
using ((( SELECT public.rb_is_staff() AS rb_is_staff) OR ((driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id)) AND (status <> 'approved'::text))))
with check ((( SELECT public.rb_is_staff() AS rb_is_staff) OR ((driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id)) AND (status = ANY (ARRAY['draft'::text, 'submitted'::text, 'returned'::text])))));



  create policy "shifts_delete_staff"
  on "public"."shifts"
  as permissive
  for delete
  to public
using (( SELECT public.rb_is_staff() AS rb_is_staff));



  create policy "shifts_insert"
  on "public"."shifts"
  as permissive
  for insert
  to public
with check ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id))));



  create policy "shifts_select_staff_own_or_swap"
  on "public"."shifts"
  as permissive
  for select
  to public
using ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (status = 'open'::text) OR (driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id)) OR (id IN ( SELECT sr.shift_id
   FROM public.swap_requests sr
  WHERE ((sr.target_mode = 'all'::text) OR (sr.target_driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id)) OR (sr.accepted_by_driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id)))))));



  create policy "shifts_update"
  on "public"."shifts"
  as permissive
  for update
  to public
using ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id)) OR ((status = 'open'::text) AND (driver_id IS NULL))))
with check ((( SELECT public.rb_is_staff() AS rb_is_staff) OR (driver_id = ( SELECT public.rb_current_driver_id() AS rb_current_driver_id))));



  create policy "swap_requests_delete_staff"
  on "public"."swap_requests"
  as permissive
  for delete
  to authenticated
using (( SELECT public.rb_is_staff() AS rb_is_staff));



  create policy "swap_requests_insert_authenticated"
  on "public"."swap_requests"
  as permissive
  for insert
  to public
with check ((( SELECT auth.uid() AS uid) IS NOT NULL));



  create policy "swap_requests_select_authenticated"
  on "public"."swap_requests"
  as permissive
  for select
  to public
using ((( SELECT auth.uid() AS uid) IS NOT NULL));



  create policy "swap_requests_update_authenticated"
  on "public"."swap_requests"
  as permissive
  for update
  to public
using ((( SELECT auth.uid() AS uid) IS NOT NULL))
with check ((( SELECT auth.uid() AS uid) IS NOT NULL));



  create policy "vehicles_delete"
  on "public"."vehicles"
  as permissive
  for delete
  to public
using (( SELECT public.rb_is_staff() AS rb_is_staff));



  create policy "vehicles_insert"
  on "public"."vehicles"
  as permissive
  for insert
  to public
with check (( SELECT public.rb_is_staff() AS rb_is_staff));



  create policy "vehicles_select_signed"
  on "public"."vehicles"
  as permissive
  for select
  to public
using ((( SELECT auth.uid() AS uid) IS NOT NULL));



  create policy "vehicles_update"
  on "public"."vehicles"
  as permissive
  for update
  to public
using (( SELECT public.rb_is_staff() AS rb_is_staff))
with check (( SELECT public.rb_is_staff() AS rb_is_staff));


CREATE TRIGGER notifications_guard_update BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.rb_guard_notification_update();

CREATE TRIGGER shift_settlements_updated_at BEFORE UPDATE ON public.shift_settlements FOR EACH ROW EXECUTE FUNCTION public.rb_set_updated_at();


