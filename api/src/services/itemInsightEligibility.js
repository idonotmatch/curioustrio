const PRODUCT_FRIENDLY_CATEGORIES = new Set([
  'grocery',
  'groceries',
  'household',
  'shopping',
  'retail',
  'kids',
  'children',
  'baby',
  'healthcare',
  'health care',
  'pharmacy',
]);

const SUPPRESSED_CATEGORY_REASONS = new Map([
  ['dining', 'dining_context'],
  ['dining out', 'dining_context'],
  ['restaurant', 'dining_context'],
  ['restaurants', 'dining_context'],
  ['takeout', 'dining_context'],
  ['take out', 'dining_context'],
  ['cafe', 'dining_context'],
  ['coffee shop', 'dining_context'],
  ['fast food', 'dining_context'],
  ['bar', 'dining_context'],
  ['gas', 'gas_context'],
  ['fuel', 'gas_context'],
  ['travel', 'travel_context'],
  ['hotel', 'travel_context'],
  ['airfare', 'travel_context'],
  ['flight', 'travel_context'],
  ['flights', 'travel_context'],
  ['entertainment', 'entertainment_context'],
  ['movies', 'entertainment_context'],
  ['events', 'entertainment_context'],
  ['subscriptions', 'subscription_context'],
  ['subscription', 'subscription_context'],
]);

const SUPPRESSED_CATEGORY_PATTERNS = [
  ['dining_context', /\b(dining|restaurants?|take ?out|cafes?|coffee shops?|fast food|nightlife)\b/],
  ['gas_context', /\b(gas|fuel|gasoline)\b/],
  ['travel_context', /\b(travel|hotels?|airfare|flights?|airlines?)\b/],
  ['entertainment_context', /\b(entertainment|movies?|cinema|events?|concerts?|tickets?)\b/],
  ['subscription_context', /\b(subscriptions?|memberships?)\b/],
];

function normalizeCategoryName(value) {
  return `${value || ''}`
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function categoryNamesForRow(row = {}) {
  return [
    row.category_group_name,
    row.parent_category_name,
    row.expense_category_name,
  ]
    .map(normalizeCategoryName)
    .filter((value, index, values) => value && values.indexOf(value) === index);
}

function classifyItemInsightContext(row = {}) {
  const categoryNames = categoryNamesForRow(row);
  for (const categoryName of categoryNames) {
    const suppressedReason = SUPPRESSED_CATEGORY_REASONS.get(categoryName)
      || SUPPRESSED_CATEGORY_PATTERNS.find(([, pattern]) => pattern.test(categoryName))?.[0];
    if (suppressedReason) {
      return {
        eligible: false,
        tier: 'suppressed',
        suppressed_reason: suppressedReason,
        category_name: categoryName,
      };
    }
  }

  const productCategory = categoryNames.find((name) => PRODUCT_FRIENDLY_CATEGORIES.has(name));
  if (productCategory) {
    return {
      eligible: true,
      tier: 'product_friendly',
      suppressed_reason: null,
      category_name: productCategory,
    };
  }

  if (!categoryNames.length) {
    return {
      eligible: true,
      tier: 'unclassified',
      suppressed_reason: null,
      category_name: null,
    };
  }

  return {
    eligible: true,
    tier: 'ambiguous',
    suppressed_reason: null,
    category_name: categoryNames[0],
  };
}

function hasStrongItemIdentity(rows = []) {
  const eligibleRows = rows.filter(Boolean);
  if (!eligibleRows.length) return false;

  const hasConfirmedProduct = eligibleRows.some((row) => (
    row.product_id
    && (
      row.product_match_confidence === 'high'
      || row.product_match_reason === 'user_confirmed'
      || row.product_match_reason === 'exact_upc'
    )
  ));
  if (hasConfirmedProduct) return true;

  return eligibleRows.every((row) => (
    row.comparable_key
    && row.product_match_confidence === 'high'
  ));
}

function automaticItemInsightDecision(rows = [], { minOccurrences = 3 } = {}) {
  const classified = rows.map((row) => ({
    row,
    context: classifyItemInsightContext(row),
  }));
  const eligibleRows = classified
    .filter(({ context }) => context.eligible)
    .map(({ row }) => row);
  const eligibleContexts = classified
    .filter(({ context }) => context.eligible)
    .map(({ context }) => context);
  const suppressedReasons = [...new Set(
    classified.map(({ context }) => context.suppressed_reason).filter(Boolean)
  )];
  const ambiguousOnly = eligibleContexts.length > 0
    && eligibleContexts.every((context) => context.tier === 'ambiguous');
  const minimumOccurrences = Math.max(
    Math.max(1, Number(minOccurrences) || 3),
    ambiguousOnly ? 4 : 0
  );
  const strongIdentity = hasStrongItemIdentity(eligibleRows);

  let suppressedReason = null;
  if (!eligibleRows.length) {
    suppressedReason = suppressedReasons[0] || 'no_eligible_observations';
  } else if (eligibleRows.length < minimumOccurrences) {
    suppressedReason = 'insufficient_product_observations';
  } else if (ambiguousOnly && !strongIdentity) {
    suppressedReason = 'ambiguous_category_identity';
  }

  const tiers = new Set(eligibleContexts.map((context) => context.tier));
  const tier = tiers.has('product_friendly')
    ? 'product_friendly'
    : tiers.has('unclassified')
      ? 'unclassified'
      : tiers.has('ambiguous')
        ? 'ambiguous'
        : 'suppressed';

  return {
    eligible: suppressedReason == null,
    eligible_rows: eligibleRows,
    eligible_occurrence_count: eligibleRows.length,
    minimum_occurrences: minimumOccurrences,
    requires_strong_identity: ambiguousOnly,
    strong_identity: strongIdentity,
    tier,
    suppressed_reason: suppressedReason,
    excluded_reasons: suppressedReasons,
  };
}

function insightEligibilityMetadata(decision = {}) {
  return {
    eligible: Boolean(decision.eligible),
    tier: decision.tier || 'suppressed',
    eligible_occurrence_count: Number(decision.eligible_occurrence_count || 0),
    minimum_occurrences: Number(decision.minimum_occurrences || 0),
    requires_strong_identity: Boolean(decision.requires_strong_identity),
    strong_identity: Boolean(decision.strong_identity),
    suppressed_reason: decision.suppressed_reason || null,
    excluded_reasons: Array.isArray(decision.excluded_reasons) ? decision.excluded_reasons : [],
  };
}

module.exports = {
  normalizeCategoryName,
  classifyItemInsightContext,
  hasStrongItemIdentity,
  automaticItemInsightDecision,
  insightEligibilityMetadata,
};
