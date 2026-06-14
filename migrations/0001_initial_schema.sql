-- =============================================================
-- Dashboard e-commerce — schemat początkowy (Cloudflare D1 / SQLite)
-- Migracja Wrangler: migrations/0001_initial_schema.sql
--
-- Zasady zaszyte w schemacie:
--  * Sklepy to dane (tabela shops), nie hardcode — MVP = jeden wiersz.
--  * Kwoty pieniężne trzymane jako INTEGER w groszach (1/100 PLN),
--    żeby uniknąć błędów zmiennoprzecinkowych przy sumowaniu.
--  * Fakty mają klucze pod UPSERT (idempotencja webhooków + nadpisywanie
--    kroczącego okna Ads/GA4).
--  * Zwroty przypięte do daty pierwotnego zamówienia (ROI po dacie pozyskania).
--  * Tabele STRICT — wymuszają typy kolumn.
-- =============================================================

-- ---------- REJESTR SKLEPÓW ----------
CREATE TABLE shops (
  shop_id           TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  platform          TEXT NOT NULL,                 -- 'woocommerce' | 'custom' | 'spare'
  currency          TEXT NOT NULL DEFAULT 'PLN',
  ads_customer_id   TEXT,
  ga4_property_id   TEXT,
  webhook_secret    TEXT,                          -- HMAC, odczytywany przez Workera po shop_id
  custom_token      TEXT,                          -- token dla sklepu niestandardowego
  data_version      INTEGER NOT NULL DEFAULT 0,    -- bump przy wgraniu danych; unieważnia cache AI
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

-- ---------- WARSTWA RAW (append-only, audyt + replay) ----------
CREATE TABLE raw_orders (
  id          INTEGER PRIMARY KEY,
  shop_id     TEXT NOT NULL,
  order_id    TEXT NOT NULL,
  event_type  TEXT NOT NULL,                       -- 'created' | 'updated' | 'refunded'
  payload     TEXT NOT NULL,                        -- surowy JSON
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;
CREATE INDEX idx_raw_orders_shop ON raw_orders(shop_id, order_id);

-- ---------- FAKTY: ZAMÓWIENIA (UPSERT po shop_id+order_id) ----------
CREATE TABLE fact_orders (
  shop_id        TEXT NOT NULL,
  order_id       TEXT NOT NULL,
  order_date     TEXT NOT NULL,                     -- 'YYYY-MM-DD'
  status         TEXT NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'PLN',
  gross_total    INTEGER NOT NULL DEFAULT 0,        -- grosze (brutto)
  tax_total      INTEGER NOT NULL DEFAULT 0,        -- grosze (VAT)
  discount_total INTEGER NOT NULL DEFAULT 0,        -- grosze
  shipping_total INTEGER NOT NULL DEFAULT 0,        -- grosze
  customer_id    TEXT,
  is_refunded    INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (shop_id, order_id)
) STRICT;
CREATE INDEX idx_fact_orders_date ON fact_orders(shop_id, order_date);

-- ---------- FAKTY: ZWROTY (ujemne korekty, data pierwotnego zamówienia) ----------
CREATE TABLE fact_refunds (
  shop_id             TEXT NOT NULL,
  refund_id           TEXT NOT NULL,
  order_id            TEXT NOT NULL,
  refund_amount       INTEGER NOT NULL DEFAULT 0,   -- grosze
  original_order_date TEXT NOT NULL,                -- ROI po dacie pozyskania
  refund_date         TEXT NOT NULL,
  PRIMARY KEY (shop_id, refund_id)
) STRICT;
CREATE INDEX idx_fact_refunds_order ON fact_refunds(shop_id, order_id);

-- ---------- FAKTY: POZYCJE ZAMÓWIEŃ (nazwy produktów pod AI Overview) ----------
CREATE TABLE fact_order_items (
  shop_id      TEXT NOT NULL,
  order_id     TEXT NOT NULL,
  line_id      TEXT NOT NULL,
  product_name TEXT,
  category     TEXT,
  quantity     INTEGER NOT NULL DEFAULT 0,
  line_total   INTEGER NOT NULL DEFAULT 0,          -- grosze
  PRIMARY KEY (shop_id, order_id, line_id)
) STRICT;

-- ---------- FAKTY: GOOGLE ADS DZIENNIE (UPSERT po shop_id+date+campaign_id) ----------
CREATE TABLE fact_ads_daily (
  shop_id                              TEXT NOT NULL,
  date                                 TEXT NOT NULL,   -- 'YYYY-MM-DD'
  campaign_id                          TEXT NOT NULL,
  campaign_name                        TEXT,
  channel_type                         TEXT,            -- Search / Shopping / PMax / Display
  impressions                          INTEGER NOT NULL DEFAULT 0,
  clicks                               INTEGER NOT NULL DEFAULT 0,
  cost                                 INTEGER NOT NULL DEFAULT 0,  -- grosze (cost_micros / 10000)
  conversions                          REAL    NOT NULL DEFAULT 0,  -- Ads zwraca wartości ułamkowe
  conversions_value                    INTEGER NOT NULL DEFAULT 0,  -- grosze (do ROAS)
  search_impression_share              REAL,
  search_budget_lost_impression_share  REAL,
  search_rank_lost_impression_share    REAL,
  PRIMARY KEY (shop_id, date, campaign_id)
) STRICT;
CREATE INDEX idx_fact_ads_date ON fact_ads_daily(shop_id, date);

-- ---------- FAKTY: GA4 DZIENNIE (UPSERT po shop_id+date+channel_group) ----------
CREATE TABLE fact_ga4_daily (
  shop_id          TEXT NOT NULL,
  date             TEXT NOT NULL,
  channel_group    TEXT NOT NULL,
  sessions         INTEGER NOT NULL DEFAULT 0,
  engaged_sessions INTEGER NOT NULL DEFAULT 0,
  key_events       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, date, channel_group)
) STRICT;
CREATE INDEX idx_fact_ga4_date ON fact_ga4_daily(shop_id, date);

-- ---------- CACHE PODSUMOWAŃ AI ----------
CREATE TABLE ai_summaries (
  cache_key    TEXT PRIMARY KEY,                    -- hash: shop + zakres + zakres porównawczy + data_version
  shop_id      TEXT NOT NULL,
  content      TEXT NOT NULL,
  data_version INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;