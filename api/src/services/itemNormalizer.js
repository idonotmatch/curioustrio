function normalizeText(value) {
  return (value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUnit(unit = '') {
  const value = normalizeText(unit);
  if (!value) return null;
  if (['fl oz', 'fluid ounce', 'fluid ounces'].includes(value)) return 'oz';
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
  if (packSize == null || packSize === '') return null;
  const text = String(packSize).toLowerCase().trim();
  const multiplierMatch = text.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (multiplierMatch) {
    return Number(multiplierMatch[1]) * Number(multiplierMatch[2]);
  }
  const numeric = parseNumeric(text);
  return numeric == null ? null : numeric;
}

function deriveNormalizedQuantity({ normalizedSizeValue, normalizedSizeUnit, normalizedPackSize }) {
  if (normalizedPackSize != null) return normalizedPackSize;
  if (normalizedSizeUnit === 'ct' || normalizedSizeUnit === 'ea') return normalizedSizeValue;
  return 1;
}

function deriveNormalizedTotalSize({ normalizedSizeValue, normalizedSizeUnit, normalizedQuantity }) {
  if (normalizedSizeValue == null || !normalizedSizeUnit || normalizedQuantity == null) {
    return { normalizedTotalSizeValue: null, normalizedTotalSizeUnit: null };
  }
  return {
    normalizedTotalSizeValue: Number((normalizedSizeValue * normalizedQuantity).toFixed(3)),
    normalizedTotalSizeUnit: normalizedSizeUnit,
  };
}

function deriveEstimatedUnitPrice(amount, normalizedTotalSizeValue) {
  if (amount == null || normalizedTotalSizeValue == null || normalizedTotalSizeValue <= 0) return null;
  return Number((Number(amount) / normalizedTotalSizeValue).toFixed(4));
}

function singularizeToken(token = '') {
  if (!token || token.length <= 3) return token;
  if (/(ss|us)$/.test(token)) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('s')) return token.slice(0, -1);
  return token;
}

function normalizeComparableDescription(description = '', brand = '') {
  let text = normalizeText(description);
  if (!text) return '';

  text = text
    .replace(/\b(?:bought|ordered|purchased)\s+(?:from|at)\s+[a-z0-9 ]+$/, ' ')
    .replace(/\b(?:from|at|via)\s+[a-z0-9 ]+$/, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:x|ct|count|pack|pk)\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:oz|ounce|ounces|lb|lbs|pound|pounds|g|gram|grams|kg|ml|l|liter|liters|fl oz|ea|each)\b/g, ' ')
    .replace(/\b(?:pack|pk|count|ct|size)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const normalizedBrand = normalizeText(brand);
  if (normalizedBrand && text.startsWith(`${normalizedBrand} `)) {
    text = text.slice(normalizedBrand.length + 1).trim();
  }

  const tokens = text
    .split(' ')
    .filter(Boolean)
    .map(singularizeToken);

  return tokens.join(' ').trim();
}

function buildComparableKey({ description, brand, normalizedSizeValue, normalizedSizeUnit, normalizedPackSize }) {
  const name = normalizeComparableDescription(description, brand);
  if (!name) return null;
  const parts = [name];
  const normalizedBrand = normalizeText(brand);
  if (normalizedBrand) parts.push(`brand:${normalizedBrand}`);
  if (normalizedSizeValue != null && normalizedSizeUnit) parts.push(`size:${normalizedSizeValue}${normalizedSizeUnit}`);
  if (normalizedPackSize != null) parts.push(`pack:${normalizedPackSize}`);
  return parts.join('|');
}

function normalizeItemMetadata(item = {}) {
  const normalizedName = normalizeComparableDescription(item.description, item.brand) || normalizeText(item.description);
  const normalizedBrand = normalizeText(item.brand);
  const { normalizedSizeValue, normalizedSizeUnit } = normalizeSizeValue(item.product_size, item.unit);
  const normalizedPackSize = parsePackSize(item.pack_size);
  const normalizedQuantity = deriveNormalizedQuantity({
    normalizedSizeValue,
    normalizedSizeUnit,
    normalizedPackSize,
  });
  const { normalizedTotalSizeValue, normalizedTotalSizeUnit } = deriveNormalizedTotalSize({
    normalizedSizeValue,
    normalizedSizeUnit,
    normalizedQuantity,
  });
  const estimatedUnitPrice = deriveEstimatedUnitPrice(item.amount, normalizedTotalSizeValue);
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
    normalized_quantity: normalizedQuantity,
    normalized_total_size_value: normalizedTotalSizeValue,
    normalized_total_size_unit: normalizedTotalSizeUnit,
    estimated_unit_price: estimatedUnitPrice,
    comparable_key: comparableKey,
  };
}

module.exports = {
  normalizeText,
  normalizeUnit,
  normalizeItemMetadata,
  normalizeComparableDescription,
  parsePackSize,
};
