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

Databázové změny jsou jen v `supabase/migrations` (zdroj pravdy). Nové migrace nasaď přes Supabase CLI z propojeného repozitáře:

```bash
supabase db push --dry-run
```

```bash
supabase db push
```

Po změně RLS nebo RPC funkcí spusť proti databázi regresní sondy `supabase/rls-regression-tests.sql`. Skript všechny zkušební změny vrací a skončí chybou, pokud by se chráněná akce stala povolenou.

Edge funkce `scheduler` a `driver-reminder` jsou v `supabase/functions` a nasazují se zvlášť (s `verify_jwt` vypnutým, ověřují vlastní tajný klíč).

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
- Sdílená data (vozidla, volné směny, hromadné zprávy) vidí jen dispečink a aktivní řidiči. Řidič si sám může změnit jen telefon.
- Řidič vidí celý jen svůj záznam; kolegy zná jen podle jména a stavu z `rb_driver_directory()`. Telefony, e-maily a poznámky vidí jen dispečink.
- Zapomenuté heslo: přihlašovací obrazovka pošle odkaz přes Supabase Auth a po otevření odkazu aplikace nabídne nastavení nového hesla. V Supabase Auth musí být URL aplikace (`https://sm-ny-new.vercel.app`) nastavená jako Site URL nebo povolená redirect URL. Doporučené je zapnout i ochranu proti uniklým heslům.

## Monitoring

- Když cron nedoručí push notifikace (`pushResult.ok = false` v `audit_logs`), vznikne dispečinku notifikace „Push notifikace se nepodařilo odeslat“.
- Denní kontrola obsazení (cron v 7:00) upozorní jen na chybějící obsazení dnes a zítra. Když se situace nemění, opakuje upozornění nejvýš jednou za 3 dny.
- Klienti se při spojeném realtime kanálu nedotazují pravidelně; po změně načtou jen dotčené tabulky a jednou za 5 minut provedou pojistné úplné načtení.
- Doporučený externí monitoring: pravidelná kontrola `https://sm-ny-new.vercel.app/api/push-health` (očekávaný stav 200).
- GitHub Actions (`.github/workflows/ci.yml`) na každý push a PR spouští testy, lint, build, smoke test v prohlížeči a audit závislostí.

## Poznámky

- Produkce posílá bezpečnostní hlavičky z `vercel.json` včetně Content-Security-Policy. Nový externí zdroj (API, obrázky, fonty) je potřeba do CSP doplnit, jinak ho prohlížeč zablokuje.
- Styly: `src/main.css` jen importuje soubory ze `src/styles/` v pořadí kaskády (pozdější soubor může přepsat dřívější), nové styly patří do souboru dané části aplikace. Po úpravě, která nemá měnit vzhled (úklid, přesun pravidel), spusť `pnpm run check:styles`: porovná vypočtené styly všech obrazovek v několika šířkách proti poslední verzi v gitu (`QUICK=1` pro rychlou kontrolu, `BASE_REF=<commit>` pro jiný základ).

- `package-lock.json` v projektu není potřeba; zdrojem pravdy je `pnpm-lock.yaml`.
- Service worker a `index.html` zůstávají bez cache, hashované assety se cachují dlouhodobě.
- Serverové push notifikace se odesílají s omezenou paralelností přes `PUSH_DELIVERY_CONCURRENCY` nebo výchozí hodnotu `8`.
- Serverless funkce běží ve Vercel regionu `fra1` (Frankfurt), co nejblíž Supabase projektu v `eu-central-2`. Z výchozího `iad1` (USA) vracela Supabase API brána na dotazy občas `504 Gateway Timeout`.
