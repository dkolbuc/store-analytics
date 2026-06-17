-- Migracja 0004: zdarzenia GA4 (dzień × kanał × nazwa zdarzenia).
CREATE TABLE fact_ga4_events_daily (
  shop_id       TEXT    NOT NULL,
  date          TEXT    NOT NULL,
  channel_group TEXT    NOT NULL,
  event_name    TEXT    NOT NULL,
  event_count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, date, channel_group, event_name)
) STRICT;