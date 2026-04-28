# RBSHIFT v5.4.5 – UX cleanup dispečinku

Stabilizační verze zaměřená na geometrii dispečerské aplikace, přehlednost dvou-týdenního plánu a odstranění zbytečných doprovodných textů.

Nově:

- verze aplikace `1.3.10-v5.4.5-ux-cleanup`
- kalendář směn zobrazuje **2 týdny pod sebou**
- opravené přesahy v týdenním plánu
- sekce **Chybí obsazení** je rozbalovací
- sekce **Kolize k řešení** je rozbalovací
- výchozí směny: **Denní 07:00–19:00**, **Noční 19:00–07:00**
- časy směn lze upravit v Nastavení
- Audit provozu je zjednodušený a rozbalovací
- odstraněné provozně zbytečné texty o Supabase/datovém modelu
- Notifikace mají u každé položky tlačítko **Smazat**
- Dostupnost řidiče lze zadat opakovaně podle dne v týdnu nebo na konkrétní datum a čas
- Historie změn je zkrácená, starší záznamy jsou rozbalovací
- řidičský režim má méně rušivý panel úložiště

## Důležité po nasazení

Pokud chceš používat dostupnost na konkrétní datum, spusť v Supabase SQL Editoru:

```text
supabase/ux-cleanup-v5-4-5.sql
```

Nebo spusť celý aktualizovaný:

```text
supabase/rls-final-fix.sql
```

## Lokální spuštění

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Vercel / Supabase

Ponech stávající proměnné ve Vercelu. Tato verze nemění VAPID ani Supabase připojení.
