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
  if (['fl oz', 'floz', 'fl ounce', 'fluid ounce', 'fluid ounces', 'fz'].includes(value)) return 'fl_oz';
  if (['oz', 'ounce', 'ounces'].includes(value)) return 'oz';
  if (['lb', 'lbs', 'pound', 'pounds'].includes(value)) return 'lb';
  if (['g', 'gram', 'grams'].includes(value)) return 'g';
  if (['kg', 'kilogram', 'kilograms'].includes(value)) return 'kg';
  if (['ml', 'milliliter', 'milliliters'].includes(value)) return 'ml';
  if (['l', 'liter', 'liters'].includes(value)) return 'l';
  if (['ct', 'count'].includes(value)) return 'ct';
  if (['ea', 'each'].includes(value)) return 'ea';
  if (['gal', 'gallon', 'gallons'].includes(value)) return 'gal';
  if (['pt', 'pint', 'pints'].includes(value)) return 'pt';
  if (['qt', 'quart', 'quarts'].includes(value)) return 'qt';
  return value;
}

const ITEM_BOILERPLATE_MARKERS = [
  /\blet us know\b/i,
  /\btell us (?:about|how|what)\b/i,
  /\bshare your feedback\b/i,
  /\bhow (?:was|did) your (?:visit|experience|order)\b/i,
  /\bvisit (?:us|our website)\b/i,
  /\btake (?:our|a) survey\b/i,
  /\bscan (?:the )?qr code\b/i,
  /\bquestions or comments\b/i,
  /\bjoin (?:our|the) rewards\b/i,
  /\bfollow us\b/i,
  /\bthanks? for (?:shopping|your purchase)\b/i,
];

function cleanItemDescription(value = '') {
  let text = `${value || ''}`.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  let cutAt = text.length;
  for (const marker of ITEM_BOILERPLATE_MARKERS) {
    const match = marker.exec(text);
    if (match) cutAt = Math.min(cutAt, match.index);
  }
  text = text.slice(0, cutAt)
    .replace(/^[#*\-:|\s]+/, '')
    .replace(/[\s,.;:|\-]+$/, '')
    .trim();
  return text.slice(0, 500);
}

function extractStructuredSize(value = '') {
  const text = `${value || ''}`.toLowerCase().replace(/×/g, 'x');
  const sizeMatch = text.match(/(?:^|\b)(\d+(?:\.\d+)?)\s*(fl\s*oz|floz|fl ounce|fz|oz|ounces?|lbs?|pounds?|kg|kilograms?|g|grams?|ml|milliliters?|l|liters?|gal|gallons?|pt|pints?|qt|quarts?|ct|count|ea|each)\b/i);
  const packMatch = text.match(/(?:^|\b)(\d+(?:\.\d+)?)\s*(?:x|pk|pack)\b/i)
    || text.match(/\bpack\s+of\s+(\d+(?:\.\d+)?)\b/i);
  if (!sizeMatch && !packMatch) return {};
  return {
    product_size: sizeMatch ? sizeMatch[1] : null,
    unit: sizeMatch ? normalizeUnit(sizeMatch[2]) : null,
    pack_size: packMatch ? packMatch[1] : null,
  };
}

function parseNumeric(value) {
  if (value == null || value === '') return null;
  const match = String(value).match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function parsePurchaseQuantity(quantity) {
  const numeric = parseNumeric(quantity);
  if (numeric == null || numeric <= 0) return null;
  return numeric;
}

function normalizeSizeValue(rawValue, rawUnit) {
  const numeric = parseNumeric(rawValue);
  let unit = normalizeUnit(rawUnit || rawValue);
  if (numeric == null || !unit) return { normalizedSizeValue: null, normalizedSizeUnit: null };
  let normalized = numeric;
  if (unit === 'lb') {
    normalized *= 16;
    unit = 'oz';
  } else if (unit === 'kg') {
    normalized *= 1000;
    unit = 'g';
  } else if (unit === 'l') {
    normalized *= 1000;
    unit = 'ml';
  } else if (unit === 'gal') {
    normalized *= 128;
    unit = 'fl_oz';
  } else if (unit === 'pt') {
    normalized *= 16;
    unit = 'fl_oz';
  } else if (unit === 'qt') {
    normalized *= 32;
    unit = 'fl_oz';
  }
  return {
    normalizedSizeValue: Number(normalized.toFixed(3)),
    normalizedSizeUnit: unit,
  };
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

function deriveNormalizedTotalSize({
  normalizedSizeValue,
  normalizedSizeUnit,
  normalizedQuantity,
  purchaseQuantity,
}) {
  if (normalizedSizeValue == null || !normalizedSizeUnit || normalizedQuantity == null) {
    return { normalizedTotalSizeValue: null, normalizedTotalSizeUnit: null };
  }
  const multiplier = purchaseQuantity != null && purchaseQuantity > 0 ? purchaseQuantity : 1;
  return {
    normalizedTotalSizeValue: Number((normalizedSizeValue * normalizedQuantity * multiplier).toFixed(3)),
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
  let text = normalizeText(cleanItemDescription(description));
  if (!text) return '';

  text = text
    .replace(/\b(?:bought|ordered|purchased)\s+(?:from|at)\s+[a-z0-9 ]+$/, ' ')
    .replace(/\b(?:from|at|via)\s+[a-z0-9 ]+$/, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:x|ct|count|pack|pk)\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:oz|ounce|ounces|lb|lbs|pound|pounds|g|gram|grams|kg|ml|l|liter|liters|fl oz|floz|fz|gal|gallon|pt|pint|qt|quart|ea|each)\b/g, ' ')
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
  const cleanedDescription = cleanItemDescription(item.description);
  const extracted = extractStructuredSize(cleanedDescription);
  const productSize = item.product_size || extracted.product_size || null;
  const packSize = item.pack_size || extracted.pack_size || null;
  const productUnit = item.product_size ? item.unit : (item.unit || extracted.unit);
  const normalizedName = normalizeComparableDescription(cleanedDescription, item.brand) || normalizeText(cleanedDescription);
  const normalizedBrand = normalizeText(item.brand);
  const { normalizedSizeValue, normalizedSizeUnit } = normalizeSizeValue(productSize, productUnit);
  const normalizedPackSize = parsePackSize(packSize);
  const purchaseQuantity = parsePurchaseQuantity(item.quantity);
  const normalizedQuantity = deriveNormalizedQuantity({
    normalizedSizeValue,
    normalizedSizeUnit,
    normalizedPackSize,
  });
  let { normalizedTotalSizeValue, normalizedTotalSizeUnit } = deriveNormalizedTotalSize({
    normalizedSizeValue,
    normalizedSizeUnit,
    normalizedQuantity,
    purchaseQuantity,
  });
  let estimatedUnitPrice = deriveEstimatedUnitPrice(item.amount, normalizedTotalSizeValue);
  let comparisonPriceSource = estimatedUnitPrice != null ? 'normalized_size' : null;
  if (estimatedUnitPrice == null && Number(item.unit_price) > 0) {
    estimatedUnitPrice = Number(Number(item.unit_price).toFixed(4));
    normalizedTotalSizeValue = purchaseQuantity || 1;
    normalizedTotalSizeUnit = normalizeUnit(item.pricing_unit || (!productSize ? item.unit : null)) || 'ea';
    comparisonPriceSource = 'printed_unit_price';
  } else if (estimatedUnitPrice == null && Number(item.amount) > 0 && purchaseQuantity > 0) {
    estimatedUnitPrice = Number((Number(item.amount) / purchaseQuantity).toFixed(4));
    normalizedTotalSizeValue = purchaseQuantity;
    normalizedTotalSizeUnit = normalizeUnit(item.pricing_unit) || 'ea';
    comparisonPriceSource = 'derived_quantity';
  }
  const comparableKey = buildComparableKey({
    description: cleanedDescription,
    brand: item.brand,
    normalizedSizeValue,
    normalizedSizeUnit,
    normalizedPackSize,
  });

  return {
    cleaned_description: cleanedDescription || null,
    inferred_product_size: item.product_size ? null : (extracted.product_size || null),
    inferred_pack_size: item.pack_size ? null : (extracted.pack_size || null),
    inferred_unit: item.unit ? null : (extracted.unit || null),
    normalized_name: normalizedName || null,
    normalized_brand: normalizedBrand || null,
    normalized_size_value: normalizedSizeValue,
    normalized_size_unit: normalizedSizeUnit,
    normalized_pack_size: normalizedPackSize,
    normalized_quantity: normalizedQuantity,
    normalized_total_size_value: normalizedTotalSizeValue,
    normalized_total_size_unit: normalizedTotalSizeUnit,
    estimated_unit_price: estimatedUnitPrice,
    comparison_price_source: comparisonPriceSource,
    comparable_key: comparableKey,
  };
}

module.exports = {
  normalizeText,
  normalizeUnit,
  normalizeItemMetadata,
  normalizeComparableDescription,
  cleanItemDescription,
  extractStructuredSize,
  parsePackSize,
};
