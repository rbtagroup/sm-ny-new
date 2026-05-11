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
supabase/migrations/20260511101956_harden_sync_notifications.sql
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

## Poznámky

- `package-lock.json` v projektu není potřeba; zdrojem pravdy je `pnpm-lock.yaml`.
- Service worker a `index.html` zůstávají bez cache, hashované assety se cachují dlouhodobě.
- Serverové push notifikace se odesílají s omezenou paralelností přes `PUSH_DELIVERY_CONCURRENCY` nebo výchozí hodnotu `8`.
