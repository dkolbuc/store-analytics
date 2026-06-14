/**
 * Semantyka delt — kierunek wzrostu dobry/zły/neutralny per metryka.
 * Używaj do kolorowania delt w UI zamiast hardkodować kolory per komponent.
 */

type Direction = "higher-is-better" | "lower-is-better" | "neutral";

const SEMANTICS: Record<string, Direction> = {
  revenue:          "higher-is-better",
  orders:           "higher-is-better",
  aov:              "higher-is-better",
  roas:             "higher-is-better",
  conversions:      "higher-is-better",
  sessions:         "higher-is-better",
  engaged_sessions: "higher-is-better",
  engagement_rate:  "higher-is-better",
  key_events:       "higher-is-better",
  impression_share: "higher-is-better",
  ctr:              "higher-is-better",
  cr:               "higher-is-better",
  refunds:          "lower-is-better",
  cpc:              "lower-is-better",
  budget_lost:      "lower-is-better",
  rank_lost:        "lower-is-better",
  cost:             "neutral",
};

/** CSS klasa dla delty: 'delta--positive' | 'delta--negative' | 'delta--neutral' */
export function deltaClass(metricKey: string, change: number | null): string {
  if (change === null || change === 0) return "delta--neutral";
  const dir = SEMANTICS[metricKey] ?? "neutral";
  if (dir === "neutral") return "delta--neutral";
  const good = dir === "higher-is-better" ? change > 0 : change < 0;
  return good ? "delta--positive" : "delta--negative";
}

/** Strzałka kierunkowa (↑ / ↓ / →). */
export function deltaArrow(change: number | null): string {
  if (change === null) return "";
  if (change > 0) return "↑";
  if (change < 0) return "↓";
  return "→";
}

/** Formatuje deltę do wyświetlenia: "+12,3%" lub "−5,1%" (znak minus Unicode). */
export function fmtDelta(change: number | null): string {
  if (change === null) return "—";
  const sign = change >= 0 ? "+" : "−"; // − Unicode minus
  const abs  = Math.abs(change).toFixed(1).replace(".", ",");
  return `${sign}${abs}%`;
}
