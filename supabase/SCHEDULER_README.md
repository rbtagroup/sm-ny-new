# RBSHIFT Scheduler S1

Tento balík přidává základní backend scheduler přes Supabase Edge Function.

## Co je přidáno

- `supabase/functions/scheduler/index.ts`
- `supabase/scheduler-cron.sql`
- `supabase/scheduler-manual-test.sql`

## Job S1: daily-coverage

Každé ráno zkontroluje příštích 7 dní podle `app_settings.payload.coverageSlots`.

Kontroluje tabulku:

- `shifts`

Vytváří záznamy do:

- `notifications` jen pokud chybí pokrytí
- `audit_logs`

Notifikace je idempotentní podle typu:

```text
daily-coverage:YYYY-MM-DD
```

To znamená, že pro jeden den nevznikne stejná scheduler notifikace vícekrát.

## Deploy

```bash
supabase functions deploy scheduler --no-verify-jwt
```

Nastav secrets:

```bash
supabase secrets set SCHEDULER_SECRET="dlouhy-nahodny-secret"
supabase secrets set PUSH_DELIVERY_URL="https://TVA-APP.vercel.app/api/send-push"
supabase secrets set PUSH_DELIVERY_SECRET="stejny-secret-jako-ve-vercelu"
```

`SUPABASE_URL` a `SUPABASE_SERVICE_ROLE_KEY` Supabase Edge Functions běžně poskytují v runtime prostředí projektu.
`PUSH_DELIVERY_URL` a `PUSH_DELIVERY_SECRET` jsou potřeba jen pro reálné push doručení po vytvoření notifikace; bez nich funkce notifikaci uloží a v audit logu zapíše důvod přeskočení push doručení.

Ve Vercelu nastav stejný `PUSH_DELIVERY_SECRET`, aby `/api/send-push` přijímal interní volání ze Supabase funkcí.

## DB hardening

Po nasazení spusť v Supabase SQL editoru:

```text
supabase/notification-hardening.sql
```

Soubor zúží RLS pro `notifications`, přidá `payload` sloupec a vytvoří idempotency indexy pro `daily-coverage` a `driver-signup-reminder`.

## Cron

1. Otevři `supabase/scheduler-cron.sql`.
2. Nahraď:
   - `https://PROJECT_REF.supabase.co`
   - `CHANGE_ME_LONG_RANDOM_SECRET`
3. Spusť SQL v Supabase SQL editoru.

Supabase doporučuje plánování Edge Functions přes `pg_cron` + `pg_net` a tajné hodnoty ukládat přes Vault.

## Ruční test

Po deployi můžeš funkci zavolat:

```bash
curl -X POST "https://PROJECT_REF.supabase.co/functions/v1/scheduler" \
  -H "Content-Type: application/json" \
  -H "x-scheduler-secret: dlouhy-nahodny-secret" \
  -d '{"job":"daily-coverage","source":"curl"}'
```

Nebo použij:

```text
supabase/scheduler-manual-test.sql
```

## Poznámky

- Funkce sama nemění Supabase schema; DB změny jsou v `supabase/notification-hardening.sql`.
- Funkce používá service role key, proto ji nevolej z frontendu.
- `SCHEDULER_SECRET` chrání endpoint před ručním spouštěním cizí osobou.
- Pokud nejsou nalezené žádné mezery v pokrytí, vznikne jen audit log, ne uživatelská notifikace.
