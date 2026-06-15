-- Migracja 0002: atrybucja marketingowa na poziomie zamówienia (UTM).
-- Pola nieosobowe — opisują źródło ruchu, nie klienta.
ALTER TABLE fact_orders ADD COLUMN utm_source TEXT;
ALTER TABLE fact_orders ADD COLUMN utm_medium TEXT;
ALTER TABLE fact_orders ADD COLUMN utm_campaign TEXT;