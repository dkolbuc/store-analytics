/**
 * Wyspa React: wybór okresu i trybu porównania.
 * Stan trzymany w URL:
 *   ?period=MoM|QoQ|YoY|custom
 *   &anchor=YYYY-MM (dla MoM) | YYYY-Q (dla QoQ) | YYYY (dla YoY)
 *   &compare=previous_period|previous_year|custom
 *   &from=YYYY-MM-DD&to=YYYY-MM-DD          (tylko gdy period=custom)
 *   &compare_from=YYYY-MM-DD&compare_to=YYYY-MM-DD (tylko gdy compare=custom)
 */

import { useState } from "react";

type PeriodType = "MoM" | "QoQ" | "YoY" | "custom";
type CompareMode = "previous_period" | "previous_year" | "custom";

interface Props {
  initialPeriod?: PeriodType;
  initialAnchor?: string;
  initialCompare?: CompareMode;
}

export default function PeriodPicker({
  initialPeriod = "MoM",
  initialAnchor,
  initialCompare = "previous_period",
}: Props) {
  const [period, setPeriod] = useState<PeriodType>(initialPeriod);
  const [compare, setCompare] = useState<CompareMode>(initialCompare);

  // TODO: Synchronizuj zmiany z URL (zachowaj shop_id)
  // TODO: Dodaj pola dat dla period=custom i compare=custom
  // TODO: Dodaj selektor kotwicy (miesiąc/kwartał/rok) zależny od period

  function handlePeriodChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setPeriod(e.target.value as PeriodType);
    // TODO: Aktualizuj URL
  }

  function handleCompareChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setCompare(e.target.value as CompareMode);
    // TODO: Aktualizuj URL
  }

  return (
    <div className="period-picker">
      <div className="period-picker__row">
        <label htmlFor="period-select">Okres</label>
        <select id="period-select" value={period} onChange={handlePeriodChange}>
          <option value="MoM">Miesiąc do miesiąca (MoM)</option>
          <option value="QoQ">Kwartał do kwartału (QoQ)</option>
          <option value="YoY">Rok do roku (YoY)</option>
          <option value="custom">Własny zakres</option>
        </select>
      </div>

      <div className="period-picker__row">
        <label htmlFor="compare-select">Porównaj z</label>
        <select id="compare-select" value={compare} onChange={handleCompareChange}>
          <option value="previous_period">Poprzedni okres</option>
          <option value="previous_year">Ten sam okres rok wcześniej</option>
          <option value="custom">Własny zakres porównania</option>
        </select>
      </div>

      {/* TODO: Warunkowo renderuj DateRangePicker dla custom */}
    </div>
  );
}
