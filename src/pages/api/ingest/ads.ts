/**
 * Ingestia danych Google Ads.
 * POST /api/ingest/ads
 * Auth: X-Ingest-Secret (shared secret z env INGEST_SECRET)
 *
 * Payload: { shop_id: string, rows: AdsRow[] }
 * cost i conversions_value w micros (jak Google Ads API).
 */

import type { APIRoute } from "astro";
import { getDB, dbFirst, dbRun } from "../../../lib/db.ts";
import { microsToGrosze } from "../../../lib/money.ts";

interface AdsRow {
  date: string;          // YYYY-MM-DD
  campaign_id: string;
  campaign_name?: string;
  channel_type?: string; // Search | Shopping | PMax | Display
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;   // REAL — Google Ads zwraca wartości ułamkowe
  conversions_value_micros: number;
  search_impression_share?: number | null;
  search_budget_lost_impression_share?: number | null;
  search_rank_lost_impression_share?: number | null;
}

interface AdsPayload {
  shop_id: string;
  rows: AdsRow[];
}

interface ShopRow {
  shop_id: string;
  active: number;
}

// ---------------------------------------------------------------------------

/** Stałoczasowe porównanie stringów (zapobiega timing attack). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    let r = 1;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i % a.length) ^ b.charCodeAt(i % b.length);
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const db = getDB(locals);
  const ingestSecret = locals.runtime.env.INGEST_SECRET;

  // Weryfikacja sekretu
  const header = request.headers.get("X-Ingest-Secret") ?? "";
  if (!ingestSecret || !timingSafeEqual(header, ingestSecret)) {
    return jsonErr(401, "Nieautoryzowane");
  }

  let body: AdsPayload;
  try {
    body = (await request.json()) as AdsPayload;
    if (!body.shop_id || !Array.isArray(body.rows))
      throw new Error("Nieprawidłowa struktura");
  } catch (e) {
    return jsonErr(400, `Nieprawidłowy payload: ${String(e)}`);
  }

  const { shop_id: shopId, rows } = body;

  // Walidacja sklepu
  const shop = await dbFirst<ShopRow>(
    db,
    "SELECT shop_id, active FROM shops WHERE shop_id = ?",
    [shopId]
  );
  if (!shop) return jsonErr(404, "Sklep nie istnieje");
  if (!shop.active) return jsonErr(403, "Sklep nieaktywny");

  // UPSERT zbiorczy przez batch()
  const stmts = rows.map((r) =>
    db
      .prepare(
        `INSERT INTO fact_ads_daily
           (shop_id, date, campaign_id, campaign_name, channel_type,
            impressions, clicks, cost, conversions, conversions_value,
            search_impression_share, search_budget_lost_impression_share,
            search_rank_lost_impression_share)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (shop_id, date, campaign_id) DO UPDATE SET
           campaign_name                       = excluded.campaign_name,
           channel_type                        = excluded.channel_type,
           impressions                         = excluded.impressions,
           clicks                              = excluded.clicks,
           cost                                = excluded.cost,
           conversions                         = excluded.conversions,
           conversions_value                   = excluded.conversions_value,
           search_impression_share             = excluded.search_impression_share,
           search_budget_lost_impression_share = excluded.search_budget_lost_impression_share,
           search_rank_lost_impression_share   = excluded.search_rank_lost_impression_share`
      )
      .bind(
        shopId,
        r.date,
        r.campaign_id,
        r.campaign_name ?? null,
        r.channel_type ?? null,
        r.impressions,
        r.clicks,
        microsToGrosze(r.cost_micros),
        r.conversions,
        microsToGrosze(r.conversions_value_micros),
        r.search_impression_share ?? null,
        r.search_budget_lost_impression_share ?? null,
        r.search_rank_lost_impression_share ?? null
      )
  );

  if (stmts.length > 0) {
    await db.batch(stmts);
  }

  // Bump data_version → invalidacja cache AI
  await dbRun(
    db,
    "UPDATE shops SET data_version = data_version + 1 WHERE shop_id = ?",
    [shopId]
  );

  return jsonOk({ ok: true, imported: rows.length });
};

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonErr(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
