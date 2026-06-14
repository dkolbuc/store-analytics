/**
 * Wyspa React: wykres danych Google Ads (uPlot).
 * TODO: Pobierz dane przez fetch /api/chart/ads?shop_id=...&from=...&to=...
 * TODO: Narysuj dwie serie: bieżący okres (linia) i okres porównawczy (linia przerywana)
 * TODO: Dodaj przełącznik metryki: koszt / kliknięcia / ROAS / konwersje
 */

import { useEffect, useRef } from "react";

interface DataPoint {
  date: string; // YYYY-MM-DD
  cost: number;
  clicks: number;
  roas: number | null;
  conversions: number;
}

interface Props {
  currentData?: DataPoint[];
  compareData?: DataPoint[];
  metric?: "cost" | "clicks" | "roas" | "conversions";
}

export default function AdsChart({
  currentData = [],
  compareData = [],
  metric = "cost",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // TODO: Przechowaj instancję uPlot w useRef i zniszcz ją przy odmontowaniu

  useEffect(() => {
    if (!containerRef.current || currentData.length === 0) return;

    // TODO: Zaimplementuj inicjalizację uPlot
    //       1. Przekształć currentData i compareData na format uPlot
    //          (tablice timestamp[], values[])
    //       2. Zdefiniuj opcje uPlot (axes, series, scales)
    //       3. new uPlot(opts, data, containerRef.current)
    //       4. Zwróć () => uplot.destroy() z cleanup

    return () => {
      // TODO: uplotRef.current?.destroy()
    };
  }, [currentData, compareData, metric]);

  return (
    <div className="ads-chart">
      <h3 className="ads-chart__title">Google Ads — {metric}</h3>
      <div ref={containerRef} className="ads-chart__canvas">
        {currentData.length === 0 && (
          <p className="ads-chart__empty">Brak danych dla wybranego okresu.</p>
        )}
      </div>
    </div>
  );
}
