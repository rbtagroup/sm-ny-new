# RBSHIFT Supabase SQL soubory

Doporučený postup pro nový Supabase projekt:

1. V Supabase SQL Editoru spusť `schema.sql`.
2. Potom spusť `rls-final-fix.sql`.
3. V `Authentication → Users` vytvoř účty admina, dispečerů a řidičů.
4. Uprav a spusť `seed-users-template.sql`.
5. Ve Vercelu nastav frontend proměnné:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_VAPID_PUBLIC_KEY`
6. Ve Vercelu nastav serverové proměnné pro push:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT`
7. Udělej Redeploy.

Pro již existující projekt, kde tabulky existují, většinou stačí spustit:

- `rls-final-fix.sql`
- případně `seed-users-template.sql`

`service_role` klíč nikdy nevkládej do frontendu ani do žádné proměnné začínající `VITE_`. Patří pouze do serverové části Vercelu jako `SUPABASE_SERVICE_ROLE_KEY`.
