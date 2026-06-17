/**
 * Ingestia dziennych zdarzeń Google Analytics 4 wg akcji zdarzenia.
 * POST /api/ingest/ga4-events
 * Auth: X-Ingest-Secret (shared secret z env INGEST_SECRET)
 *
 * Payload: { shop_id: string, rows: GA4EventRow[] }
 * Schemat docelowy: fact_ga4_events_daily(shop_id, date, channel_group, event_name, event_count)
 */

import type { APIRoute } from "astro";
import { getDB, dbFirst, dbRun } from "../../../lib/db.ts";

interface GA4EventRow {
  date: string;           // YYYY-MM-DD
  channel_group: string;
  event_name: string;
  event_count: number;
}

interface GA4EventsPayload {
  shop_id: string;
  rows: GA4EventRow[];
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

  const header = request.headers.get("X-Ingest-Secret") ?? "";
  if (!ingestSecret || !timingSafeEqual(header, ingestSecret)) {
    return jsonErr(401, "Nieautoryzowane");
  }

  let body: GA4EventsPayload;
  try {
    body = (await request.json()) as GA4EventsPayload;
    if (!body.shop_id || !Array.isArray(body.rows))
      throw new Error("Nieprawidłowa struktura");
  } catch (e) {
    return jsonErr(400, `Nieprawidłowy payload: ${String(e)}`);
  }

  const { shop_id: shopId, rows } = body;

  const shop = await dbFirst<ShopRow>(
    db,
    "SELECT shop_id, active FROM shops WHERE shop_id = ?",
    [shopId]
  );
  if (!shop)        return jsonErr(404, "Sklep nie istnieje");
  if (!shop.active) return jsonErr(403, "Sklep nieaktywny");

  // UPSERT zbiorczy przez batch()
  if (rows.length > 0) {
    await db.batch(
      rows.map((r) =>
        db
          .prepare(
            `INSERT INTO fact_ga4_events_daily
               (shop_id, date, channel_group, event_name, event_count)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (shop_id, date, channel_group, event_name) DO UPDATE SET
               event_count = excluded.event_count`
          )
          .bind(shopId, r.date, r.channel_group, r.event_name, r.event_count)
      )
    );
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
