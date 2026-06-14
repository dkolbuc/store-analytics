/**
 * Wyspa React: selektor sklepu.
 * Stan (wybrany shop_id) zapisywany w URL query string.
 * TODO: Pobierz listę sklepów przez props (serwer) lub fetch /api/shops (klient)
 */

import { useState, useEffect } from "react";

interface Shop {
  id: number;
  name: string;
}

interface Props {
  shops?: Shop[];
  /** Aktualnie wybrany shop_id (z URL) */
  currentShopId?: number;
}

export default function ShopSelector({ shops = [], currentShopId }: Props) {
  // TODO: Synchronizuj z URLSearchParams (window.location.search)
  const [selectedId, setSelectedId] = useState<number | undefined>(currentShopId);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newId = Number(e.target.value);
    setSelectedId(newId);
    // TODO: Zaktualizuj URL (history.pushState lub URLSearchParams)
    //       Zachowaj pozostałe parametry (period, anchor, compare)
  }

  return (
    <div className="shop-selector">
      <label htmlFor="shop-select">Sklep</label>
      <select
        id="shop-select"
        value={selectedId ?? ""}
        onChange={handleChange}
      >
        <option value="">Wszystkie sklepy</option>
        {shops.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}
