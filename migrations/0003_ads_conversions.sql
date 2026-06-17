-- Migracja 0003: konwersje Ads w rozbiciu na nazwę akcji konwersji.
CREATE TABLE fact_ads_conversions_daily (
  shop_id           TEXT    NOT NULL,
  date              TEXT    NOT NULL,            -- YYYY-MM-DD
  conversion_action TEXT    NOT NULL,            -- nazwa akcji konwersji
  conversions       REAL    NOT NULL DEFAULT 0,
  conversions_value INTEGER NOT NULL DEFAULT 0,  -- grosze
  PRIMARY KEY (shop_id, date, conversion_action)
) STRICT;