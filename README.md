# Store Analytics

Analityczny dashboard e-commerce na Cloudflare — architektura zero-cost.

## Stack

- **Astro** (SSR) + **@astrojs/cloudflare** adapter
- **Cloudflare D1** (SQLite) — binding `DB`
- **React** wyspy interaktywne (ShopSelector, PeriodPicker, AdsChart)
- **uPlot** — wykresy
- **Gemini API** — podsumowania AI po polsku
- TypeScript end-to-end

## Szybki start (lokalne dev)

```bash
# 1. Zainstaluj zależności
npm install

# 2. Stwórz lokalną bazę D1 i zastosuj migracje
wrangler d1 create store-analytics-db          # skopiuj database_id do wrangler.toml
npm run db:migrate:local                        # wrangler d1 migrations apply DB --local

# 3. Utwórz .dev.vars (nie commitować)
echo "GEMINI_API_KEY=twój-klucz" > .dev.vars
echo "INGEST_SECRET=losowy-secret" >> .dev.vars

# 4. Uruchom dev server (platformProxy dla D1 musi być włączony — domyślnie jest)
npm run dev
```

## Wdrożenie (Cloudflare Pages)

```bash
# Migracje na zdalną bazę
npm run db:migrate:remote

# Sekrety (raz)
wrangler secret put GEMINI_API_KEY
wrangler secret put INGEST_SECRET

# Deploy
npm run deploy
```

## Struktura projektu

```
migrations/          # SQL migracje D1 (np. 0001_initial_schema.sql)
src/
  env.d.ts           # Typy bindingów Cloudflare + App.Locals
  lib/
    db.ts            # Pomocniki D1
    dates.ts         # Matematyka MoM/QoQ/YoY + period-to-date
    money.ts         # Grosze ↔ PLN
    roas.ts          # ROAS, CPC, CTR, CR
    gemini.ts        # Podsumowania AI + cache
  pages/
    index.astro      # Dashboard
    api/ingest/
      order.ts       # Webhook WooCommerce + sklep custom
      ads.ts         # Ingestia Google Ads (ze skryptu Ads Script)
      ga4.ts         # Ingestia GA4 (z Apps Script)
  components/        # Komponenty Astro (Layout, KPICard, AISummary)
  islands/           # Wyspy React (ShopSelector, PeriodPicker, AdsChart)
  styles/
    global.css
public/              # Zasoby statyczne
```

## Zasady architektury

- **Grosze**: kwoty pieniężne przechowywane wewnętrznie jako INTEGER (grosze). Konwersja tylko na granicy zapisu i wyświetlania.
- **Idempotencja**: wszystkie fakty zapisywane przez `INSERT ... ON CONFLICT DO UPDATE` — webhooks mogą nadchodzić wielokrotnie.
- **Stan filtrów w URL**: `?shop_id=`, `?period=`, `?anchor=`, `?compare=`, `?from=`, `?to=` — umożliwia linkowanie i odświeżenie strony.
- **Brak crona**: ingestia to endpointy POST; podsumowania AI generowane on-demand i cache'owane w D1 (`ai_summaries`).
- **Sklepy jako wiersze**: tabela `shops` przechowuje konfigurację każdego sklepu (sekrety webhook, token custom).
