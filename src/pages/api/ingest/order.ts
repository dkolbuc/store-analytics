/**
 * Webhook zamówień — WooCommerce i sklep niestandardowy.
 * URL: POST /api/ingest/order?shop=<shop_id>
 *
 * WooCommerce: X-WC-Webhook-Signature = base64(HMAC-SHA256(rawBody, webhook_secret))
 * Custom:      X-Custom-Token = statyczny token z wiersza sklepu
 *
 * PRYWATNOŚĆ: po weryfikacji podpisu surowy payload przechodzi przez whitelist
 * (sanitizeWooOrder / sanitizeCustomOrder). Tylko oczyszczony obiekt jest zapisywany
 * do raw_orders i używany do UPSERTów faktów — nigdy oryginalny payload z PII.
 *
 * Po udanym zapisie: data_version sklepu += 1 (invalidacja cache AI).
 * Retencja raw_orders: RAW_RETENTION_DAYS dni (DELETE po każdym żądaniu).
 */

import type { APIRoute } from "astro";
import { getDB, dbFirst, dbRun } from "../../../lib/db.ts";
import { plnToGrosze } from "../../../lib/money.ts";

// Liczba dni przechowywania wierszy raw_orders
const RAW_RETENTION_DAYS = 180;

// ---------------------------------------------------------------------------
// Oczyszczone typy — wyłącznie dane nieosobowe (whitelist)
// ---------------------------------------------------------------------------

interface SanitizedLineItem {
  line_id: number;
  product_id: number | null;
  name: string;
  quantity: number;
  total: string;  // decimal PLN
}

interface SanitizedRefund {
  refund_id: number;
  amount: number;  // PLN, zawsze > 0 (Math.abs z r.total)
  date: string;    // YYYY-MM-DD
}

/** Oczyszczony payload WooCommerce — zero PII. */
interface SanitizedWooOrder {
  order_id: number;
  date: string;      // YYYY-MM-DD
  status: string;
  currency: string;
  totals: {
    total: string;
    total_tax: string;
    discount_total: string;
    shipping_total: string;
  };
  line_items: SanitizedLineItem[];
  refunds: SanitizedRefund[];
  utm_source:   string | null;
  utm_medium:   string | null;
  utm_campaign: string | null;
}

interface SanitizedCustomLineItem {
  line_id:      string;
  product_name: string | null;
  category:     string | null;
  quantity:     number;
  line_total:   number;  // PLN decimal
}

interface SanitizedCustomRefund {
  refund_id: string;
  amount:    number;  // PLN, zawsze > 0
  date:      string;  // YYYY-MM-DD
}

/** Oczyszczony payload custom — zero PII (bez customer_id). */
interface SanitizedCustomOrder {
  order_id:       string;
  status:         string;
  date:           string;   // YYYY-MM-DD
  gross_total:    number;
  tax_total:      number;
  discount_total: number;
  shipping_total: number;
  items:          SanitizedCustomLineItem[];
  refunds:        SanitizedCustomRefund[];
  utm_source:     string | null;
  utm_medium:     string | null;
  utm_campaign:   string | null;
}

interface ShopRow {
  shop_id:        string;
  platform:       string;
  webhook_secret: string | null;
  custom_token:   string | null;
  active:         number;
}

// ---------------------------------------------------------------------------
// Sanityzacja — whitelist, zero PII
// ---------------------------------------------------------------------------

/**
 * Wyciąga z surowego payloadu WooCommerce WYŁĄCZNIE dozwolone pola.
 * Odrzuca: billing, shipping, customer_id, customer_ip_address,
 * customer_user_agent, customer_note i całe meta_data (za wyjątkiem UTM).
 */
function sanitizeWooOrder(raw: unknown): SanitizedWooOrder {
  const p = raw as Record<string, unknown>;

  // UTM z meta_data — wyłącznie trzy znane klucze atrybucji
  const meta = Array.isArray(p.meta_data)
    ? (p.meta_data as Array<Record<string, unknown>>)
    : [];
  const findMeta = (key: string): string | null => {
    const entry = meta.find((m) => m.key === key);
    return typeof entry?.value === "string" ? entry.value : null;
  };

  const rawItems = Array.isArray(p.line_items)
    ? (p.line_items as Array<Record<string, unknown>>)
    : [];
  const rawRefunds = Array.isArray(p.refunds)
    ? (p.refunds as Array<Record<string, unknown>>)
    : [];

  return {
    order_id: Number(p.id),
    date:     isoToDate(String(p.date_created ?? "")),
    status:   String(p.status ?? ""),
    currency: String(p.currency ?? "PLN"),
    totals: {
      total:          String(p.total          ?? "0"),
      total_tax:      String(p.total_tax      ?? "0"),
      discount_total: String(p.discount_total ?? "0"),
      shipping_total: String(p.shipping_total ?? "0"),
    },
    // BEZ meta_data pozycji — tylko dane sprzedażowe
    line_items: rawItems.map((item) => ({
      line_id:    Number(item.id),
      product_id: item.product_id != null ? Number(item.product_id) : null,
      name:       String(item.name ?? ""),
      quantity:   Number(item.quantity ?? 0),
      total:      String(item.total ?? "0"),
    })),
    // r.total w Woo to string ujemny, np. "-50.00"
    refunds: rawRefunds.map((r) => ({
      refund_id: Number(r.id),
      amount:    Math.abs(parseFloat(String(r.total ?? "0"))),
      date:      isoToDate(String(r.date_created ?? "")),
    })),
    utm_source:   findMeta("_wc_order_attribution_utm_source"),
    utm_medium:   findMeta("_utm_medium"),
    utm_campaign: findMeta("_utm_campaign"),
  };
}

/**
 * Whitelist payloadu custom — usuwa customer_id i wszelkie nieznane pola.
 * UTM opcjonalnie na pierwszym poziomie payloadu.
 */
function sanitizeCustomOrder(raw: unknown): SanitizedCustomOrder {
  const p = raw as Record<string, unknown>;

  const rawItems = Array.isArray(p.items)
    ? (p.items as Array<Record<string, unknown>>)
    : [];
  const rawRefunds = Array.isArray(p.refunds)
    ? (p.refunds as Array<Record<string, unknown>>)
    : [];

  const strOrNull = (v: unknown): string | null =>
    typeof v === "string" && v !== "" ? v : null;

  return {
    order_id:       String(p.order_id ?? ""),
    status:         String(p.status   ?? ""),
    date:           String(p.order_date ?? "").slice(0, 10),
    gross_total:    Number(p.gross_total    ?? 0),
    tax_total:      Number(p.tax_total      ?? 0),
    discount_total: Number(p.discount_total ?? 0),
    shipping_total: Number(p.shipping_total ?? 0),
    // customer_id celowo pominięty
    items: rawItems.map((item) => ({
      line_id:      String(item.line_id ?? ""),
      product_name: strOrNull(item.product_name),
      category:     strOrNull(item.category),
      quantity:     Number(item.quantity  ?? 0),
      line_total:   Number(item.line_total ?? 0),
    })),
    refunds: rawRefunds.map((r) => ({
      refund_id: String(r.refund_id ?? ""),
      amount:    Math.abs(Number(r.amount ?? 0)),
      date:      String(r.refund_date ?? "").slice(0, 10),
    })),
    utm_source:   strOrNull(p.utm_source),
    utm_medium:   strOrNull(p.utm_medium),
    utm_campaign: strOrNull(p.utm_campaign),
  };
}

// ---------------------------------------------------------------------------
// Pomocnicy kryptograficzne
// ---------------------------------------------------------------------------

/** Porównanie stałoczasowe (zapobiega timing attack na custom_token). */
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
// Normalizacja daty ISO → YYYY-MM-DD
// ---------------------------------------------------------------------------

function isoToDate(iso: string): string {
  return iso.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Endpoint
// ---------------------------------------------------------------------------

export const POST: APIRoute = async ({ request, locals }) => {
  const db  = getDB(locals);
  const url = new URL(request.url);
  const shopId = url.searchParams.get("shop");

  if (!shopId) return jsonErr(400, "Brak parametru shop w URL");

  const shop = await dbFirst<ShopRow>(
    db,
    "SELECT shop_id, platform, webhook_secret, custom_token, active FROM shops WHERE shop_id = ?",
    [shopId]
  );
  if (!shop)        return jsonErr(404, "Sklep nie istnieje");
  if (!shop.active) return jsonErr(403, "Sklep nieaktywny");

  // Surowe body odczytane raz — string potrzebny do HMAC i parsowania
  const rawBody = await request.text();

  // ---------------------------------------------------------------------------
  // Ping walidacyjny WooCommerce — PRZED auth i zapisem
  //
  // Woo wysyła ping jako application/x-www-form-urlencoded z body "webhook_id=<n>",
  // bez nagłówka X-WC-Webhook-Signature. Obsługujemy trzy warianty:
  //   1. Content-Type zawiera application/x-www-form-urlencoded
  //   2. body nie jest JSON-em, ale zawiera "webhook_id=" (form-encoded)
  //   3. body jest JSON-em z polem webhook_id i bez pola id
  // ---------------------------------------------------------------------------
  const contentType = request.headers.get("Content-Type") ?? "";
  const isFormEncoded = contentType.includes("application/x-www-form-urlencoded");

  if (isFormEncoded || rawBody.includes("webhook_id=")) {
    // Wariant form-encoded — body nie jest JSON-em zamówienia
    return jsonOk({ ok: true, ping: true });
  }

  // Próba parsowania JSON — tylko dla właściwych dostaw (Content-Type: application/json)
  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(rawBody);
  } catch {
    return jsonErr(400, "Nieprawidłowy JSON");
  }

  // Wariant JSON z webhook_id i bez id (dodatkowe zabezpieczenie)
  const rawObj = rawParsed as Record<string, unknown>;
  if ("webhook_id" in rawObj && !("id" in rawObj)) {
    return jsonOk({ ok: true, ping: true });
  }

  const wcSig      = request.headers.get("X-WC-Webhook-Signature");
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

  // Typ zdarzenia
  const wcTopic = request.headers.get("X-WC-Webhook-Topic") ?? "";
  let eventType = "updated";
  if      (wcTopic.endsWith(".created"))                            eventType = "created";
  else if (wcTopic.endsWith(".deleted") || wcTopic.endsWith(".restored")) eventType = "deleted";
  else if (source === "custom") {
    const p = rawParsed as Record<string, unknown>;
    if (typeof p.event_type === "string") eventType = p.event_type;
  }

  // ---------------------------------------------------------------------------
  // Sanityzacja — od tego momentu NIE używamy rawParsed (PII może być w środku)
  // ---------------------------------------------------------------------------

  let sanitized: SanitizedWooOrder | SanitizedCustomOrder;
  let orderId: string;

  if (source === "woocommerce") {
    const clean = sanitizeWooOrder(rawParsed);
    sanitized = clean;
    orderId   = String(clean.order_id);
  } else {
    const clean = sanitizeCustomOrder(rawParsed);
    sanitized = clean;
    orderId   = clean.order_id;
  }

  // Zapisz OCZYSZCZONY obiekt (nie oryginalny rawBody)
  await dbRun(
    db,
    `INSERT INTO raw_orders (shop_id, order_id, event_type, payload)
     VALUES (?, ?, ?, ?)`,
    [shopId, orderId, eventType, JSON.stringify(sanitized)]
  );

  // Zapisz fakty z oczyszczonego obiektu
  if (source === "woocommerce") {
    await upsertWooOrder(db, shopId, sanitized as SanitizedWooOrder);
  } else {
    await upsertCustomOrder(db, shopId, sanitized as SanitizedCustomOrder);
  }

  // Bump data_version → invalidacja cache AI
  await dbRun(
    db,
    "UPDATE shops SET data_version = data_version + 1 WHERE shop_id = ?",
    [shopId]
  );

  // Retencja: usuń stare wpisy raw_orders
  await dbRun(
    db,
    "DELETE FROM raw_orders WHERE received_at < datetime('now', ? || ' days')",
    [`-${RAW_RETENTION_DAYS}`]
  );

  return jsonOk({ ok: true, source, orderId });
};

// ---------------------------------------------------------------------------
// WooCommerce UPSERT (z oczyszczonego obiektu)
// ---------------------------------------------------------------------------

async function upsertWooOrder(
  db: D1Database,
  shopId: string,
  o: SanitizedWooOrder
): Promise<void> {
  const gross    = plnToGrosze(o.totals.total);
  const tax      = plnToGrosze(o.totals.total_tax);
  const discount = plnToGrosze(o.totals.discount_total);
  const shipping = plnToGrosze(o.totals.shipping_total);
  // is_refunded = status 'refunded' LUB istnieją zwroty w payloadzie
  const isRefunded = o.status === "refunded" || o.refunds.length > 0 ? 1 : 0;

  await dbRun(
    db,
    `INSERT INTO fact_orders
       (shop_id, order_id, order_date, status, currency,
        gross_total, tax_total, discount_total, shipping_total,
        customer_id, is_refunded,
        utm_source, utm_medium, utm_campaign,
        updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (shop_id, order_id) DO UPDATE SET
       order_date     = excluded.order_date,
       status         = excluded.status,
       gross_total    = excluded.gross_total,
       tax_total      = excluded.tax_total,
       discount_total = excluded.discount_total,
       shipping_total = excluded.shipping_total,
       is_refunded    = excluded.is_refunded,
       utm_source     = COALESCE(excluded.utm_source,   utm_source),
       utm_medium     = COALESCE(excluded.utm_medium,   utm_medium),
       utm_campaign   = COALESCE(excluded.utm_campaign, utm_campaign),
       updated_at     = excluded.updated_at`,
    [
      shopId, String(o.order_id), o.date, o.status, o.currency,
      gross, tax, discount, shipping,
      isRefunded,
      o.utm_source, o.utm_medium, o.utm_campaign,
    ]
  );

  // Pozycje zamówienia
  if (o.line_items.length) {
    await db.batch(
      o.line_items.map((item) =>
        db.prepare(
          `INSERT INTO fact_order_items
             (shop_id, order_id, line_id, product_name, category, quantity, line_total)
           VALUES (?, ?, ?, ?, NULL, ?, ?)
           ON CONFLICT (shop_id, order_id, line_id) DO UPDATE SET
             product_name = excluded.product_name,
             quantity     = excluded.quantity,
             line_total   = excluded.line_total`
        ).bind(
          shopId, String(o.order_id), String(item.line_id),
          item.name, item.quantity, plnToGrosze(item.total)
        )
      )
    );
  }

  // Zwroty
  if (o.refunds.length) {
    await db.batch(
      o.refunds.map((r) =>
        db.prepare(
          `INSERT INTO fact_refunds
             (shop_id, refund_id, order_id, refund_amount, original_order_date, refund_date)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (shop_id, refund_id) DO UPDATE SET
             refund_amount       = excluded.refund_amount,
             original_order_date = excluded.original_order_date,
             refund_date         = excluded.refund_date`
        ).bind(
          shopId, String(r.refund_id), String(o.order_id),
          plnToGrosze(r.amount), o.date, r.date
        )
      )
    );
  }
}

// ---------------------------------------------------------------------------
// Custom shop UPSERT (z oczyszczonego obiektu)
// ---------------------------------------------------------------------------

async function upsertCustomOrder(
  db: D1Database,
  shopId: string,
  o: SanitizedCustomOrder
): Promise<void> {
  const gross    = plnToGrosze(o.gross_total);
  const tax      = plnToGrosze(o.tax_total);
  const discount = plnToGrosze(o.discount_total);
  const shipping = plnToGrosze(o.shipping_total);
  const isRefunded = o.status === "refunded" || o.refunds.length > 0 ? 1 : 0;

  await dbRun(
    db,
    `INSERT INTO fact_orders
       (shop_id, order_id, order_date, status, currency,
        gross_total, tax_total, discount_total, shipping_total,
        customer_id, is_refunded,
        utm_source, utm_medium, utm_campaign,
        updated_at)
     VALUES (?, ?, ?, ?, 'PLN', ?, ?, ?, ?, NULL, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (shop_id, order_id) DO UPDATE SET
       order_date     = excluded.order_date,
       status         = excluded.status,
       gross_total    = excluded.gross_total,
       tax_total      = excluded.tax_total,
       discount_total = excluded.discount_total,
       shipping_total = excluded.shipping_total,
       is_refunded    = excluded.is_refunded,
       utm_source     = COALESCE(excluded.utm_source,   utm_source),
       utm_medium     = COALESCE(excluded.utm_medium,   utm_medium),
       utm_campaign   = COALESCE(excluded.utm_campaign, utm_campaign),
       updated_at     = excluded.updated_at`,
    [
      shopId, o.order_id, o.date, o.status,
      gross, tax, discount, shipping,
      isRefunded,
      o.utm_source, o.utm_medium, o.utm_campaign,
    ]
  );

  if (o.items.length) {
    await db.batch(
      o.items.map((item) =>
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
          item.product_name, item.category,
          item.quantity, plnToGrosze(item.line_total)
        )
      )
    );
  }

  if (o.refunds.length) {
    await db.batch(
      o.refunds.map((r) =>
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
          plnToGrosze(r.amount), o.date, r.date
        )
      )
    );
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
