function finiteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatPriceBasis(unit) {
  const labels = {
    fl_oz: 'fl oz',
    ea: 'item',
    ct: 'item',
    count: 'item',
  };
  return labels[unit] || unit || 'item';
}

export function formatItemTrendPrice(row = {}) {
  const price = finiteNumber(row.latest_price);
  if (price == null) return '-';
  const formatted = `$${price.toFixed(2)}`;
  return row.price_kind === 'unit'
    ? `${formatted} / ${formatPriceBasis(row.price_basis_unit)}`
    : formatted;
}

export function getItemTrendChange(row = {}) {
  const percent = finiteNumber(row.price_change_percent);
  if (percent == null) return { label: 'No prior comparison', direction: 'neutral' };
  if (Math.abs(percent) < 2) return { label: 'About the same', direction: 'neutral' };
  return {
    label: `${Math.abs(percent).toFixed(0)}% ${percent > 0 ? 'higher' : 'lower'}`,
    direction: percent > 0 ? 'up' : 'down',
  };
}

export function filterItemTrendRows(rows = [], { query = '', filter = 'all' } = {}) {
  const normalizedQuery = `${query || ''}`.trim().toLowerCase();
  return rows.filter((row) => {
    const matchesQuery = !normalizedQuery || [row.item_name, row.brand, row.latest_merchant]
      .some((value) => `${value || ''}`.toLowerCase().includes(normalizedQuery));
    if (!matchesQuery) return false;
    if (filter === 'changed') return Math.abs(Number(row.price_change_percent || 0)) >= 2;
    if (filter === 'stores') return Number(row.merchant_count || 0) > 1;
    return true;
  });
}

export function getItemPriceTrendVisual(history = {}) {
  const purchases = Array.isArray(history.purchases) ? history.purchases : [];
  const basisUnit = history.price_basis_unit || null;
  let observations = basisUnit
    ? purchases
      .filter((purchase) => (
        purchase.normalized_total_size_unit === basisUnit
        && finiteNumber(purchase.estimated_unit_price) != null
      ))
      .map((purchase) => ({ value: finiteNumber(purchase.estimated_unit_price), date: purchase.date }))
    : [];
  let priceKind = 'unit';

  if (observations.length < 2) {
    observations = purchases
      .map((purchase) => ({ value: finiteNumber(purchase.item_amount ?? purchase.amount), date: purchase.date }))
      .filter((entry) => entry.value != null);
    priceKind = 'item';
  }
  observations = observations.slice(-8);
  if (observations.length < 2) return null;

  const values = observations.map((entry) => entry.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min;
  const points = values.map((value) => (spread > 0 ? (value - min) / spread : 0.5));
  const latest = values[values.length - 1];
  const priorValues = values.slice(0, -1).sort((a, b) => a - b);
  const midpoint = Math.floor(priorValues.length / 2);
  const priorMedian = priorValues.length % 2
    ? priorValues[midpoint]
    : (priorValues[midpoint - 1] + priorValues[midpoint]) / 2;
  const deltaPercent = priorMedian > 0 ? ((latest - priorMedian) / priorMedian) * 100 : 0;
  const suffix = priceKind === 'unit' ? ` / ${formatPriceBasis(basisUnit)}` : '';
  const typical = priceKind === 'unit'
    ? finiteNumber(history.median_unit_price)
    : finiteNumber(history.median_amount);

  return {
    variant: 'spark',
    label: `Last ${observations.length} comparable prices`,
    value: `$${latest.toFixed(2)}${suffix}`,
    points,
    tone: deltaPercent >= 5 ? 'warning' : (deltaPercent <= -5 ? 'info' : 'neutral'),
    projection: typical == null ? null : {
      label: 'Typical',
      value: `$${typical.toFixed(2)}${suffix}`,
    },
  };
}
