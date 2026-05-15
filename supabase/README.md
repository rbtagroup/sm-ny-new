# RBSHIFT Supabase SQL soubory

## Zdroj pravdy

Nasaditelná databázová historie žije v `supabase/migrations/`.

Top-level `.sql` soubory v této složce jsou historické nebo ruční pomocné skripty z dřívějších oprav. Ber je jako referenci, ne jako hlavní deploy cestu, pokud se konkrétní změna výslovně nepřenese do timestampované migrace.

Pravidla pro novou DB práci:

- Vytvoř migraci přes `supabase migration new <name>`.
- Deployovatelné DDL/RPC/policy změny dávej pouze do `supabase/migrations/`.
- `schema.sql` drž jako snapshot/reference, ne jako deploy zdroj.
- Pokud je potřeba něco z top-level helper SQL, zkopíruj relevantní část do nové migrace místo úprav helperu napřímo.

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
