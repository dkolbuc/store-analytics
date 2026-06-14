/**
 * Podsumowania AI przez Gemini API.
 * Cache w tabeli ai_summaries (D1) — invalidowany przez data_version sklepu.
 * Generowanie on-demand, brak crona.
 */

import { dbFirst, dbRun, type DB } from "./db.ts";
import { formatPLN } from "./money.ts";
import { formatROAS } from "./roas.ts";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_OUTPUT_TOKENS = 2_048;

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export interface SummaryMetrics {
  // Bieżący okres — kwoty w groszach
  revenue: number;
  orders: number;
  refundAmount: number;
  adsCost: number;
  adsConversionsValue: number;
  sessions: number;
  // Poprzedni (porównawczy) okres — kwoty w groszach
  prevRevenue: number;
  prevOrders: number;
  prevRefundAmount: number;
  prevAdsCost: number;
  prevAdsConversionsValue: number;
  prevSessions: number;
}

export interface SummaryInput {
  shopId: string;
  shopName: string;
  mainRange: { start: string; end: string };
  compareRange: { start: string; end: string };
  dataVersion: number;
  metrics: SummaryMetrics;
}

interface AiSummaryRow {
  cache_key: string;
  shop_id: string;
  content: string;
  data_version: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Cache key
// ---------------------------------------------------------------------------

/**
 * SHA-256 hex z połączenia shop_id + zakresy + data_version.
 * Zmiana data_version → nowy klucz → automatyczny cache miss.
 */
export async function makeCacheKey(input: SummaryInput): Promise<string> {
  const raw = [
    input.shopId,
    input.mainRange.start,
    input.mainRange.end,
    input.compareRange.start,
    input.compareRange.end,
    input.dataVersion,
  ].join("|");
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** Zwraca treść podsumowania z cache lub null gdy brak / stale. */
export async function getCachedSummary(
  db: DB,
  cacheKey: string
): Promise<string | null> {
  const row = await dbFirst<AiSummaryRow>(
    db,
    "SELECT content FROM ai_summaries WHERE cache_key = ?",
    [cacheKey]
  );
  return row?.content ?? null;
}

// ---------------------------------------------------------------------------
// Generowanie
// ---------------------------------------------------------------------------

/** Buduje prompt po polsku z metrykami w czytelnym formacie PLN. */
function buildPrompt(input: SummaryInput): string {
  const { metrics: m, mainRange, compareRange, shopName } = input;

  const mainRoas = m.adsCost > 0 ? m.adsConversionsValue / m.adsCost : null;
  const prevRoas = m.prevAdsCost > 0 ? m.prevAdsConversionsValue / m.prevAdsCost : null;

  // Zmiana procentowa — pomocnik do promptu
  const chg = (cur: number, prev: number): string => {
    if (prev === 0) return cur > 0 ? "wzrost z zera" : "bez zmian";
    const p = ((cur - prev) / Math.abs(prev) * 100).toFixed(1).replace(".", ",");
    return cur >= prev ? `+${p}%` : `${p}%`;
  };

  return `Jesteś analitykiem e-commerce. Napisz DOKŁADNIE 3 krótkie akapity po polsku (łącznie 5–8 zdań) podsumowujące wyniki sklepu "${shopName}". Każdy akapit kończ pełnym zdaniem — nigdy nie urywaj myśli.

Akapit 1 – Sprzedaż: opisz przychód, zamówienia i zwroty; porównaj z poprzednim okresem, podaj zmiany procentowe.
Akapit 2 – Reklama Google Ads: opisz koszt, ROAS, wartość konwersji; oceń efektywność kampanii.
Akapit 3 – Ruch i wniosek: skomentuj liczbę sesji, wymień jeden konkretny priorytet działania na następny okres.

Pisz zwięźle, używaj liczb z danych, nie zaczynaj zdań od „Ogólnie" ani „Podsumowując".

DANE — sklep: ${shopName}
Bieżący okres: ${mainRange.start} – ${mainRange.end}
Okres porównawczy: ${compareRange.start} – ${compareRange.end}

SPRZEDAŻ:
  Przychód netto:  ${formatPLN(m.revenue)} (poprz. ${formatPLN(m.prevRevenue)}, zmiana: ${chg(m.revenue, m.prevRevenue)})
  Zamówienia:      ${m.orders} (poprz. ${m.prevOrders}, zmiana: ${chg(m.orders, m.prevOrders)})
  Zwroty:          ${formatPLN(m.refundAmount)} (poprz. ${formatPLN(m.prevRefundAmount)})

REKLAMA GOOGLE ADS:
  Koszt:           ${formatPLN(m.adsCost)} (poprz. ${formatPLN(m.prevAdsCost)}, zmiana: ${chg(m.adsCost, m.prevAdsCost)})
  Wart. konwersji: ${formatPLN(m.adsConversionsValue)} (poprz. ${formatPLN(m.prevAdsConversionsValue)})
  ROAS:            ${formatROAS(mainRoas)} (poprz. ${formatROAS(prevRoas)})

RUCH GA4:
  Sesje:           ${m.sessions} (poprz. ${m.prevSessions}, zmiana: ${chg(m.sessions, m.prevSessions)})

Podsumowanie (3 akapity, zakończone pełnym zdaniem):`;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
}

/** Wywołuje Gemini API i zwraca wygenerowany tekst. */
export async function generateSummary(
  input: SummaryInput,
  apiKey: string
): Promise<string> {
  const prompt = buildPrompt(input);

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.4,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as GeminiResponse;

  if (data.error?.message) {
    throw new Error(`Gemini błąd: ${data.error.message}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini zwróciło pustą odpowiedź");

  return text.trim();
}

// ---------------------------------------------------------------------------
// Główny punkt wejścia
// ---------------------------------------------------------------------------

/**
 * Zwraca podsumowanie z cache lub generuje i zapisuje do ai_summaries.
 * Wywołaj z endpointu strony; nie wymaga harmonogramu.
 */
export async function getOrGenerateSummary(
  db: DB,
  input: SummaryInput,
  apiKey: string
): Promise<string> {
  const cacheKey = await makeCacheKey(input);

  const cached = await getCachedSummary(db, cacheKey);
  if (cached) return cached;

  const content = await generateSummary(input, apiKey);

  await dbRun(
    db,
    `INSERT INTO ai_summaries (cache_key, shop_id, content, data_version)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (cache_key) DO UPDATE SET
       content = excluded.content,
       data_version = excluded.data_version,
       created_at = datetime('now')`,
    [cacheKey, input.shopId, content, input.dataVersion]
  );

  return content;
}
