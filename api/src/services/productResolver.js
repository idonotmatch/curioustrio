const Product = require('../models/product');
const { normalizeItemMetadata } = require('./itemNormalizer');

/**
 * Given a parsed item with optional product fields, find or create a product record.
 * Returns the product id, or null if there's not enough data to identify a product.
 *
 * Lookup priority:
 *   1. UPC (globally unique)
 *   2. SKU + merchant
 *   3. No match → create if we have at least UPC or SKU
 */
async function resolveProduct(item, merchant) {
  const resolution = await resolveProductMatch(item, merchant);
  return resolution?.confidence === 'high' ? resolution.product_id : null;
}

async function resolveProductMatch(item, merchant) {
  const { description, upc, sku, brand, product_size, pack_size, unit } = item;
  const normalized = normalizeItemMetadata(item);

  if (!description) return null;

  // Fee/tax/shipping items — skip product resolution
  if (isNonProduct(description)) return null;

  try {
    // 1. Try UPC match
    if (upc) {
      const existing = await Product.findByUpc(upc);
      if (existing) {
        const updates = {};
        if (!existing.sku && sku) updates.sku = sku;
        if (!existing.brand && brand) updates.brand = brand;
        if (!existing.product_size && product_size) updates.product_size = product_size;
        if (!existing.pack_size && pack_size) updates.pack_size = pack_size;
        if (!existing.unit && unit) updates.unit = unit;
        if (!existing.merchant && merchant) updates.merchant = merchant;
        if (Object.keys(updates).length > 0) await Product.update(existing.id, updates);
        return { product_id: existing.id, confidence: 'high', reason: 'upc' };
      }
    }

    // 2. Try SKU + merchant match
    if (sku && merchant) {
      const existing = await Product.findBySkuAndMerchant(sku, merchant);
      if (existing) {
        const updates = {};
        if (!existing.upc && upc) updates.upc = upc;
        if (!existing.brand && brand) updates.brand = brand;
        if (!existing.product_size && product_size) updates.product_size = product_size;
        if (!existing.pack_size && pack_size) updates.pack_size = pack_size;
        if (!existing.unit && unit) updates.unit = unit;
        if (Object.keys(updates).length > 0) await Product.update(existing.id, updates);
        return { product_id: existing.id, confidence: 'high', reason: 'sku_merchant' };
      }
    }

    // 3. Try normalized description matching with explicit confidence thresholds.
    const matchConfidence = getNormalizedMatchConfidence({ merchant, normalized, brand, product_size, pack_size, unit });
    if (matchConfidence) {
      const existing = await Product.findByNormalizedDetails({
        name: description,
        merchant,
        brand,
        productSize: product_size,
        packSize: pack_size,
        unit,
      });
      if (existing) {
        const updates = {};
        if (!existing.upc && upc) updates.upc = upc;
        if (!existing.sku && sku) updates.sku = sku;
        if (!existing.brand && brand) updates.brand = brand;
        if (!existing.product_size && product_size) updates.product_size = product_size;
        if (!existing.pack_size && pack_size) updates.pack_size = pack_size;
        if (!existing.unit && unit) updates.unit = unit;
        if (!existing.merchant && merchant) updates.merchant = merchant;
        if (Object.keys(updates).length > 0) await Product.update(existing.id, updates);
        return { product_id: existing.id, confidence: matchConfidence, reason: 'normalized_match' };
      }
    }

    // 4. Create new when we have a stable identifier or enough descriptive structure.
    const hasStructuredIdentity = !!(upc || sku || canCreateCanonicalProduct({ merchant, normalized, brand, product_size, pack_size, unit }));
    if (!hasStructuredIdentity) return null;

    const product = await Product.create({
      name: description,
      brand: brand || null,
      upc: upc || null,
      sku: sku || null,
      merchant: merchant || null,
      productSize: product_size || null,
      packSize: pack_size || null,
      unit: unit || null,
    });
    return { product_id: product.id, confidence: 'high', reason: 'created' };
  } catch (err) {
    // Product resolution is non-fatal
    console.error('productResolver error (non-fatal):', err.message);
    return null;
  }
}

function getNormalizedMatchConfidence({ merchant, normalized, brand, product_size, pack_size, unit }) {
  if (!normalized.comparable_key || !normalized.normalized_name) return false;
  if (brand || product_size || pack_size || unit) return 'high';

  const tokenCount = normalized.normalized_name.split(' ').filter(Boolean).length;
  if (!!merchant && tokenCount >= 2 && normalized.normalized_name.length >= 12) {
    return 'medium';
  }

  return null;
}

function canCreateCanonicalProduct({ merchant, normalized, brand, product_size, pack_size, unit }) {
  const matchConfidence = getNormalizedMatchConfidence({ merchant, normalized, brand, product_size, pack_size, unit });
  if (matchConfidence === 'high') return true;

  const tokenCount = normalized.normalized_name?.split(' ').filter(Boolean).length || 0;
  return !!merchant && tokenCount >= 2 && normalized.normalized_name?.length >= 8;
}

const NON_PRODUCT_PATTERNS = /^(tax|hst|gst|pst|vat|tip|gratuity|service charge|service fee|delivery fee|shipping|handling|bag fee|surcharge|discount|coupon|savings|subtotal|total)/i;

function isNonProduct(description) {
  return NON_PRODUCT_PATTERNS.test(description.trim());
}

module.exports = { resolveProduct, resolveProductMatch };
