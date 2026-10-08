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

function normalizeMerchant(value = '') {
  return `${value || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyOnlineOrGenericMerchant(value = '') {
  const normalized = normalizeMerchant(value);
  return !normalized || ONLINE_OR_GENERIC_MERCHANTS.has(normalized);
}

function isPlaceLikeMerchant(value = '') {
  const normalized = normalizeMerchant(value);
  if (!normalized || normalized.length < 3 || /^\d+$/.test(normalized)) return false;
  if (isLikelyOnlineOrGenericMerchant(normalized)) return false;
  const parts = normalized.split(' ').filter(Boolean);
  if (!parts.length) return false;
  const genericLead = ['coffee', 'food', 'gas', 'groceries', 'restaurant', 'store'];
  return !(parts.length === 1 && genericLead.includes(parts[0]));
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

function scoreLocationCandidate(merchant, candidate) {
  const merchantNorm = normalizeMerchant(merchant);
  const placeNorm = normalizeMerchant(candidate?.place_name || '');
  if (!merchantNorm || !placeNorm) return 0;
  const distance = Number(candidate?.distance_meters);
  if (Number.isFinite(distance) && distance > 5000) return 0;

  const merchantCompact = merchantNorm.replace(/\s/g, '');
  const placeCompact = placeNorm.replace(/\s/g, '');
  let score = 0;
  if (merchantNorm === placeNorm) score = 1;
  else if (merchantCompact === placeCompact) score = 0.98;
  else if (placeNorm.includes(merchantNorm) || merchantNorm.includes(placeNorm)) score = 0.9;
  else score = overlapScore(merchantNorm, placeNorm);
  if (Number.isFinite(distance) && distance > 2000) score *= 0.75;
  return score;
}

function selectSuggestedLocationCandidate(merchant, results = []) {
  const ranked = (Array.isArray(results) ? results : [])
    .map((candidate) => ({ candidate, score: scoreLocationCandidate(merchant, candidate) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 0.72) return null;
  return {
    type: 'location',
    value: best.candidate,
    confidence: best.score,
    reason: 'merchant_nearby_match',
    key: `${normalizeMerchant(merchant)}::${best.candidate?.mapkit_stable_id || best.candidate?.place_name || 'candidate'}`,
  };
}

function currentLocationAction(merchant = '') {
  return isPlaceLikeMerchant(merchant)
    ? { mode: 'merchant_nearby', label: 'Find nearby' }
    : { mode: 'current_position', label: 'Current location' };
}

module.exports = {
  normalizeMerchant,
  isLikelyOnlineOrGenericMerchant,
  isPlaceLikeMerchant,
  scoreLocationCandidate,
  selectSuggestedLocationCandidate,
  currentLocationAction,
};
