const { canonicalMerchantKey } = require('./merchantIdentity');
const { normalizeComparableDescription } = require('./itemNormalizer');

function normalizeDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const raw = `${value}`.trim();
  const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateOnly) return dateOnly[1];
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function daysBetween(left, right) {
  const leftDate = normalizeDateOnly(left);
  const rightDate = normalizeDateOnly(right);
  if (!leftDate || !rightDate) return Infinity;
  return Math.abs(
    new Date(`${leftDate}T12:00:00Z`).getTime()
      - new Date(`${rightDate}T12:00:00Z`).getTime()
  ) / 86400000;
}

function itemIdentityKey(item = {}) {
  if (item.product_id) return `product:${item.product_id}`;
  if (item.comparable_key) return `comparable:${`${item.comparable_key}`.toLowerCase().trim()}`;
  const normalized = item.normalized_name
    || normalizeComparableDescription(item.description || item.raw_description);
  return normalized ? `name:${normalized}` : null;
}

function basketSimilarity(leftItems = [], rightItems = []) {
  const left = new Set(leftItems.map(itemIdentityKey).filter(Boolean));
  const right = new Set(rightItems.map(itemIdentityKey).filter(Boolean));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  left.forEach((key) => { if (right.has(key)) overlap += 1; });
  return Number((overlap / Math.max(left.size, right.size)).toFixed(3));
}

module.exports = {
  basketSimilarity,
  canonicalMerchantKey,
  daysBetween,
  itemIdentityKey,
  normalizeDateOnly,
};
