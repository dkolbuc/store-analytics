/**
 * Matematyka okresów dla dashboardu analitycznego.
 * Daty jako stringi 'YYYY-MM-DD'. Granice liczone w strefie Europe/Warsaw.
 *
 * Parametry URL:
 *   period  = month | quarter | year | custom
 *   anchor  = current | last | YYYY-MM (month) | YYYY-Q1..Q4 (quarter) | YYYY (year)
 *             'current' = bieżący okres (period-to-date)
 *             'last'    = ostatni zakończony pełny okres
 *   compare = previous | year | custom
 *   from, to             — tylko gdy period=custom
 *   compare_from, compare_to — tylko gdy compare=custom
 */

export type PeriodType = "month" | "quarter" | "year" | "custom";
export type CompareMode = "previous" | "year" | "custom";

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

export interface PeriodParams {
  type: PeriodType;
  /** 'YYYY-MM' | 'YYYY-Q1' | 'YYYY' | '' dla custom */
  anchor: string;
  compare: CompareMode;
  customMain?: DateRange;
  customCompare?: DateRange;
}

export interface ResolvedPeriods {
  main: DateRange;
  compare: DateRange;
}

// ---------------------------------------------------------------------------
// Narzędzia daty (operacje na stringach YYYY-MM-DD, bez strefy — UTC midnight)
// ---------------------------------------------------------------------------

/** Parsuje YYYY-MM-DD → Date (UTC midnight). */
function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

/** Formatuje Date (UTC) → YYYY-MM-DD. */
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Dodaje dni do daty (string → string). */
function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fmtDate(d);
}

/** Liczba dni między dwiema datami (inclusive obu końców). */
function spanDays(start: string, end: string): number {
  return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / 86_400_000) + 1;
}

/** Ostatni dzień miesiąca (1-indexed). */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Przesuwa datę o podaną liczbę lat (z clampem na Feb 29 → Feb 28). */
function addYears(date: string, years: number): string {
  const [yStr, mStr, dStr] = date.split("-");
  const newYear = Number(yStr) + years;
  const month   = Number(mStr);
  const day     = Math.min(Number(dStr), lastDayOfMonth(newYear, month));
  return `${newYear}-${mStr}-${String(day).padStart(2, "0")}`;
}

/** Sprawdza czy string ma format YYYY-MM-DD i jest poprawną datą. */
function isValidDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseDate(s);
  return !isNaN(d.getTime());
}

/** Przesuwa rok+miesiąc o deltaMiesiące. Zwraca [rok, miesiąc]. */
function shiftMonths(year: number, month: number, delta: number): [number, number] {
  const total = year * 12 + (month - 1) + delta;
  return [Math.floor(total / 12), (total % 12) + 1];
}

/** Numer kwartału (1–4) na podstawie miesiąca (1–12). */
function monthToQuarter(month: number): number {
  return Math.ceil(month / 3);
}

/** Pierwszy miesiąc kwartału. */
function quarterStartMonth(q: number): number {
  return (q - 1) * 3 + 1;
}

// ---------------------------------------------------------------------------
// Dzisiaj w strefie Europe/Warsaw
// ---------------------------------------------------------------------------

/**
 * Zwraca dzisiejszą datę w strefie Europe/Warsaw jako 'YYYY-MM-DD'.
 * en-CA locale daje format ISO bez konwersji.
 */
export function todayWarsaw(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// ---------------------------------------------------------------------------
// Granice pełnych okresów
// ---------------------------------------------------------------------------

function monthRange(year: number, month: number): DateRange {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDayOfMonth(year, month)).padStart(2, "0")}`;
  return { start, end };
}

function quarterRange(year: number, q: number): DateRange {
  const startM = quarterStartMonth(q);
  const endM = startM + 2;
  const start = `${year}-${String(startM).padStart(2, "0")}-01`;
  const end = `${year}-${String(endM).padStart(2, "0")}-${String(lastDayOfMonth(year, endM)).padStart(2, "0")}`;
  return { start, end };
}

function yearRange(year: number): DateRange {
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

// ---------------------------------------------------------------------------
// Parsowanie parametrów URL
// ---------------------------------------------------------------------------

/**
 * Parsuje URLSearchParams → PeriodParams.
 * Wartości domyślne: poprzedni pełny miesiąc, porównanie z previous.
 */
export function parsePeriodParams(sp: URLSearchParams): PeriodParams {
  const type = (sp.get("period") ?? "month") as PeriodType;
  const compare = (sp.get("compare") ?? "previous") as CompareMode;

  if (type === "custom") {
    const from   = sp.get("from");
    const to     = sp.get("to");
    const cmpFrom = sp.get("compare_from");
    const cmpTo   = sp.get("compare_to");

    // Akceptuj daty tylko gdy obie są poprawne i start <= end
    const validMain    = isValidDate(from) && isValidDate(to) && from <= to;
    const validCompare = isValidDate(cmpFrom) && isValidDate(cmpTo) && cmpFrom <= cmpTo;

    return {
      type: "custom",
      anchor: "",
      compare,
      customMain:    validMain    ? { start: from,    end: to    } : undefined,
      customCompare: validCompare ? { start: cmpFrom, end: cmpTo } : undefined,
    };
  }

  // Dla month/quarter/year użyj podanej kotwicy lub domyślnie 'current' (bieżący okres)
  const anchor = sp.get("anchor") ?? "current";

  return { type, anchor, compare };
}

// ---------------------------------------------------------------------------
// Rozwiązywanie zakresów dat
// ---------------------------------------------------------------------------

/**
 * Zwraca zakresy główny i porównawczy.
 *
 * Period-to-date: gdy okres główny obejmuje 'today' (jeszcze trwa),
 * oba zakresy są przycięte do tej samej liczby elapsed dni od początku okresu.
 * Przykład: anchor='2025-06', today='2025-06-14'
 *   main:    2025-06-01 – 2025-06-14 (14 dni)
 *   compare (previous): 2025-05-01 – 2025-05-14 (te same 14 dni)
 */
export function resolvePeriods(
  params: PeriodParams,
  today: string = todayWarsaw()
): ResolvedPeriods {
  if (params.type === "custom") {
    // Brak / niepoprawne daty głównego okresu → bezpieczny fallback (bieżący miesiąc PTD)
    if (!params.customMain) {
      const [tYr, tMo] = today.split("-").map(Number) as [number, number];
      const mainFb: DateRange = {
        start: `${tYr}-${String(tMo).padStart(2, "0")}-01`,
        end:   today,
      };
      const elapsed = spanDays(mainFb.start, today) - 1;
      const [py, pm] = shiftMonths(tYr, tMo, -1);
      const cmpStart = `${py}-${String(pm).padStart(2, "0")}-01`;
      return { main: mainFb, compare: { start: cmpStart, end: addDays(cmpStart, elapsed) } };
    }

    const main = params.customMain;
    // offset = liczba dni w głównym okresie minus 1 (do obliczenia granic porównania)
    const len = spanDays(main.start, main.end) - 1;

    let compare: DateRange;
    if (params.compare === "custom" && params.customCompare) {
      // Użytkownik podał własny zakres porównawczy
      compare = params.customCompare;
    } else if (params.compare === "custom") {
      // Własny tryb, ale brak dat porównania → poprzedni okres tej samej długości
      const cmpEnd   = addDays(main.start, -1);
      compare = { start: addDays(cmpEnd, -len), end: cmpEnd };
    } else if (params.compare === "year") {
      // Ten sam zakres rok wcześniej
      compare = { start: addYears(main.start, -1), end: addYears(main.end, -1) };
    } else {
      // "previous" — poprzedni okres tej samej długości, kończący się dzień przed main
      const cmpEnd   = addDays(main.start, -1);
      compare = { start: addDays(cmpEnd, -len), end: cmpEnd };
    }

    return { main, compare };
  }

  // Rozwiąż 'current' / 'last' na konkretną kotwicę datową
  const [tYear, tMonth] = today.split("-").map(Number) as [number, number];
  let anchor = params.anchor;
  if (anchor === "current" || anchor === "last") {
    const isCurrent = anchor === "current";
    if (params.type === "month") {
      if (isCurrent) {
        anchor = `${tYear}-${String(tMonth).padStart(2, "0")}`;
      } else {
        const [py, pm] = shiftMonths(tYear, tMonth, -1);
        anchor = `${py}-${String(pm).padStart(2, "0")}`;
      }
    } else if (params.type === "quarter") {
      const cQ = monthToQuarter(tMonth);
      if (isCurrent) {
        anchor = `${tYear}-Q${cQ}`;
      } else {
        const pQ = cQ === 1 ? 4 : cQ - 1;
        anchor = `${cQ === 1 ? tYear - 1 : tYear}-Q${pQ}`;
      }
    } else {
      // year
      anchor = isCurrent ? String(tYear) : String(tYear - 1);
    }
  }

  // --- Wyznacz pełny zakres główny ---
  let fullMain: DateRange;
  let prevPeriod: DateRange;
  let yearAgoPeriod: DateRange;

  if (params.type === "month") {
    const [y, m] = anchor.split("-").map(Number) as [number, number];
    fullMain = monthRange(y, m);
    const [py, pm] = shiftMonths(y, m, -1);
    prevPeriod = monthRange(py, pm);
    yearAgoPeriod = monthRange(y - 1, m);
  } else if (params.type === "quarter") {
    // anchor: 'YYYY-Q1' .. 'YYYY-Q4'
    const [yearStr, qStr] = anchor.split("-Q");
    const y = Number(yearStr);
    const q = Number(qStr);
    fullMain = quarterRange(y, q);
    const prevQ = q === 1 ? 4 : q - 1;
    const prevQYear = q === 1 ? y - 1 : y;
    prevPeriod = quarterRange(prevQYear, prevQ);
    yearAgoPeriod = quarterRange(y - 1, q);
  } else {
    // year
    const y = Number(anchor);
    fullMain = yearRange(y);
    prevPeriod = yearRange(y - 1);
    yearAgoPeriod = yearRange(y - 2);
  }

  // --- Period-to-date: przytnij gdy okres w toku ---
  let main: DateRange;
  let compareBase: DateRange;

  if (params.compare === "previous") {
    compareBase = prevPeriod;
  } else if (params.compare === "year") {
    compareBase = yearAgoPeriod;
  } else {
    // custom
    compareBase = params.customCompare ?? prevPeriod;
  }

  const inProgress = today >= fullMain.start && today <= fullMain.end;

  if (inProgress) {
    // Obetnij main do today
    main = { start: fullMain.start, end: today };
    // Elapsed days (włącznie z dniem startowym)
    const elapsed = spanDays(fullMain.start, today) - 1; // liczba dni OPRÓCZ pierwszego
    // Compare — ten sam offset od początku okresu porównawczego
    const compareEnd = addDays(compareBase.start, elapsed);
    // Nie wychodź poza koniec okresu porównawczego
    const clampedEnd = compareEnd <= compareBase.end ? compareEnd : compareBase.end;
    compareBase = { start: compareBase.start, end: clampedEnd };
  } else {
    main = fullMain;
  }

  return { main, compare: compareBase };
}

// ---------------------------------------------------------------------------
// Formatowanie etykiet (po polsku)
// ---------------------------------------------------------------------------

const MONTHS_PL = [
  "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
  "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień",
];
const MONTHS_PL_GEN = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];

/**
 * Ludzki opis zakresu po polsku.
 * Przykłady: "maj 2025", "Q2 2025", "1–14 czerwca 2025", "2025"
 */
export function formatPeriodLabel(range: DateRange, type: PeriodType): string {
  const [startY, startM, startD] = range.start.split("-").map(Number) as [number, number, number];
  const [, endM, endD] = range.end.split("-").map(Number) as [number, number, number];

  if (type === "month") {
    const label = `${MONTHS_PL[startM - 1]} ${startY}`;
    // Jeśli period-to-date, dodaj zakres dni
    const fullEnd = lastDayOfMonth(startY, startM);
    if (endD < fullEnd) return `${startD}–${endD} ${MONTHS_PL_GEN[startM - 1]} ${startY}`;
    return label;
  }
  if (type === "quarter") {
    const q = monthToQuarter(startM);
    const fullEnd = lastDayOfMonth(startY, quarterStartMonth(q) + 2);
    if (endD < fullEnd || endM < startM + 2) {
      return `Q${q} ${startY} (PTD)`;
    }
    return `Q${q} ${startY}`;
  }
  if (type === "year") {
    if (range.end !== `${startY}-12-31`) return `${startY} (PTD)`;
    return String(startY);
  }
  // custom
  if (startM === endM && startY === Number(range.end.split("-")[0])) {
    return `${startD}–${endD} ${MONTHS_PL_GEN[startM - 1]} ${startY}`;
  }
  return `${range.start} – ${range.end}`;
}

// ---------------------------------------------------------------------------
// Zmiana procentowa
// ---------------------------------------------------------------------------

/**
 * Zmiana % = (current - previous) / |previous| * 100.
 * Zwraca null gdy previous = 0 (brak podstawy porównania).
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
