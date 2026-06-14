/**
 * Konwersja kwot pieniężnych.
 * Kwoty trzymane wewnętrznie jako INTEGER grosze; konwersja tylko na granicy zapisu i wyświetlania.
 */

/** Typ nominalny — zapobiega przypadkowemu przekazaniu PLN tam gdzie oczekiwane są grosze. */
export type Grosze = number & { readonly __brand: "grosze" };

/**
 * PLN (liczba lub string dziesiętny, np. "49.90") → grosze INTEGER.
 * Math.round eliminuje błędy zmiennoprzecinkowe przy 0.5 gr.
 */
export function plnToGrosze(value: number | string): Grosze {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return Math.round(n * 100) as Grosze;
}

/** Grosze → PLN (float, do dalszych obliczeń). */
export function groszeToPLN(grosze: number): number {
  return grosze / 100;
}

/** Grosze → "49,90 zł" (Intl.NumberFormat pl-PL). */
export function formatPLN(grosze: number): string {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
  }).format(grosze / 100);
}

/**
 * Grosze → skrócona forma dla kart KPI i osi wykresów.
 * < 1 000 zł  → "49,90 zł"
 * < 1 000 000 → "12,5 tys. zł"
 * ≥ 1 000 000 → "1,2 mln zł"
 */
export function formatPLNShort(grosze: number): string {
  const pln = grosze / 100;
  const fmt = (n: number, digits: number) =>
    new Intl.NumberFormat("pl-PL", {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(n);

  if (Math.abs(pln) >= 1_000_000) return `${fmt(pln / 1_000_000, 1)} mln zł`;
  if (Math.abs(pln) >= 1_000) return `${fmt(pln / 1_000, 1)} tys. zł`;
  return `${fmt(pln, 2)} zł`;
}

/**
 * Google Ads cost_micros → grosze.
 * 1 000 000 micros = 1 PLN = 100 groszy, więc micros / 10 000 = grosze.
 */
export function microsToGrosze(micros: number): Grosze {
  return Math.round(micros / 10_000) as Grosze;
}
