# RBSHIFT v5.3.1 – nastavení push notifikací

## 1) Vygeneruj VAPID klíče

Po nasazení balíčku nebo lokálně v projektu spusť:

```bash
npm install
npm run generate:vapid
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
```

`SUPABASE_SERVICE_ROLE_KEY` nedávej do proměnné začínající `VITE_`.

## 3) Udělej Redeploy

Po změně proměnných ve Vercelu spusť nový deployment:

```text
Deployments → Redeploy
```

## 4) Spusť SQL patch v Supabase

V Supabase SQL Editoru spusť:

```text
supabase/rls-final-fix.sql
```

Patch obsahuje i pravidla pro `push_subscriptions`.

## 5) Test v aplikaci

1. Přihlas se jako řidič.
2. Otevři **Notifikace**.
3. Klikni **Povolit notifikace na tomto zařízení**.
4. Klikni **Server push test**.
5. Pak zkus vytvořit novou směnu pro řidiče.

## iPhone

Na iPhonu otevři aplikaci ze zástupce na ploše:

```text
Safari → Sdílet → Přidat na plochu → otevřít ikonu z plochy
```

Push se na iOS běžně nepovolí v obyčejném Safari tabu.


## Volné směny v5.4.1

Pokud dispečer vytvoří směnu bez řidiče, notifikace se odesílá s `targetRole = driver_all`.
To znamená, že ji vidí a dostanou všichni řidiči se zapnutými push notifikacemi.
