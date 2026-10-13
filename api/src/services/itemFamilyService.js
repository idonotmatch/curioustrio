const {
  cleanItemDescription,
  normalizeItemDisplayName,
  normalizeItemMetadata,
  normalizeText,
} = require('./itemNormalizer');

const FAMILY_RULES = [
  {
    key: 'produce:strawberry',
    name: 'Strawberries',
    identity: /\b(?:strawberry|strawberries|strawbry|strawbrry|strawberrie|strawberr)\b/i,
  },
  {
    key: 'produce:avocado',
    name: 'Avocados',
    identity: /\bavocados?\b/i,
  },
];

const PROCESSED_PRODUCT_MARKERS = /\b(?:dressing|sauce|oil|chips?|crisps?|freeze dried|dried|marshmallows?|ice cream|cone|jam|jelly|juice|smoothie|flavou?r|snacks?|candy|yogurt|cereal|bars?|preserves?|puree|soda|beverage|muffins?|cakes?|cookies?|pastr(?:y|ies)|donuts?|pies?|tarts?|toast)\b/i;

function sourceDescription(item = {}) {
  return cleanItemDescription(
    item.item_name
    || item.description
    || item.raw_description
    || item.normalized_name
    || ''
  );
}

function deriveItemFamilyIdentity(item = {}) {
  const description = sourceDescription(item);
  const normalized = normalizeText(description);
  if (!normalized || PROCESSED_PRODUCT_MARKERS.test(normalized)) return null;
  const rule = FAMILY_RULES.find((candidate) => candidate.identity.test(normalized));
  if (!rule) return null;
  return { family_key: rule.key, family_name: rule.name };
}

function formatComparableNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric.toFixed(3).replace(/\.?0+$/, '');
}

function derivePriceVariant(item = {}, family = deriveItemFamilyIdentity(item)) {
  if (!family) return null;
  const normalized = normalizeItemMetadata({
    description: sourceDescription(item),
    brand: item.brand || null,
    product_size: item.product_size || null,
    pack_size: item.pack_size || null,
    unit: item.unit || item.normalized_total_size_unit || null,
  });
  const sizeValue = item.normalized_total_size_value ?? normalized.normalized_total_size_value;
  const sizeUnit = item.normalized_total_size_unit || normalized.normalized_total_size_unit;
  const formattedSize = formatComparableNumber(sizeValue);
  if (formattedSize && sizeUnit) {
    return {
      price_variant_key: `${family.family_key}|size:${formattedSize}${sizeUnit}`,
      price_variant_label: `${formattedSize} ${sizeUnit === 'ct' || sizeUnit === 'ea' ? 'count' : sizeUnit.replace(/_/g, ' ')}`,
      price_comparison_confidence: 'high',
    };
  }

  const comparableKey = normalized.comparable_key || item.comparable_key || null;
  const productKey = item.product_id ? `product:${item.product_id}` : null;
  const identityKey = comparableKey ? `comparable:${comparableKey}` : productKey;
  if (!identityKey) return null;
  return {
    price_variant_key: `${family.family_key}|identity:${identityKey}`,
    price_variant_label: normalizeItemDisplayName(sourceDescription(item)) || family.family_name,
    price_comparison_confidence: 'unknown_package',
  };
}

function enrichWithItemFamily(item = {}) {
  const family = deriveItemFamilyIdentity(item);
  if (!family) return { ...item };
  return { ...item, ...family, ...derivePriceVariant(item, family) };
}

function normalizeVariantPair(leftVariantKey, rightVariantKey) {
  return [`${leftVariantKey || ''}`, `${rightVariantKey || ''}`].sort();
}

module.exports = {
  deriveItemFamilyIdentity,
  derivePriceVariant,
  enrichWithItemFamily,
  normalizeVariantPair,
};
