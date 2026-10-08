const Product = require('../models/product');
const ItemMatchDecision = require('../models/itemMatchDecision');
const { cleanItemDescription, normalizeItemMetadata } = require('./itemNormalizer');
const { isProductLikeItem } = require('./itemClassifier');
const { cleanMerchantDisplayName } = require('./merchantIdentity');

const GENERIC_VARIANT_TOKENS = new Set([
  'organic', 'fresh', 'original', 'classic', 'large', 'small', 'medium',
  'new', 'the', 'and', 'with', 'for',
]);

function normalizedTokens(value = '') {
  return `${value || ''}`.split(/\s+/).filter(Boolean);
}

function chooseVariantSearchToken(normalizedName = '') {
  const tokens = normalizedTokens(normalizedName);
  return tokens.find((token) => token.length >= 4 && !GENERIC_VARIANT_TOKENS.has(token))
    || tokens.find((token) => token.length >= 3)
    || null;
}

function sameMerchant(left, right) {
  const normalize = (value) => `${value || ''}`.trim().toLowerCase().replace(/\s+/g, ' ');
  const leftKey = normalize(left);
  const rightKey = normalize(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function hasStructuredConflict(input = {}, candidate = {}) {
  if (input.normalized_brand && candidate.normalized_brand && input.normalized_brand !== candidate.normalized_brand) {
    return true;
  }
  if (
    input.normalized_size_value != null
    && candidate.normalized_size_value != null
    && (
      input.normalized_size_unit !== candidate.normalized_size_unit
      || Math.abs(Number(input.normalized_size_value) - Number(candidate.normalized_size_value)) > 0.001
    )
  ) {
    return true;
  }
  if (
    input.normalized_pack_size != null
    && candidate.normalized_pack_size != null
    && Math.abs(Number(input.normalized_pack_size) - Number(candidate.normalized_pack_size)) > 0.001
  ) {
    return true;
  }
  return false;
}

function scoreNameVariant({ normalized, merchant, candidate }) {
  if (!normalized?.normalized_name || !candidate?.normalized_name) return null;
  if (!sameMerchant(merchant, candidate.merchant)) return null;

  const candidateNormalized = normalizeItemMetadata({
    description: candidate.name || candidate.normalized_name,
    brand: candidate.brand,
    product_size: candidate.product_size,
    pack_size: candidate.pack_size,
    unit: candidate.unit,
  });
  if (hasStructuredConflict(normalized, candidateNormalized)) return null;

  const inputTokens = new Set(normalizedTokens(normalized.normalized_name));
  const candidateTokens = new Set(normalizedTokens(candidateNormalized.normalized_name));
  const confirmedBrandContext = Boolean(
    normalized.normalized_brand
    && candidateNormalized.normalized_brand
    && normalized.normalized_brand === candidateNormalized.normalized_brand
  );
  if ((inputTokens.size < 2 || candidateTokens.size < 2) && !confirmedBrandContext) return null;
  const intersection = [...inputTokens].filter((token) => candidateTokens.has(token)).length;
  const containment = intersection / Math.min(inputTokens.size, candidateTokens.size);
  const union = new Set([...inputTokens, ...candidateTokens]).size;
  const jaccard = union ? intersection / union : 0;
  if (containment < 0.75 || jaccard < 0.5) return null;

  const score = Number((containment * 0.65 + jaccard * 0.35).toFixed(4));
  return score >= 0.78 ? score : null;
}

function confirmedAliasConflicts(normalized, alias = {}) {
  const aliasNormalized = normalizeItemMetadata({
    description: alias.candidate_product_name || '',
    brand: alias.candidate_product_brand,
    product_size: alias.candidate_product_size,
    pack_size: alias.candidate_pack_size,
    unit: alias.candidate_product_unit,
  });
  return hasStructuredConflict(normalized, aliasNormalized);
}

async function findVariantMatch({ item, merchant, householdId, normalized }) {
  const nameTokens = normalizedTokens(normalized.normalized_name);
  if (nameTokens.length < 2 && !normalized.normalized_brand) return null;
  const searchToken = chooseVariantSearchToken(normalized.normalized_name);
  if (!merchant || !searchToken) return null;
  const candidates = await Product.findNameCandidates({
    merchant,
    normalizedBrand: normalized.normalized_brand,
    searchToken,
    limit: 12,
  });
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({ candidate, score: scoreNameVariant({ normalized, merchant, candidate }) }))
    .filter((entry) => entry.score != null)
    .sort((left, right) => right.score - left.score || `${left.candidate.id}`.localeCompare(`${right.candidate.id}`));
  if (!ranked.length) return null;
  if (ranked[1] && Math.abs(ranked[0].score - ranked[1].score) < 0.03) return null;

  const best = ranked[0].candidate;
  const rememberedDecision = await ItemMatchDecision.findForCandidate({
    householdId,
    normalizedName: normalized.normalized_name,
    merchant,
    candidateProductId: best.id,
  });
  if (rememberedDecision?.decision === 'different') return null;
  return {
    product_id: best.id,
    confidence: rememberedDecision?.decision === 'same' ? 'high' : 'medium',
    reason: rememberedDecision?.decision === 'same' ? 'household_confirmed_alias' : 'name_variant_match',
  };
}

/**
 * Given a parsed item with optional product fields, find or create a product record.
 * Returns the product id, or null if there's not enough data to identify a product.
 *
 * Lookup priority:
 *   1. UPC (globally unique)
 *   2. SKU + merchant
 *   3. Normalized product details, optionally across merchants when strongly structured
 *   4. No match -> create only from UPC, merchant-scoped SKU, or strong structured metadata
 */
async function resolveProduct(item, merchant, options = {}) {
  const resolution = await resolveProductMatch(item, merchant, options);
  return resolution?.product_id || null;
}

async function resolveProductMatch(item, merchant, { householdId = null } = {}) {
  const { upc, sku, brand, product_size, pack_size, unit } = item;
  const description = cleanItemDescription(item.description);
  const canonicalMerchant = cleanMerchantDisplayName(merchant) || merchant;
  const normalized = normalizeItemMetadata({ ...item, description });
  const effectiveProductSize = product_size || normalized.inferred_product_size || undefined;
  const effectivePackSize = pack_size || normalized.inferred_pack_size || undefined;
  const effectiveUnit = unit || normalized.inferred_unit || undefined;
  const matchConfidence = getNormalizedMatchConfidence({
    merchant: canonicalMerchant,
    normalized,
    brand,
    product_size: effectiveProductSize,
    pack_size: effectivePackSize,
    unit: effectiveUnit,
  });

  if (!description) return null;

  // Fee/tax/shipping/discount/summary items — skip product resolution
  if (!isProductLikeItem(item)) return null;
  if (item.extraction_confidence === 'low') return null;

  try {
    // 1. Try UPC match
    if (upc) {
      const existing = await Product.findByUpc(upc);
      if (existing) {
        const updates = {};
        if (!existing.sku && sku) updates.sku = sku;
        if (!existing.brand && brand) updates.brand = brand;
        if (!existing.product_size && effectiveProductSize) updates.product_size = effectiveProductSize;
        if (!existing.pack_size && effectivePackSize) updates.pack_size = effectivePackSize;
        if (!existing.unit && effectiveUnit) updates.unit = effectiveUnit;
        if (!existing.merchant && canonicalMerchant) updates.merchant = canonicalMerchant;
        if (Object.keys(updates).length > 0) await Product.update(existing.id, updates);
        return { product_id: existing.id, confidence: 'high', reason: 'upc' };
      }
    }

    // 2. Try SKU + merchant match
    if (sku && canonicalMerchant) {
      const existing = await Product.findBySkuAndMerchant(sku, canonicalMerchant);
      if (existing) {
        const updates = {};
        if (!existing.upc && upc) updates.upc = upc;
        if (!existing.brand && brand) updates.brand = brand;
        if (!existing.product_size && effectiveProductSize) updates.product_size = effectiveProductSize;
        if (!existing.pack_size && effectivePackSize) updates.pack_size = effectivePackSize;
        if (!existing.unit && effectiveUnit) updates.unit = effectiveUnit;
        if (Object.keys(updates).length > 0) await Product.update(existing.id, updates);
        return { product_id: existing.id, confidence: 'high', reason: 'sku_merchant' };
      }
    }

    const hasUnmatchedStableIdentifier = Boolean(upc || (sku && canonicalMerchant));

    // 3. Try normalized description matching with explicit confidence thresholds.
    if (!hasUnmatchedStableIdentifier && matchConfidence) {
      const existing = await Product.findByNormalizedDetails({
        name: description,
        merchant: canonicalMerchant,
        brand,
        productSize: effectiveProductSize,
        packSize: effectivePackSize,
        unit: effectiveUnit,
        allowCrossMerchant: matchConfidence === 'high',
      });
      if (existing) {
        const rememberedDecision = matchConfidence === 'medium'
          ? await ItemMatchDecision.findForCandidate({
              householdId,
              normalizedName: normalized.normalized_name,
              merchant: canonicalMerchant,
              candidateProductId: existing.id,
            })
          : null;
        if (rememberedDecision?.decision === 'different') return null;
        if (rememberedDecision?.decision === 'same') {
          return {
            product_id: existing.id,
            confidence: 'high',
            reason: 'household_confirmed_alias',
          };
        }
        const updates = {};
        if (!existing.upc && upc) updates.upc = upc;
        if (!existing.sku && sku) updates.sku = sku;
        if (!existing.brand && brand) updates.brand = brand;
        if (!existing.product_size && effectiveProductSize) updates.product_size = effectiveProductSize;
        if (!existing.pack_size && effectivePackSize) updates.pack_size = effectivePackSize;
        if (!existing.unit && effectiveUnit) updates.unit = effectiveUnit;
        if (!existing.merchant && canonicalMerchant) updates.merchant = canonicalMerchant;
        if (Object.keys(updates).length > 0) await Product.update(existing.id, updates);
        return { product_id: existing.id, confidence: matchConfidence, reason: 'normalized_match' };
      }
    }

    // 4. Reuse an alias the household has already confirmed when the exact
    // canonical key misses. This avoids an extra decision lookup for common
    // exact matches while still reconnecting corrected or abbreviated names.
    if (!hasUnmatchedStableIdentifier && householdId && normalized.normalized_name) {
      const confirmedAlias = await ItemMatchDecision.findConfirmedAlias({
        householdId,
        normalizedName: normalized.normalized_name,
        merchant: canonicalMerchant,
      });
      if (confirmedAlias?.candidate_product_id && !confirmedAliasConflicts(normalized, confirmedAlias)) {
        return {
          product_id: confirmedAlias.candidate_product_id,
          confidence: 'high',
          reason: 'household_confirmed_alias',
        };
      }
    }

    // 5. Offer one conservative same-merchant name variant for review. This
    // never auto-confirms unless the household has already accepted the alias.
    const variantMatch = !hasUnmatchedStableIdentifier
      ? await findVariantMatch({ item: { ...item, description }, merchant: canonicalMerchant, householdId, normalized })
      : null;
    if (variantMatch) return variantMatch;

    // 6. Create new when we have a stable identifier or enough descriptive structure.
    const hasStructuredIdentity = !!(
      upc
      || (sku && canonicalMerchant)
      || canCreateCanonicalProduct({
        merchant: canonicalMerchant,
        normalized,
        brand,
        product_size: effectiveProductSize,
        pack_size: effectivePackSize,
        unit: effectiveUnit,
      })
    );
    if (!hasStructuredIdentity) return null;

    const product = await Product.create({
      name: description,
      brand: brand || null,
      upc: upc || null,
      sku: sku || null,
      merchant: canonicalMerchant || null,
      productSize: effectiveProductSize || null,
      packSize: effectivePackSize || null,
      unit: effectiveUnit || null,
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
  return matchConfidence === 'high';
}

module.exports = {
  chooseVariantSearchToken,
  resolveProduct,
  resolveProductMatch,
  scoreNameVariant,
};
