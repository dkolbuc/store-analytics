import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export interface DailyPoint { date: string; value: number; }

interface Props {
  mainData: DailyPoint[];
  compareData: DailyPoint[];
  mainRange: { start: string; end: string };
  compareRange: { start: string; end: string };
}

function parseDateUTC(s: string): Date {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function generateDates(start: string, end: string): string[] {
  const out: string[] = [];
  let ms = parseDateUTC(start).getTime();
  const endMs = parseDateUTC(end).getTime();
  while (ms <= endMs) { out.push(new Date(ms).toISOString().slice(0, 10)); ms += 86_400_000; }
  return out;
}

function toSeries(data: DailyPoint[], dates: string[]): (number | null)[] {
  const m = new Map(data.map((d) => [d.date, d.value]));
  return dates.map((d) => m.get(d) ?? null);
}

function yFmt(_u: uPlot, vals: number[]): string[] {
  return vals.map((v) => {
    if (v == null) return "";
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
    return v.toFixed(0);
  });
}

function xFmt(_u: uPlot, vals: number[]): string[] {
  return vals.map((v) => {
    const d = new Date(v * 1000);
    return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
  });
}

export default function SalesChart({ mainData, compareData, mainRange, compareRange }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const uRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const mainDates = generateDates(mainRange.start, mainRange.end);
    const cmpDates  = generateDates(compareRange.start, compareRange.end);
    const xs        = mainDates.map((d) => parseDateUTC(d).getTime() / 1000);
    const mainVals  = toSeries(mainData, mainDates);
    const cmpVals   = mainDates.map((_, i) => {
      const cd = cmpDates[i];
      return cd ? (compareData.find((d) => d.date === cd)?.value ?? null) : null;
    });

    const width = ref.current.offsetWidth || 560;
    const opts: uPlot.Options = {
      width, height: 200,
      series: [
        {},
        { label: "Bieżący", stroke: "#4f46e5", width: 2 },
        { label: "Poprzedni", stroke: "#94a3b8", width: 1.5, dash: [4, 4] },
      ],
      axes: [{ values: xFmt }, { values: yFmt, size: 58 }],
      cursor: { drag: { x: false, y: false } },
      legend: { show: true },
    };

    uRef.current?.destroy();
    uRef.current = new uPlot(opts, [xs, mainVals, cmpVals] as uPlot.AlignedData, ref.current);

    const ro = new ResizeObserver(() => {
      if (ref.current) uRef.current?.setSize({ width: ref.current.offsetWidth, height: 200 });
    });
    ro.observe(ref.current);
    return () => { ro.disconnect(); uRef.current?.destroy(); uRef.current = null; };
  }, [JSON.stringify(mainData), JSON.stringify(compareData), mainRange.start, compareRange.start]);

  if (!mainData.length && !compareData.length)
    return <div className="chart-empty">Brak danych sprzedażowych.</div>;

  return <div ref={ref} className="chart-wrap" />;
}
