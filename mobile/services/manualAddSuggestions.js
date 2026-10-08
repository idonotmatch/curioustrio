const {
  normalizeMerchant,
  isLikelyOnlineOrGenericMerchant,
  isPlaceLikeMerchant,
  scoreLocationCandidate,
  selectSuggestedLocationCandidate,
} = require('./locationIntent');

export {
  normalizeMerchant,
  isLikelyOnlineOrGenericMerchant,
  isPlaceLikeMerchant,
  scoreLocationCandidate,
  selectSuggestedLocationCandidate,
};

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
