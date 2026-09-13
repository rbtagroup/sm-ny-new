# RBSHIFT

PWA plánovač směn pro taxi provoz. Aktuální balíček je `1.3.19` a projekt používá `pnpm` přes Corepack.

## Lokální spuštění

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run dev
```

## Ověření

```bash
pnpm test
pnpm run build
pnpm audit --prod
```

Pro kompletní lokální kontrolu:

```bash
pnpm run verify
```

## Nasazení

Vercel používá příkazy z `vercel.json`:

```bash
corepack enable && pnpm install --frozen-lockfile
corepack enable && pnpm run build
```

Po nasazení databázových změn spusť v Supabase migrace ze složky `supabase/migrations`. Aktuální bezpečnostní patch je:

```text
supabase/migrations/20260511152914_harden_sync_notifications.sql
```

Ten doplňuje oddělený stav smazaných notifikací (`deleted_by`), zpřísňuje RLS pro výměny směn, vrací audit logy do režimu staff-only pro čtení/upravy a přidává RPC funkce pro citlivé akce:

- `rb_request_swap`
- `rb_cancel_swap_request`
- `rb_accept_swap_request`
- `rb_resolve_swap_request`
- `rb_set_notification_state`
- `rb_insert_audit_log`

## Důležité proměnné

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VAPID_PUBLIC_KEY` / `VITE_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `PUSH_DELIVERY_SECRET` nebo odpovídající scheduler secret
- `PUSH_DELIVERY_CONCURRENCY` volitelně pro počet paralelně odesílaných push notifikací

## Přístup a registrace

- Řidič se může zaregistrovat sám. Pokud jeho e-mail dispečink už eviduje v sekci Řidiči, účet se propojí s existujícím záznamem.
- Registrace s neznámým e-mailem založí neaktivního řidiče s poznámkou „Čeká na schválení dispečinkem.“ a dispečink dostane notifikaci. Dokud ho někdo neaktivuje, vidí jen svůj vlastní záznam.
- Sdílená data (řidiči, vozidla, volné směny, hromadné zprávy) vidí jen dispečink a aktivní řidiči. Řidič si sám může změnit jen telefon.

## Monitoring

- Když cron nedoručí push notifikace (`pushResult.ok = false` v `audit_logs`), vznikne dispečinku notifikace „Push notifikace se nepodařilo odeslat“.
- Doporučený externí monitoring: pravidelná kontrola `https://sm-ny-new.vercel.app/api/push-health` (očekávaný stav 200).
- GitHub Actions (`.github/workflows/ci.yml`) na každý push a PR spouští testy, lint, build, smoke test v prohlížeči a audit závislostí.

## Poznámky

- Produkce posílá bezpečnostní hlavičky z `vercel.json` včetně Content-Security-Policy. Nový externí zdroj (API, obrázky, fonty) je potřeba do CSP doplnit, jinak ho prohlížeč zablokuje.

- `package-lock.json` v projektu není potřeba; zdrojem pravdy je `pnpm-lock.yaml`.
- Service worker a `index.html` zůstávají bez cache, hashované assety se cachují dlouhodobě.
- Serverové push notifikace se odesílají s omezenou paralelností přes `PUSH_DELIVERY_CONCURRENCY` nebo výchozí hodnotu `8`.
- Serverless funkce běží ve Vercel regionu `fra1` (Frankfurt), co nejblíž Supabase projektu v `eu-central-2`. Z výchozího `iad1` (USA) vracela Supabase API brána na dotazy občas `504 Gateway Timeout`.
