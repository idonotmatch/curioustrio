const Product = require('../models/product');

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
  const { description, upc, sku, brand, product_size, pack_size, unit } = item;

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
        return existing.id;
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
        return existing.id;
      }
    }

    // 3. Create new (only if we have at least UPC or SKU — otherwise too ambiguous)
    if (!upc && !sku) return null;

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
    return product.id;
  } catch (err) {
    // Product resolution is non-fatal
    console.error('productResolver error (non-fatal):', err.message);
    return null;
  }
}

const NON_PRODUCT_PATTERNS = /^(tax|hst|gst|pst|vat|tip|gratuity|service charge|service fee|delivery fee|shipping|handling|bag fee|surcharge|discount|coupon|savings|subtotal|total)/i;

function isNonProduct(description) {
  return NON_PRODUCT_PATTERNS.test(description.trim());
}

module.exports = { resolveProduct };
