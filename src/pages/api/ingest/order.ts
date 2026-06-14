/**
 * Webhook zamówień — WooCommerce i sklep niestandardowy.
 * URL: POST /api/ingest/order?shop=<shop_id>
 *
 * WooCommerce: X-WC-Webhook-Signature = base64(HMAC-SHA256(rawBody, webhook_secret))
 * Custom:      X-Custom-Token = statyczny token z wiersza sklepu
 *
 * Po udanym zapisie: data_version sklepu += 1 (invalidacja cache AI).
 */

import type { APIRoute } from "astro";
import { getDB, dbFirst, dbRun } from "../../../lib/db.ts";
import { plnToGrosze } from "../../../lib/money.ts";

// ---------------------------------------------------------------------------
// Typy payloadów
// ---------------------------------------------------------------------------

interface WooLineItem {
  id: number;
  name: string;
  quantity: number;
  total: string;        // PLN decimal
  product_id?: number;
  category?: string;
}

interface WooRefund {
  id: number;
  amount: string;       // PLN decimal
  date_created: string; // ISO 8601
}

interface WooOrder {
  id: number;
  number?: string;
  status: string;
  date_created: string; // ISO 8601
  total: string;
  total_tax: string;
  discount_total: string;
  shipping_total: string;
  customer_id?: number;
  line_items: WooLineItem[];
  refunds?: WooRefund[];
}

interface CustomLineItem {
  line_id: string;
  product_name?: string;
  category?: string;
  quantity: number;
  line_total: number; // PLN decimal
}

interface CustomRefund {
  refund_id: string;
  amount: number;      // PLN decimal
  refund_date: string; // YYYY-MM-DD
}

interface CustomOrder {
  order_id: string;
  status: string;
  order_date: string;     // YYYY-MM-DD
  gross_total: number;    // PLN decimal
  tax_total?: number;
  discount_total?: number;
  shipping_total?: number;
  customer_id?: string;
  items?: CustomLineItem[];
  refunds?: CustomRefund[];
}

interface ShopRow {
  shop_id: string;
  platform: string;
  webhook_secret: string | null;
  custom_token: string | null;
  active: number;
}

// ---------------------------------------------------------------------------
// Pomocnicy kryptograficzne
// ---------------------------------------------------------------------------

/** Porównanie stałoczasowe dwóch stringów (zapobiega timing attack). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Wykonaj pętlę żeby wyrównać czas — ale wynik będzie false
    let r = 1;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i % a.length) ^ b.charCodeAt(i % b.length);
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/** Weryfikuje HMAC-SHA256 WooCommerce: base64(HMAC(rawBody, secret)). */
async function verifyWooSignature(
  rawBody: string,
  secret: string,
  signature: string
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return timingSafeEqual(computed, signature);
}

// ---------------------------------------------------------------------------
// Normalizacja daty ISO → YYYY-MM-DD (bez strefy, pierwsze 10 znaków)
// ---------------------------------------------------------------------------
function isoToDate(iso: string): string {
  return iso.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Endpoint
// ---------------------------------------------------------------------------

export const POST: APIRoute = async ({ request, locals }) => {
  const db = getDB(locals);
  const url = new URL(request.url);
  const shopId = url.searchParams.get("shop");

  if (!shopId) {
    return jsonErr(400, "Brak parametru shop w URL");
  }

  const shop = await dbFirst<ShopRow>(
    db,
    "SELECT shop_id, platform, webhook_secret, custom_token, active FROM shops WHERE shop_id = ?",
    [shopId]
  );
  if (!shop) return jsonErr(404, "Sklep nie istnieje");
  if (!shop.active) return jsonErr(403, "Sklep nieaktywny");

  // Odczytaj surowe body raz (potrzebne do weryfikacji HMAC)
  const rawBody = await request.text();

  const wcSig = request.headers.get("X-WC-Webhook-Signature");
  const customToken = request.headers.get("X-Custom-Token");
  let source: "woocommerce" | "custom";

  if (wcSig) {
    if (!shop.webhook_secret) return jsonErr(401, "Sklep nie ma skonfigurowanego webhook_secret");
    const valid = await verifyWooSignature(rawBody, shop.webhook_secret, wcSig);
    if (!valid) return jsonErr(401, "Nieprawidłowy podpis HMAC");
    source = "woocommerce";
  } else if (customToken) {
    if (!shop.custom_token) return jsonErr(401, "Sklep nie ma skonfigurowanego custom_token");
    if (!timingSafeEqual(customToken, shop.custom_token)) return jsonErr(401, "Nieprawidłowy token");
    source = "custom";
  } else {
    return jsonErr(401, "Brak nagłówka uwierzytelniającego");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonErr(400, "Nieprawidłowy JSON");
  }

  // Typ zdarzenia (WooCommerce przesyła topic w nagłówku)
  const wcTopic = request.headers.get("X-WC-Webhook-Topic") ?? "";
  let eventType = "updated";
  if (wcTopic.endsWith(".created")) eventType = "created";
  else if (wcTopic.endsWith(".deleted") || wcTopic.endsWith(".restored")) eventType = "deleted";
  else if (source === "custom") {
    // Custom może przekazać event_type bezpośrednio w payloadzie
    const p = payload as Record<string, unknown>;
    if (typeof p.event_type === "string") eventType = p.event_type;
  }

  // --- Wyciągnij order_id z payloadu ---
  let orderId: string;
  if (source === "woocommerce") {
    const woo = payload as WooOrder;
    orderId = String(woo.id);
  } else {
    const custom = payload as CustomOrder;
    orderId = custom.order_id;
  }

  // --- Zapisz surowy payload (append-only, audyt) ---
  await dbRun(
    db,
    `INSERT INTO raw_orders (shop_id, order_id, event_type, payload)
     VALUES (?, ?, ?, ?)`,
    [shopId, orderId, eventType, JSON.stringify(payload)]
  );

  // --- Normalizuj i zapisz fakty ---
  if (source === "woocommerce") {
    await upsertWooOrder(db, shopId, payload as WooOrder);
  } else {
    await upsertCustomOrder(db, shopId, payload as CustomOrder);
  }

  // Bump data_version → invalidacja cache AI
  await dbRun(
    db,
    "UPDATE shops SET data_version = data_version + 1 WHERE shop_id = ?",
    [shopId]
  );

  return jsonOk({ ok: true, source, orderId });
};

// ---------------------------------------------------------------------------
// WooCommerce UPSERT
// ---------------------------------------------------------------------------

async function upsertWooOrder(db: D1Database, shopId: string, o: WooOrder): Promise<void> {
  const orderDate = isoToDate(o.date_created);
  const gross = plnToGrosze(o.total);
  const tax = plnToGrosze(o.total_tax);
  const discount = plnToGrosze(o.discount_total);
  const shipping = plnToGrosze(o.shipping_total);
  const isRefunded = o.status === "refunded" ? 1 : 0;

  await dbRun(
    db,
    `INSERT INTO fact_orders
       (shop_id, order_id, order_date, status, currency,
        gross_total, tax_total, discount_total, shipping_total,
        customer_id, is_refunded, updated_at)
     VALUES (?, ?, ?, ?, 'PLN', ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (shop_id, order_id) DO UPDATE SET
       order_date     = excluded.order_date,
       status         = excluded.status,
       gross_total    = excluded.gross_total,
       tax_total      = excluded.tax_total,
       discount_total = excluded.discount_total,
       shipping_total = excluded.shipping_total,
       customer_id    = excluded.customer_id,
       is_refunded    = excluded.is_refunded,
       updated_at     = excluded.updated_at`,
    [shopId, String(o.id), orderDate, o.status, gross, tax, discount, shipping,
     o.customer_id ? String(o.customer_id) : null, isRefunded]
  );

  // Pozycje zamówienia
  if (o.line_items?.length) {
    const stmts = o.line_items.map((item) =>
      db.prepare(
        `INSERT INTO fact_order_items
           (shop_id, order_id, line_id, product_name, category, quantity, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (shop_id, order_id, line_id) DO UPDATE SET
           product_name = excluded.product_name,
           category     = excluded.category,
           quantity     = excluded.quantity,
           line_total   = excluded.line_total`
      ).bind(
        shopId, String(o.id), String(item.id),
        item.name ?? null, item.category ?? null,
        item.quantity, plnToGrosze(item.total)
      )
    );
    await db.batch(stmts);
  }

  // Zwroty
  if (o.refunds?.length) {
    const stmts = o.refunds.map((r) =>
      db.prepare(
        `INSERT INTO fact_refunds
           (shop_id, refund_id, order_id, refund_amount, original_order_date, refund_date)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (shop_id, refund_id) DO UPDATE SET
           refund_amount       = excluded.refund_amount,
           original_order_date = excluded.original_order_date,
           refund_date         = excluded.refund_date`
      ).bind(
        shopId, String(r.id), String(o.id),
        plnToGrosze(r.amount), orderDate, isoToDate(r.date_created)
      )
    );
    await db.batch(stmts);
  }
}

// ---------------------------------------------------------------------------
// Custom shop UPSERT
// ---------------------------------------------------------------------------

async function upsertCustomOrder(db: D1Database, shopId: string, o: CustomOrder): Promise<void> {
  const gross = plnToGrosze(o.gross_total);
  const tax = plnToGrosze(o.tax_total ?? 0);
  const discount = plnToGrosze(o.discount_total ?? 0);
  const shipping = plnToGrosze(o.shipping_total ?? 0);
  const isRefunded = o.status === "refunded" ? 1 : 0;

  await dbRun(
    db,
    `INSERT INTO fact_orders
       (shop_id, order_id, order_date, status, currency,
        gross_total, tax_total, discount_total, shipping_total,
        customer_id, is_refunded, updated_at)
     VALUES (?, ?, ?, ?, 'PLN', ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (shop_id, order_id) DO UPDATE SET
       order_date     = excluded.order_date,
       status         = excluded.status,
       gross_total    = excluded.gross_total,
       tax_total      = excluded.tax_total,
       discount_total = excluded.discount_total,
       shipping_total = excluded.shipping_total,
       customer_id    = excluded.customer_id,
       is_refunded    = excluded.is_refunded,
       updated_at     = excluded.updated_at`,
    [shopId, o.order_id, o.order_date, o.status, gross, tax, discount, shipping,
     o.customer_id ?? null, isRefunded]
  );

  if (o.items?.length) {
    const stmts = o.items.map((item) =>
      db.prepare(
        `INSERT INTO fact_order_items
           (shop_id, order_id, line_id, product_name, category, quantity, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (shop_id, order_id, line_id) DO UPDATE SET
           product_name = excluded.product_name,
           category     = excluded.category,
           quantity     = excluded.quantity,
           line_total   = excluded.line_total`
      ).bind(
        shopId, o.order_id, item.line_id,
        item.product_name ?? null, item.category ?? null,
        item.quantity, plnToGrosze(item.line_total)
      )
    );
    await db.batch(stmts);
  }

  if (o.refunds?.length) {
    const stmts = o.refunds.map((r) =>
      db.prepare(
        `INSERT INTO fact_refunds
           (shop_id, refund_id, order_id, refund_amount, original_order_date, refund_date)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (shop_id, refund_id) DO UPDATE SET
           refund_amount       = excluded.refund_amount,
           original_order_date = excluded.original_order_date,
           refund_date         = excluded.refund_date`
      ).bind(
        shopId, r.refund_id, o.order_id,
        plnToGrosze(r.amount), o.order_date, r.refund_date
      )
    );
    await db.batch(stmts);
  }
}

// ---------------------------------------------------------------------------
// Helpery odpowiedzi
// ---------------------------------------------------------------------------

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
