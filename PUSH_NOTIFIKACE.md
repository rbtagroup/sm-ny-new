# RBSHIFT v5.3.1 – nastavení push notifikací

## 1) Vygeneruj VAPID klíče

Po nasazení balíčku nebo lokálně v projektu spusť:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run generate:vapid
```

Uvidíš:

```text
Public Key:  ...
Private Key: ...
```

## 2) Nastav Vercel Environment Variables

Ve Vercelu otevři:

```text
Project → Settings → Environment Variables
```

Doplň:

```env
VITE_VAPID_PUBLIC_KEY=PUBLIC_KEY
VAPID_PUBLIC_KEY=PUBLIC_KEY
VAPID_PRIVATE_KEY=PRIVATE_KEY
VAPID_SUBJECT=mailto:prace@rbgroup.cz
SUPABASE_URL=https://tvuj-projekt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service-role-key-ze-Supabase
PUSH_RATE_LIMIT_PER_WINDOW=30
PUSH_DELIVERY_RATE_LIMIT_PER_WINDOW=1000
PUSH_GLOBAL_REQUEST_RATE_LIMIT_PER_WINDOW=300
PUSH_GLOBAL_DELIVERY_RATE_LIMIT_PER_WINDOW=5000
PUSH_INTERNAL_REQUEST_RATE_LIMIT_PER_WINDOW=120
PUSH_INTERNAL_DELIVERY_RATE_LIMIT_PER_WINDOW=5000
```

`SUPABASE_SERVICE_ROLE_KEY` nedávej do proměnné začínající `VITE_`.

Rate limit hodnoty jsou za jedno okno. Výchozí okno je 60 sekund a dá se změnit přes `PUSH_RATE_LIMIT_WINDOW_MS`.

## 3) Udělej Redeploy

Po změně proměnných ve Vercelu spusť nový deployment:

```text
Deployments → Redeploy
```

## 4) Spusť SQL patch v Supabase

V Supabase SQL Editoru spusť:

```text
supabase/migrations/20260511152914_harden_sync_notifications.sql
```

Patch obsahuje i pravidla pro bezpečnější notifikace, audit, výměny směn a RPC funkce, které klient používá pro citlivé řidičské akce. Pro novou instalaci spusť základní schema a potom migrace ze složky `supabase/migrations`.

## 5) Test v aplikaci

1. Přihlas se jako řidič.
2. Otevři **Notifikace**.
3. Klikni **Povolit notifikace na tomto zařízení**.
4. Klikni **Server push test**.
5. Pak zkus vytvořit novou směnu pro řidiče.

## 6) Produkční test cílení pushů

Proveď test na dvou různých řidičských účtech se zapnutými push notifikacemi:

1. Staff pošle zprávu všem řidičům: push má přijít oběma řidičům.
2. Staff pošle zprávu jednomu řidiči: push má přijít jen vybranému řidiči.
3. Řidič nabídne směnu konkrétnímu kolegovi: push má přijít kolegovi, ne řidiči, který směnu nabízí.
4. Řidič nabídne směnu všem: push mají dostat ostatní aktivní řidiči, ne autor nabídky.
5. Kolega nabídku odmítne nebo přijme: autorovi se aktualizuje upozornění v aplikaci, ale neposílá se mu zbytečný self-push.

V historii zpráv u staff zpráv kontroluj stav doručení. Stav `0 zařízení` znamená, že cílový řidič nemá aktivní subscription na daném telefonu.

## iPhone

Na iPhonu otevři aplikaci ze zástupce na ploše:

```text
Safari → Sdílet → Přidat na plochu → otevřít ikonu z plochy
```

Push se na iOS běžně nepovolí v obyčejném Safari tabu.


## Volné směny v5.4.1

Pokud dispečer vytvoří směnu bez řidiče, notifikace se odesílá s `targetRole = driver_all`.
To znamená, že ji vidí a dostanou všichni řidiči se zapnutými push notifikacemi.
