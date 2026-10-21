function finiteNumber(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatNumber(value) {
  const numeric = finiteNumber(value);
  if (numeric == null) return null;
  return Number.isInteger(numeric) ? `${numeric}` : numeric.toFixed(2).replace(/\.?0+$/, '');
}

export function formatMatchMoney(value) {
  const numeric = finiteNumber(value);
  return numeric == null ? null : `$${numeric.toFixed(2)}`;
}

export function formatMatchDate(value) {
  if (!value) return null;
  const date = new Date(`${`${value}`.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatMatchSize(purchase = {}) {
  if (purchase.product_size) return `${purchase.product_size}`;
  if (purchase.pack_size) return `${purchase.pack_size}`;
  const value = formatNumber(purchase.normalized_total_size_value);
  if (value && purchase.normalized_total_size_unit) {
    const unit = `${purchase.normalized_total_size_unit}`.replace(/_/g, ' ');
    return `${value} ${unit}`;
  }
  const quantity = finiteNumber(purchase.quantity);
  if (quantity != null && quantity > 1) {
    return `${formatNumber(quantity)}${purchase.unit ? ` ${purchase.unit}` : ' count'}`;
  }
  return null;
}

export function formatMatchSource(value) {
  const labels = {
    camera: 'Receipt photo',
    email: 'Email receipt',
    manual: 'Manual entry',
    nl: 'Quick entry',
    refund: 'Refund',
  };
  return labels[`${value || ''}`] || null;
}

export function getCandidateSide(candidate = {}, side = 'left') {
  const evidence = candidate?.evidence && typeof candidate.evidence === 'object'
    ? candidate.evidence
    : {};
  const purchases = Array.isArray(evidence[`${side}_purchases`])
    ? evidence[`${side}_purchases`].filter(Boolean).slice(0, 2)
    : [];
  return {
    label: candidate[`${side}_label`] || 'Unlabeled item',
    count: Math.max(0, Number(evidence[`${side}_occurrence_count`] || 0)),
    merchants: Array.isArray(evidence[`${side}_merchants`])
      ? evidence[`${side}_merchants`].filter(Boolean)
      : [],
    firstPurchasedAt: evidence[`${side}_first_purchased_at`] || null,
    lastPurchasedAt: evidence[`${side}_last_purchased_at`] || null,
    purchases,
  };
}

export function getCandidateSummary(candidate = {}) {
  const left = getCandidateSide(candidate, 'left');
  const right = getCandidateSide(candidate, 'right');
  const purchaseCount = left.count + right.count;
  const merchantCount = new Set([...left.merchants, ...right.merchants]
    .map((merchant) => `${merchant}`.trim().toLowerCase())
    .filter(Boolean)).size;
  return {
    purchaseCount,
    eyebrow: [
      purchaseCount ? `${purchaseCount} purchase${purchaseCount === 1 ? '' : 's'}` : null,
      merchantCount ? `${merchantCount} merchant${merchantCount === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' · ') || 'Possible match',
    sameDisplayLabel: left.label.trim().toLowerCase() === right.label.trim().toLowerCase(),
  };
}

export function getPurchaseMeta(purchase = {}) {
  return [
    formatMatchDate(purchase.date),
    formatMatchMoney(purchase.amount),
    formatMatchSize(purchase),
  ].filter(Boolean).join(' · ');
}
