/**
 * Kalkulacje ROAS i pochodnych metryk reklamowych.
 * Wszystkie kwoty w groszach (spójne jednostki → dzielenie bezpośrednie).
 */

/** ROAS = wartość_konwersji / koszt. Null gdy brak wydatków. */
export function calcROAS(
  conversionsValueGrosze: number,
  costGrosze: number
): number | null {
  if (costGrosze === 0) return null;
  return conversionsValueGrosze / costGrosze;
}

/** CPC = koszt / kliknięcia (w groszach). Null gdy brak kliknięć. */
export function calcCPC(costGrosze: number, clicks: number): number | null {
  if (clicks === 0) return null;
  return costGrosze / clicks;
}

/** CTR = kliknięcia / wyświetlenia * 100 (procent). Null gdy brak wyświetleń. */
export function calcCTR(clicks: number, impressions: number): number | null {
  if (impressions === 0) return null;
  return (clicks / impressions) * 100;
}

/** CR = konwersje / kliknięcia * 100 (procent). Null gdy brak kliknięć. */
export function calcCR(conversions: number, clicks: number): number | null {
  if (clicks === 0) return null;
  return (conversions / clicks) * 100;
}

/**
 * Formatuje ROAS do wyświetlenia.
 * Przykład: 4.2 → "4,20x", null → "—"
 */
export function formatROAS(roas: number | null): string {
  if (roas === null) return "—";
  return (
    new Intl.NumberFormat("pl-PL", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(roas) + "x"
  );
}
