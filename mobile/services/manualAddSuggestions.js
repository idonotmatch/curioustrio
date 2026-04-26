const ONLINE_OR_GENERIC_MERCHANTS = new Set([
  'amazon',
  'amazon.com',
  'apple',
  'apple.com',
  'chewy',
  'etsy',
  'gas',
  'groceries',
  'haircut',
  'instacart',
  'lunch',
  'lyft',
  'online',
  'paypal',
  'shopping',
  'subscription',
  'uber',
]);

function normalizeToken(value = '') {
  return `${value || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeMerchant(value = '') {
  return normalizeToken(value);
}

export function isLikelyOnlineOrGenericMerchant(value = '') {
  const normalized = normalizeMerchant(value);
  return !normalized || ONLINE_OR_GENERIC_MERCHANTS.has(normalized);
}

export function isPlaceLikeMerchant(value = '') {
  const normalized = normalizeMerchant(value);
  if (!normalized) return false;
  if (normalized.length < 3) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (isLikelyOnlineOrGenericMerchant(normalized)) return false;
  const parts = normalized.split(' ').filter(Boolean);
  if (!parts.length) return false;
  const genericLead = ['coffee', 'food', 'gas', 'groceries', 'restaurant', 'store'];
  if (parts.length === 1 && genericLead.includes(parts[0])) return false;
  return true;
}

function overlapScore(merchant, placeName) {
  const merchantTokens = new Set(normalizeMerchant(merchant).split(' ').filter(Boolean));
  const placeTokens = new Set(normalizeMerchant(placeName).split(' ').filter(Boolean));
  if (!merchantTokens.size || !placeTokens.size) return 0;
  let matches = 0;
  for (const token of merchantTokens) {
    if (placeTokens.has(token)) matches += 1;
  }
  return matches / merchantTokens.size;
}

export function scoreLocationCandidate(merchant, candidate) {
  const merchantNorm = normalizeMerchant(merchant);
  const placeNorm = normalizeMerchant(candidate?.place_name || '');
  if (!merchantNorm || !placeNorm) return 0;
  if (merchantNorm === placeNorm) return 1;
  if (placeNorm.includes(merchantNorm) || merchantNorm.includes(placeNorm)) return 0.9;
  return overlapScore(merchantNorm, placeNorm);
}

export function shouldSuggestLocationFromMerchant({
  merchant,
  hasAcceptedLocation = false,
  dismissedMerchantSuggestion = '',
} = {}) {
  const normalizedMerchant = normalizeMerchant(merchant);
  if (!normalizedMerchant) return false;
  if (hasAcceptedLocation) return false;
  if (!isPlaceLikeMerchant(normalizedMerchant)) return false;
  if (dismissedMerchantSuggestion && normalizedMerchant === dismissedMerchantSuggestion) return false;
  return true;
}

export function selectSuggestedLocationCandidate(merchant, results = []) {
  const ranked = (Array.isArray(results) ? results : [])
    .map((candidate) => ({
      candidate,
      score: scoreLocationCandidate(merchant, candidate),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;
  if (best.score < 0.72) return null;

  return {
    type: 'location',
    value: best.candidate,
    confidence: best.score,
    reason: 'merchant_nearby_match',
    key: `${normalizeMerchant(merchant)}::${best.candidate?.mapkit_stable_id || best.candidate?.place_name || 'candidate'}`,
  };
}
