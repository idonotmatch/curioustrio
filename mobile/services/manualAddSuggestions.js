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

const CATEGORY_PATTERNS = [
  ['Groceries', /\b(grocer(?:y|ies)?|supermarket|market|trader joe'?s|whole foods|aldi|kroger|safeway|publix|wegmans|food lion|costco|milk|eggs|produce|bananas?)\b/i],
  ['Dining Out', /\b(lunch|dinner|breakfast|brunch|restaurant|cafe|coffee|chipotle|starbucks|takeout|delivery|bar|drinks?|pizza|burger|sushi)\b/i],
  ['Gas', /\b(gas|fuel|shell|chevron|exxon|bp|mobil|sunoco|speedway)\b/i],
  ['Household', /\b(home depot|lowe'?s|cleaning|detergent|paper towels?|toilet paper|household|hardware)\b/i],
  ['Kids', /\b(kids?|child|children|daycare|school|toys?|baby|diapers?)\b/i],
  ['Healthcare', /\b(doctor|dentist|pharmacy|cvs|walgreens|medicine|medical|health|copay|prescription)\b/i],
  ['Subscriptions', /\b(subscription|monthly|netflix|spotify|hulu|disney|apple|icloud|prime|membership|dues)\b/i],
  ['Entertainment', /\b(movie|cinema|concert|game|tickets?|entertainment|theater|streaming)\b/i],
  ['Shopping', /\b(amazon|target|walmart|shopping|clothes?|shoes?|nike|nordstrom|macy'?s)\b/i],
  ['Travel', /\b(uber|lyft|taxi|hotel|flight|airline|train|parking|toll|rental car|travel)\b/i],
];

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

function findCategoryByName(categories = [], targetName = '') {
  const normalizedTarget = normalizeMerchant(targetName);
  return (Array.isArray(categories) ? categories : []).find((category) => normalizeMerchant(category?.name) === normalizedTarget) || null;
}

function categorySuggestion(category, confidence, reason, key) {
  if (!category) return null;
  return {
    type: 'category',
    value: { id: category.id, name: category.name },
    confidence,
    reason,
    key,
  };
}

export function selectSuggestedCategoryCandidate({ merchant = '', location = null, categories = [] } = {}) {
  const merchantText = normalizeMerchant(merchant);
  const placeText = normalizeMerchant(location?.place_name || '');
  const expenseText = [merchantText, placeText].filter(Boolean).join(' ');
  if (!expenseText) return null;

  if (/\buber eats\b|\bdoordash\b|\bgrubhub\b/.test(expenseText)) {
    return categorySuggestion(
      findCategoryByName(categories, 'Dining Out'),
      0.86,
      'merchant_location_pattern',
      `${expenseText}::dining-out`
    );
  }

  if (/\buber\b|\blyft\b/.test(expenseText)) {
    return categorySuggestion(
      findCategoryByName(categories, 'Travel'),
      0.82,
      'merchant_location_pattern',
      `${expenseText}::travel`
    );
  }

  for (const [categoryName, pattern] of CATEGORY_PATTERNS) {
    if (!pattern.test(expenseText)) continue;
    const category = findCategoryByName(categories, categoryName);
    if (!category) continue;
    const confidence = ['Groceries', 'Dining Out', 'Gas', 'Travel'].includes(categoryName) ? 0.8 : 0.74;
    return categorySuggestion(
      category,
      confidence,
      'merchant_location_pattern',
      `${expenseText}::${normalizeMerchant(categoryName)}`
    );
  }

  return null;
}
