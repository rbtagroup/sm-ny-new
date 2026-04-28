# RBSHIFT v5.4.1 – mobilní režim řidiče

Tato verze navazuje na v5.3.1 a zaměřuje se na praktické používání aplikace řidičem na mobilu.

Obsahuje:

- online režim přes Supabase Auth a databázi
- push notifikace přes Vercel backend
- živou synchronizaci přes Supabase Realtime
- automatický fallback polling každých 8 sekund, pokud Realtime v prohlížeči vypadne
- zrušení směny jako stav **Zrušeno** včetně notifikace řidiči
- potvrzení / odmítnutí směny bez ručního refresh dispečera
- výměny směn bez ručního refresh
- finální RLS patch v `supabase/rls-final-fix.sql`
- samostatný realtime patch v `supabase/realtime-live-sync-fix.sql`
- šablonu pro založení adminů, dispečerů, řidičů a aut v `supabase/seed-users-template.sql`
- nový čistý mobilní pohled řidiče **Moje směny**
- velká akční tlačítka: potvrdit, nastoupit, ukončit, výměna, odmítnout
- upozornění na chybějící push zařízení přímo v řidičském režimu
- přehled aktivních zařízení pro push notifikace
- možnost odebrat staré zařízení z push notifikací
- návod pro iPhone přímo u nastavení notifikací

## Lokální spuštění

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Vercel Environment Variables

Ve Vercelu nastav tyto proměnné:

```env
VITE_SUPABASE_URL=https://tvuj-projekt.supabase.co
VITE_SUPABASE_ANON_KEY=tvuj-anon-public-key
VITE_VAPID_PUBLIC_KEY=tvuj-public-vapid-key

SUPABASE_URL=https://tvuj-projekt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tvuj-service-role-key
VAPID_PUBLIC_KEY=tvuj-public-vapid-key
VAPID_PRIVATE_KEY=tvuj-private-vapid-key
VAPID_SUBJECT=mailto:prace@rbgroup.cz
```

Důležité: `SUPABASE_SERVICE_ROLE_KEY` nikdy nedávej do proměnné začínající `VITE_`. Je pouze pro serverovou Vercel funkci.

Po změně proměnných udělej ve Vercelu `Redeploy`.

## VAPID klíče

V projektu po `npm install` můžeš vygenerovat klíče:

```bash
npm run generate:vapid
```

Výstup:

```text
Public Key  → VITE_VAPID_PUBLIC_KEY a VAPID_PUBLIC_KEY
Private Key → VAPID_PRIVATE_KEY
```

## Doporučený test po nasazení

1. Řidič otevře aplikaci na mobilu.
2. V záložce Notifikace povolí zařízení.
3. Admin vytvoří novou směnu.
4. Řidič dostane push a uvidí ji v **Moje směny**.
5. Řidič směnu potvrdí.
6. Dispečer/admin vidí stav bez refresh.
7. Řidič provede `Nastoupil jsem` a později `Ukončit směnu`.
8. Řidič vyzkouší výměnu směny.



## v5.4.1 – Volné směny

Nově lze vytvořit směnu bez řidiče a bez auta. Aplikace ji uloží jako `Volná směna`, pošle push notifikaci všem aktivním řidičům a řidiči se na ni mohou přihlásit tlačítkem `Mám zájem`.

Po nasazení v5.4.1 do existující Supabase databáze spusť:

```sql
supabase/open-shifts-v5-4-1.sql
```

Nebo znovu spusť celý:

```sql
supabase/rls-final-fix.sql
```
