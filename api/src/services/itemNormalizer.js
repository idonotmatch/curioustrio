function normalizeText(value) {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUnit(unit = '') {
  const value = normalizeText(unit);
  if (!value) return null;
  if (['oz', 'ounce', 'ounces'].includes(value)) return 'oz';
  if (['lb', 'lbs', 'pound', 'pounds'].includes(value)) return 'lb';
  if (['g', 'gram', 'grams'].includes(value)) return 'g';
  if (['kg', 'kilogram', 'kilograms'].includes(value)) return 'kg';
  if (['ml', 'milliliter', 'milliliters'].includes(value)) return 'ml';
  if (['l', 'liter', 'liters'].includes(value)) return 'l';
  if (['ct', 'count'].includes(value)) return 'ct';
  if (['ea', 'each'].includes(value)) return 'ea';
  return value;
}

function parseNumeric(value) {
  if (value == null || value === '') return null;
  const match = String(value).match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function normalizeSizeValue(rawValue, rawUnit) {
  const numeric = parseNumeric(rawValue);
  const unit = normalizeUnit(rawUnit || rawValue);
  if (numeric == null || !unit) return { normalizedSizeValue: null, normalizedSizeUnit: null };
  return { normalizedSizeValue: numeric, normalizedSizeUnit: unit };
}

function parsePackSize(packSize) {
  const numeric = parseNumeric(packSize);
  return numeric == null ? null : numeric;
}

function buildComparableKey({ description, brand, normalizedSizeValue, normalizedSizeUnit, normalizedPackSize }) {
  const name = normalizeText(description);
  if (!name) return null;
  const parts = [name];
  const normalizedBrand = normalizeText(brand);
  if (normalizedBrand) parts.push(`brand:${normalizedBrand}`);
  if (normalizedSizeValue != null && normalizedSizeUnit) parts.push(`size:${normalizedSizeValue}${normalizedSizeUnit}`);
  if (normalizedPackSize != null) parts.push(`pack:${normalizedPackSize}`);
  return parts.join('|');
}

function normalizeItemMetadata(item = {}) {
  const normalizedName = normalizeText(item.description);
  const normalizedBrand = normalizeText(item.brand);
  const { normalizedSizeValue, normalizedSizeUnit } = normalizeSizeValue(item.product_size, item.unit);
  const normalizedPackSize = parsePackSize(item.pack_size);
  const comparableKey = buildComparableKey({
    description: item.description,
    brand: item.brand,
    normalizedSizeValue,
    normalizedSizeUnit,
    normalizedPackSize,
  });

  return {
    normalized_name: normalizedName || null,
    normalized_brand: normalizedBrand || null,
    normalized_size_value: normalizedSizeValue,
    normalized_size_unit: normalizedSizeUnit,
    normalized_pack_size: normalizedPackSize,
    comparable_key: comparableKey,
  };
}

module.exports = {
  normalizeText,
  normalizeUnit,
  normalizeItemMetadata,
};
