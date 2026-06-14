interface Shop { shop_id: string; name: string; }

interface Props {
  shops: Shop[];
  current: string;
}

export default function ShopSelector({ shops, current }: Props) {
  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(window.location.search);
    params.set("shop", e.target.value);
    window.location.href = `${window.location.pathname}?${params.toString()}`;
  }

  return (
    <div className="shop-selector">
      <label htmlFor="shop-sel">Sklep</label>
      <select id="shop-sel" value={current} onChange={handleChange}>
        {shops.map((s) => (
          <option key={s.shop_id} value={s.shop_id}>{s.name}</option>
        ))}
      </select>
    </div>
  );
}
