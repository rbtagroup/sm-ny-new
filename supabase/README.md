# RBSHIFT Supabase SQL soubory

## Zdroj pravdy

Nasaditelná databázová historie žije v `supabase/migrations/`.

Top-level `.sql` soubory v této složce jsou historické nebo ruční pomocné skripty z dřívějších oprav. Ber je jako referenci, ne jako hlavní deploy cestu, pokud se konkrétní změna výslovně nepřenese do timestampované migrace.

Inventář volných SQL souborů je v `supabase/sql-inventory.json`. Testovací sada hlídá, že každý nový top-level `.sql` soubor musí být v inventáři zařazený.

Kategorie inventáře:

- `schema-snapshot` - referenční snapshot, ne deploy zdroj.
- `legacy-patch` - historický patch; znovu nespouštět přímo na migration-managed DB.
- `manual-ops` - ruční provozní skript, typicky cron/Vault/pg_net setup.
- `manual-test` / `regression-probe` - diagnostika a testovací sondy.
- `seed-template` - ruční seed po vytvoření Auth uživatelů.

Pravidla pro novou DB práci:

- Vytvoř migraci přes `supabase migration new <name>`.
- Deployovatelné DDL/RPC/policy změny dávej pouze do `supabase/migrations/`.
- `schema.sql` drž jako snapshot/reference, ne jako deploy zdroj.
- Pokud je potřeba něco z top-level helper SQL, zkopíruj relevantní část do nové migrace místo úprav helperu napřímo.
- Pokud přidáš nový top-level `.sql` soubor, doplň ho do `supabase/sql-inventory.json` a vysvětli, proč to není migrace.

## Květen 2026 Supabase poznámka

Supabase mění výchozí expozici nových tabulek ve veřejném schématu přes Data API/GraphQL. U nových projektů proto počítej s explicitními grants a s tím, že RLS samo o sobě neznamená, že je tabulka dostupná přes API. U produkčních změn proto preferuj timestampované migrace, kde jsou schema, policies, grants a RPC privileges na jednom místě.

## Nový Supabase projekt

Doporučený postup:

1. Aplikuj migrace ze `supabase/migrations/`.
2. V `Authentication -> Users` vytvoř účty admina, dispečerů a řidičů, pokud nejdou přes registraci v aplikaci.
3. Uprav a spusť `seed-users-template.sql` pouze jako pomocný seed, ne jako schema migraci.
4. Ve Vercelu nastav frontend proměnné:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_VAPID_PUBLIC_KEY`
5. Ve Vercelu nastav serverové proměnné pro push:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT`
6. Udělej redeploy.

`service_role` klíč nikdy nevkládej do frontendu ani do žádné proměnné začínající `VITE_`. Patří pouze do serverové části Vercelu jako `SUPABASE_SERVICE_ROLE_KEY`.
