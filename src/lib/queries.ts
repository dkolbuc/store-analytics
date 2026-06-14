/**
 * Agregacje D1 dla dashboardu.
 * Wszystkie kwoty w groszach (INTEGER). Konwersja do PLN w warstwie prezentacji.
 */

import { dbAll, dbFirst, type DB } from "./db.ts";

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string;
}

// ---------------------------------------------------------------------------
// Metryki zagregowane
// ---------------------------------------------------------------------------

export interface SalesMetrics {
  revenue: number;  // grosze — przychód netto (gross−shipping−zwroty)
  orders: number;
  aov: number;      // grosze — average order value
  refunds: number;  // grosze — suma zwrotów w okresie
}

export interface AdsMetrics {
  cost: number;              // grosze
  conversionsValue: number;  // grosze
  conversions: number;
  clicks: number;
  impressions: number;
  impressionShare: number | null;   // 0–1
  budgetLostShare: number | null;
  rankLostShare: number | null;
}

export interface ChannelRow {
  channel: string;
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
}

export interface GA4Metrics {
  sessions: number;
  engagedSessions: number;
  engagementRate: number; // procent
  keyEvents: number;
  byChannel: ChannelRow[];
}

// ---------------------------------------------------------------------------
// Serie dzienne (dla wykresów)
// ---------------------------------------------------------------------------

export interface DailyPoint {
  date: string;  // YYYY-MM-DD
  value: number; // grosze dla kwot, liczba dla metryk count
}

export interface DailyAdsPoint {
  date: string;
  cost: number;             // grosze
  conversionsValue: number; // grosze
}

// ---------------------------------------------------------------------------
// Produkty
// ---------------------------------------------------------------------------

export interface TopProduct {
  productName: string;
  qty: number;
  value: number; // grosze
}

// ---------------------------------------------------------------------------
// Wartości domyślne (przy braku danych / błędzie zapytania)
// ---------------------------------------------------------------------------

export const ZERO_SALES: SalesMetrics = { revenue: 0, orders: 0, aov: 0, refunds: 0 };
export const ZERO_ADS: AdsMetrics = {
  cost: 0, conversionsValue: 0, conversions: 0,
  clicks: 0, impressions: 0,
  impressionShare: null, budgetLostShare: null, rankLostShare: null,
};
export const ZERO_GA4: GA4Metrics = {
  sessions: 0, engagedSessions: 0, engagementRate: 0, keyEvents: 0, byChannel: [],
};

// ---------------------------------------------------------------------------
// Sprzedaż
// ---------------------------------------------------------------------------

interface SalesRow { revenue: number | null; orders: number | null; }
interface RefundRow { refunds: number | null; }

/**
 * Przychód netto = SUM(gross_total − shipping_total) dla statusów != cancelled/refunded
 * minus zwroty zaksięgowane w tym samym oknie dat.
 * VAT (tax_total) jest zawarty w gross_total — na razie go nie odejmujemy.
 */
export async function querySales(
  db: DB, shopId: string, range: DateRange
): Promise<SalesMetrics> {
  const [salesRow, refundRow] = await Promise.all([
    dbFirst<SalesRow>(db,
      `SELECT
         SUM(CASE WHEN status NOT IN ('cancelled','refunded')
             THEN gross_total - shipping_total ELSE 0 END) AS revenue,
         COUNT(CASE WHEN status NOT IN ('cancelled','refunded') THEN 1 END) AS orders
       FROM fact_orders
       WHERE shop_id = ? AND order_date BETWEEN ? AND ?`,
      [shopId, range.start, range.end]
    ),
    dbFirst<RefundRow>(db,
      `SELECT COALESCE(SUM(refund_amount), 0) AS refunds
       FROM fact_refunds
       WHERE shop_id = ? AND refund_date BETWEEN ? AND ?`,
      [shopId, range.start, range.end]
    ),
  ]);

  const gross = salesRow?.revenue ?? 0;
  const orders = salesRow?.orders ?? 0;
  const refunds = refundRow?.refunds ?? 0;
  const revenue = Math.max(0, gross - refunds);

  return { revenue, orders, aov: orders > 0 ? Math.round(revenue / orders) : 0, refunds };
}

export async function querySalesDaily(
  db: DB, shopId: string, range: DateRange
): Promise<DailyPoint[]> {
  interface Row { date: string; value: number; }
  return dbAll<Row>(db,
    `SELECT order_date AS date,
       SUM(CASE WHEN status NOT IN ('cancelled','refunded')
           THEN gross_total - shipping_total ELSE 0 END) AS value
     FROM fact_orders
     WHERE shop_id = ? AND order_date BETWEEN ? AND ?
     GROUP BY order_date ORDER BY order_date`,
    [shopId, range.start, range.end]
  );
}

// ---------------------------------------------------------------------------
// Reklama
// ---------------------------------------------------------------------------

interface AdsRow {
  cost: number | null; conversionsValue: number | null; conversions: number | null;
  clicks: number | null; impressions: number | null;
  impressionShare: number | null; budgetLostShare: number | null; rankLostShare: number | null;
}

export async function queryAds(
  db: DB, shopId: string, range: DateRange
): Promise<AdsMetrics> {
  const row = await dbFirst<AdsRow>(db,
    `SELECT
       COALESCE(SUM(cost), 0)               AS cost,
       COALESCE(SUM(conversions_value), 0)  AS conversionsValue,
       COALESCE(SUM(conversions), 0)        AS conversions,
       COALESCE(SUM(clicks), 0)             AS clicks,
       COALESCE(SUM(impressions), 0)        AS impressions,
       AVG(search_impression_share)         AS impressionShare,
       AVG(search_budget_lost_impression_share) AS budgetLostShare,
       AVG(search_rank_lost_impression_share)   AS rankLostShare
     FROM fact_ads_daily
     WHERE shop_id = ? AND date BETWEEN ? AND ?`,
    [shopId, range.start, range.end]
  );
  return {
    cost:             row?.cost ?? 0,
    conversionsValue: row?.conversionsValue ?? 0,
    conversions:      row?.conversions ?? 0,
    clicks:           row?.clicks ?? 0,
    impressions:      row?.impressions ?? 0,
    impressionShare:  row?.impressionShare ?? null,
    budgetLostShare:  row?.budgetLostShare ?? null,
    rankLostShare:    row?.rankLostShare ?? null,
  };
}

export async function queryAdsDaily(
  db: DB, shopId: string, range: DateRange
): Promise<DailyAdsPoint[]> {
  interface Row { date: string; cost: number; conversionsValue: number; }
  return dbAll<Row>(db,
    `SELECT date, SUM(cost) AS cost, SUM(conversions_value) AS conversionsValue
     FROM fact_ads_daily
     WHERE shop_id = ? AND date BETWEEN ? AND ?
     GROUP BY date ORDER BY date`,
    [shopId, range.start, range.end]
  );
}

// ---------------------------------------------------------------------------
// GA4
// ---------------------------------------------------------------------------

export async function queryGA4(
  db: DB, shopId: string, range: DateRange
): Promise<GA4Metrics> {
  interface Row { channel: string; sessions: number; engagedSessions: number; keyEvents: number; }
  const rows = await dbAll<Row>(db,
    `SELECT channel_group AS channel,
       SUM(sessions)         AS sessions,
       SUM(engaged_sessions) AS engagedSessions,
       SUM(key_events)       AS keyEvents
     FROM fact_ga4_daily
     WHERE shop_id = ? AND date BETWEEN ? AND ?
     GROUP BY channel_group ORDER BY sessions DESC`,
    [shopId, range.start, range.end]
  );
  const totalSessions = rows.reduce((s, r) => s + r.sessions, 0);
  const totalEngaged  = rows.reduce((s, r) => s + r.engagedSessions, 0);
  return {
    sessions:        totalSessions,
    engagedSessions: totalEngaged,
    engagementRate:  totalSessions > 0 ? (totalEngaged / totalSessions) * 100 : 0,
    keyEvents:       rows.reduce((s, r) => s + r.keyEvents, 0),
    byChannel:       rows,
  };
}

export async function queryGA4Daily(
  db: DB, shopId: string, range: DateRange
): Promise<DailyPoint[]> {
  interface Row { date: string; value: number; }
  return dbAll<Row>(db,
    `SELECT date, SUM(sessions) AS value
     FROM fact_ga4_daily
     WHERE shop_id = ? AND date BETWEEN ? AND ?
     GROUP BY date ORDER BY date`,
    [shopId, range.start, range.end]
  );
}

// ---------------------------------------------------------------------------
// Top produkty
// ---------------------------------------------------------------------------

export async function queryTopProducts(
  db: DB, shopId: string, range: DateRange, limit = 10
): Promise<TopProduct[]> {
  interface Row { productName: string | null; qty: number; value: number; }
  const rows = await dbAll<Row>(db,
    `SELECT oi.product_name AS productName,
       SUM(oi.quantity)   AS qty,
       SUM(oi.line_total) AS value
     FROM fact_order_items oi
     JOIN fact_orders o ON o.shop_id = oi.shop_id AND o.order_id = oi.order_id
     WHERE oi.shop_id = ?
       AND o.order_date BETWEEN ? AND ?
       AND o.status NOT IN ('cancelled','refunded')
       AND oi.product_name IS NOT NULL
     GROUP BY oi.product_name
     ORDER BY value DESC
     LIMIT ?`,
    [shopId, range.start, range.end, limit]
  );
  return rows.map(r => ({ productName: r.productName ?? "(nieznany)", qty: r.qty, value: r.value }));
}
