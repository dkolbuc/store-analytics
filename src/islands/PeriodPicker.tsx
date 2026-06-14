import { useState } from "react";

interface Props {
  type: string;
  anchor: string;
  compare: string;
  customFrom: string;
  customTo: string;
  compareFrom: string;
  compareTo: string;
}

export default function PeriodPicker({
  type: initType,
  anchor: initAnchor,
  compare: initCompare,
  customFrom: initCFrom,
  customTo: initCTo,
  compareFrom: initCmpFrom,
  compareTo: initCmpTo,
}: Props) {
  const [type, setType]           = useState(initType || "month");
  const [anchor, setAnchor]       = useState(initAnchor || "");
  const [compare, setCompare]     = useState(initCompare || "previous");
  const [cFrom, setCFrom]         = useState(initCFrom || "");
  const [cTo, setCTo]             = useState(initCTo || "");
  const [cmpFrom, setCmpFrom]     = useState(initCmpFrom || "");
  const [cmpTo, setCmpTo]         = useState(initCmpTo || "");

  // Dla kwartału rozłóż anchor "YYYY-Q1" na rok i numer kwartału
  const [qYear, setQYear] = useState(() => {
    if (initType === "quarter" && initAnchor) return initAnchor.split("-Q")[0] ?? "";
    return String(new Date().getFullYear());
  });
  const [qNum, setQNum] = useState(() => {
    if (initType === "quarter" && initAnchor) return initAnchor.split("-Q")[1] ?? "1";
    return String(Math.ceil((new Date().getMonth() + 1) / 3));
  });

  function go(overrides: Record<string, string | null>) {
    const p = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(overrides)) {
      if (v) p.set(k, v); else p.delete(k);
    }
    // Wyczyść nieaktualne pola
    if ((overrides.period ?? type) !== "custom") { p.delete("from"); p.delete("to"); }
    if ((overrides.compare ?? compare) !== "custom") { p.delete("compare_from"); p.delete("compare_to"); }
    window.location.href = `${window.location.pathname}?${p.toString()}`;
  }

  function onTypeChange(newType: string) {
    setType(newType);
    const now = new Date();
    let newAnchor = "";
    if (newType === "month") newAnchor = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    else if (newType === "quarter") newAnchor = `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;
    else if (newType === "year") newAnchor = String(now.getFullYear());
    setAnchor(newAnchor);
    go({ period: newType, anchor: newAnchor });
  }

  function onAnchorChange(val: string) {
    setAnchor(val);
    go({ period: type, anchor: val });
  }

  function onQuarterChange(year: string, q: string) {
    const a = `${year}-Q${q}`;
    setAnchor(a); setQYear(year); setQNum(q);
    go({ period: "quarter", anchor: a });
  }

  function onCompareChange(val: string) {
    setCompare(val);
    go({ compare: val });
  }

  function onCustomApply() {
    go({ period: "custom", anchor: null, from: cFrom, to: cTo,
         compare: compare, compare_from: compare === "custom" ? cmpFrom : null,
         compare_to: compare === "custom" ? cmpTo : null });
  }

  return (
    <div className="period-picker">
      {/* Typ okresu */}
      <div className="period-group">
        <label htmlFor="p-type">Okres</label>
        <select id="p-type" value={type} onChange={(e) => onTypeChange(e.target.value)}>
          <option value="month">Miesiąc</option>
          <option value="quarter">Kwartał</option>
          <option value="year">Rok</option>
          <option value="custom">Własny</option>
        </select>
      </div>

      {/* Kotwica */}
      {type === "month" && (
        <div className="period-group">
          <label htmlFor="p-month">Miesiąc</label>
          <input id="p-month" type="month" value={anchor}
            onChange={(e) => onAnchorChange(e.target.value)} />
        </div>
      )}
      {type === "quarter" && (
        <div className="period-group">
          <label>Kwartał</label>
          <input type="number" value={qYear} min={2000} max={2100} style={{width:"5rem"}}
            onBlur={(e) => onQuarterChange(e.target.value, qNum)}
            onChange={(e) => setQYear(e.target.value)} />
          <select value={qNum} onChange={(e) => onQuarterChange(qYear, e.target.value)}>
            <option value="1">Q1</option>
            <option value="2">Q2</option>
            <option value="3">Q3</option>
            <option value="4">Q4</option>
          </select>
        </div>
      )}
      {type === "year" && (
        <div className="period-group">
          <label htmlFor="p-year">Rok</label>
          <input id="p-year" type="number" value={anchor || String(new Date().getFullYear())}
            min={2000} max={2100}
            onBlur={(e) => onAnchorChange(e.target.value)}
            onChange={(e) => setAnchor(e.target.value)} />
        </div>
      )}
      {type === "custom" && (
        <div className="period-group">
          <label>Od</label>
          <input type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} />
          <label>Do</label>
          <input type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} />
        </div>
      )}

      {/* Tryb porównania */}
      <div className="period-group">
        <label htmlFor="p-compare">Porównaj z</label>
        <select id="p-compare" value={compare} onChange={(e) => onCompareChange(e.target.value)}>
          <option value="previous">Poprzednim okresem</option>
          <option value="year">Tym samym rok wcześniej</option>
          <option value="custom">Własny zakres</option>
        </select>
      </div>

      {compare === "custom" && (
        <div className="period-group">
          <label>Od</label>
          <input type="date" value={cmpFrom} onChange={(e) => setCmpFrom(e.target.value)} />
          <label>Do</label>
          <input type="date" value={cmpTo} onChange={(e) => setCmpTo(e.target.value)} />
        </div>
      )}

      {/* Zastosuj (dla trybów custom) */}
      {(type === "custom" || compare === "custom") && (
        <button
          onClick={onCustomApply}
          style={{padding:".3rem .8rem",fontSize:".82rem",borderRadius:"6px",
                  border:"1px solid var(--accent)",background:"var(--accent)",
                  color:"#fff",cursor:"pointer"}}>
          Zastosuj
        </button>
      )}
    </div>
  );
}
