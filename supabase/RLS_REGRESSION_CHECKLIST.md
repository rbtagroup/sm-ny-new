# RLS Regression Checklist

Použij před produkční migrací nebo po změně policy/RPC, které se dotýká `profiles`, `shifts`, `notifications`, `audit_logs`, `swap_requests` nebo `push_subscriptions`.

1. Spusť `supabase/rls-regression-tests.sql` v Supabase SQL editoru jako owner roli. Výsledek musí být `rls_regression_passed`.
2. V řidičské aplikaci ověř: potvrzení směny, žádost o výměnu, odmítnutí nabídky, přečtení/skrytí notifikace.
3. Ve staff aplikaci ověř: vytvoření směny, zrušení směny, schválení/zamítnutí výměny, otevření historie/auditu.
4. Pokud se objeví hláška s `row-level security`, `permission denied`, `violates` nebo názvem RPC, neřeš ji jen textovou maskou v UI. Přidej regresní probe do SQL skriptu.
5. Po změně security-definer funkce zkontroluj, že vlastní privilegovaná logika běží mimo exposed schema a public wrapper má jen nutný grant.
