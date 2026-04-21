const { complete } = require('./ai');
const MerchantMapping = require('../models/merchantMapping');
const CategoryDecisionEvent = require('../models/categoryDecisionEvent');

function confidenceFromHitCount(hitCount) {
  if (hitCount >= 5) return 4;
  if (hitCount >= 2) return 3;
  return 2;
}

function confidenceFromDecisionCount(decisionCount) {
  if (decisionCount >= 4) return 4;
  if (decisionCount >= 2) return 3;
  return 2;
}

const SYSTEM_PROMPT = `You are an expense categorizer. Given an expense description and a list of categories,
return the best matching category_id. Return ONLY a JSON object: {"category_id": "<id or null>", "confidence": "high|medium|low|none"}.
If no category fits, return null for category_id. Do not include any text outside the JSON.`;

const CATEGORY_KEYWORDS = [
  ['Groceries', /\b(grocer(?:y|ies)?|supermarket|market|trader joe'?s|whole foods|aldi|kroger|safeway|publix|wegmans|food lion|milk|eggs|produce|bananas?)\b/i],
  ['Dining Out', /\b(lunch|dinner|breakfast|brunch|restaurant|cafe|coffee|chipotle|starbucks|takeout|delivery|bar|drinks?|pizza|burger|sushi)\b/i],
  ['Gas', /\b(gas|fuel|shell|chevron|exxon|bp|mobil|sunoco|speedway)\b/i],
  ['Household', /\b(home depot|lowe'?s|cleaning|detergent|paper towels?|toilet paper|household|hardware)\b/i],
  ['Kids', /\b(kids?|child|children|daycare|school|toys?|baby|diapers?)\b/i],
  ['Healthcare', /\b(doctor|dentist|pharmacy|cvs|walgreens|medicine|medical|health|copay|prescription)\b/i],
  ['Subscriptions', /\b(subscription|monthly|netflix|spotify|hulu|disney|apple|icloud|prime|membership|dues)\b/i],
  ['Entertainment', /\b(movie|cinema|concert|game|tickets?|entertainment|theater|streaming)\b/i],
  ['Shopping', /\b(amazon|target|walmart|shopping|clothes?|shoes?|nike|nordstrom|macy'?s|costco)\b/i],
  ['Travel', /\b(uber|lyft|taxi|hotel|flight|airline|train|parking|toll|rental car|travel)\b/i],
];

function normalizeCategoryName(value) {
  return `${value || ''}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeComparableText(value) {
  return `${value || ''}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function descriptionTokenCount(value) {
  return normalizeComparableText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !['the', 'and', 'for', 'with', 'from', 'payment', 'purchase', 'order'].includes(token))
    .length;
}

function isDescriptionSpecificEnough(description) {
  const normalized = normalizeComparableText(description);
  if (!normalized) return false;
  if (normalized.length < 8) return false;
  return descriptionTokenCount(normalized) >= 2;
}

function findCategoryByName(categories, categoryName) {
  const normalizedName = normalizeCategoryName(categoryName);
  return categories.find((category) => normalizeCategoryName(category.name) === normalizedName) || null;
}

function assignCategoryHeuristically({ merchant, description, categories }) {
  const expenseText = [merchant, description].filter(Boolean).join(' ');
  if (!expenseText || !Array.isArray(categories) || categories.length === 0) return null;

  for (const category of categories) {
    const categoryName = `${category.name || ''}`.trim();
    if (!categoryName) continue;
    const categoryPattern = new RegExp(`\\b${categoryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (categoryPattern.test(expenseText)) {
      return {
        category_id: category.id,
        source: 'heuristic',
        confidence: 2,
        reasoning: {
          strategy: 'heuristic',
          label: 'Matched local category text',
          detail: `The expense text directly matched the "${category.name}" category.`,
        },
      };
    }
  }

  for (const [categoryName, pattern] of CATEGORY_KEYWORDS) {
    if (!pattern.test(expenseText)) continue;
    const category = findCategoryByName(categories, categoryName);
    if (category) {
      return {
        category_id: category.id,
        source: 'heuristic',
        confidence: 2,
        reasoning: {
          strategy: 'heuristic',
          label: 'Matched local keyword pattern',
          detail: `The expense text matched a "${category.name}" keyword pattern.`,
        },
      };
    }
  }

  return null;
}

function buildMemoryReasoning(mapping) {
  return {
    strategy: 'memory',
    label: 'Matched merchant memory',
    detail: mapping?.hit_count >= 5
      ? 'This merchant has a strong category history for this household.'
      : 'This merchant has shown up in this category before for this household.',
    merchant_hit_count: Number(mapping?.hit_count || 0),
  };
}

function buildDecisionReasoning(learnedDecision, merchantMapping = null) {
  const merchantConflict = merchantMapping && merchantMapping.category_id !== learnedDecision?.category_id;
  return {
    strategy: learnedDecision?.match_type === 'merchant_description' ? 'decision_memory' : 'description_memory',
    label: learnedDecision?.match_type === 'merchant_description'
      ? 'Learned from repeated category decisions'
      : 'Learned from repeated description corrections',
    detail: learnedDecision?.match_type === 'merchant_description'
      ? `This merchant and description combination has been corrected into this category ${learnedDecision?.decision_count || 0} times.`
      : `This description has been corrected into this category ${learnedDecision?.decision_count || 0} times.`,
    decision_count: Number(learnedDecision?.decision_count || 0),
    merchant_conflict: Boolean(merchantConflict),
    merchant_hit_count: merchantMapping ? Number(merchantMapping.hit_count || 0) : 0,
  };
}

function shouldPreferLearnedMerchantDecision(learnedDecision, merchantMapping = null) {
  if (!learnedDecision || learnedDecision.match_type !== 'merchant_description') return false;
  if (!merchantMapping) return true;
  if (merchantMapping.category_id === learnedDecision.category_id) return true;
  const decisionCount = Number(learnedDecision.decision_count || 0);
  const memoryHits = Number(merchantMapping.hit_count || 0);
  return decisionCount >= 4 || decisionCount > memoryHits;
}

function shouldUseDescriptionMemory(learnedDecision, { merchant, description, merchantMapping = null } = {}) {
  if (!learnedDecision || learnedDecision.match_type !== 'description') return false;
  if (merchant) return false;
  if (merchantMapping) return false;
  if (!isDescriptionSpecificEnough(description)) return false;
  return Number(learnedDecision.decision_count || 0) >= 2;
}

async function gatherAssignmentSignals({ householdId, merchant, description }) {
  const [merchantMapping, learnedDecision] = await Promise.all([
    merchant ? MerchantMapping.findByMerchant(householdId, merchant) : Promise.resolve(null),
    CategoryDecisionEvent.findBestLearnedMatch({
      householdId,
      merchantName: merchant,
      description,
    }),
  ]);

  return {
    merchantMapping,
    learnedDecision,
  };
}

async function assignCategory({ merchant, description, householdId, categories, placeType }) {
  const { merchantMapping, learnedDecision } = await gatherAssignmentSignals({
    householdId,
    merchant,
    description,
  });

  if (learnedDecision?.category_id && shouldPreferLearnedMerchantDecision(learnedDecision, merchantMapping)) {
    return {
      category_id: learnedDecision.category_id,
      source: 'decision_memory',
      confidence: confidenceFromDecisionCount(learnedDecision.decision_count),
      reasoning: buildDecisionReasoning(learnedDecision, merchantMapping),
    };
  }

  // 1. Check merchant memory (only when a specific merchant name is known)
  if (merchantMapping) {
    return {
      category_id: merchantMapping.category_id,
      source: 'memory',
      confidence: confidenceFromHitCount(merchantMapping.hit_count),
      reasoning: buildMemoryReasoning(merchantMapping),
    };
  }

  if (learnedDecision?.category_id && shouldUseDescriptionMemory(learnedDecision, {
    merchant,
    description,
    merchantMapping,
  })) {
    return {
      category_id: learnedDecision.category_id,
      source: 'description_memory',
      confidence: confidenceFromDecisionCount(learnedDecision.decision_count),
      reasoning: buildDecisionReasoning(learnedDecision, merchantMapping),
    };
  }

  const heuristic = assignCategoryHeuristically({ merchant, description, categories });
  if (heuristic) return heuristic;

  // 3. Claude fallback — use both merchant and description so generic inputs
  //    like "lunch 14" (merchant=null, description="lunch") still get matched.
  const categoryList = categories.map(c => `${c.id}: ${c.name}`).join('\n');
  const expenseLine = [merchant, description].filter(Boolean).join(' — ') || 'unknown';

  if (categories.length === 0) {
    console.warn('[categoryAssigner] No categories available — skipping Claude call');
    return { category_id: null, source: 'claude', confidence: 0 };
  }

  try {
    const text = await complete({
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Expense: ${expenseLine}${placeType ? `\nPlace type: ${placeType}` : ''}\n\nCategories:\n${categoryList}`,
      }],
      maxTokens: 128,
    });
    if (!text) return { category_id: null, source: 'claude', confidence: 0 };
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      category_id: parsed.category_id || null,
      source: 'claude',
      confidence: 1,
      reasoning: {
        strategy: 'claude',
        label: 'AI fallback',
        detail: 'No strong local memory matched, so the AI fallback picked the closest category.',
      },
    };
  } catch (err) {
    console.error('[categoryAssigner] Error:', err.message);
    return {
      category_id: null,
      source: 'claude',
      confidence: 0,
      reasoning: {
        strategy: 'claude',
        label: 'AI fallback unavailable',
        detail: 'No local category signal matched and the AI fallback could not complete.',
      },
    };
  }
}

async function explainAssignedCategory({ householdId, merchant, description, categoryId, categories = [] }) {
  if (!categoryId) {
    return {
      strategy: 'uncategorized',
      label: 'No category chosen',
      detail: 'This expense is currently uncategorized.',
    };
  }

  const { merchantMapping, learnedDecision } = await gatherAssignmentSignals({
    householdId,
    merchant,
    description,
  });

  if (
    learnedDecision?.category_id === categoryId
    && shouldPreferLearnedMerchantDecision(learnedDecision, merchantMapping)
  ) {
    return buildDecisionReasoning(learnedDecision, merchantMapping);
  }

  if (merchantMapping?.category_id === categoryId) {
    return buildMemoryReasoning(merchantMapping);
  }

  if (
    learnedDecision?.category_id === categoryId
    && shouldUseDescriptionMemory(learnedDecision, { merchant, description, merchantMapping })
  ) {
    return buildDecisionReasoning(learnedDecision, merchantMapping);
  }

  const heuristic = assignCategoryHeuristically({ merchant, description, categories });
  if (heuristic?.category_id === categoryId) {
    return heuristic.reasoning;
  }

  return {
    strategy: 'manual_or_override',
    label: 'Set outside automatic memory',
    detail: 'This category does not currently match the strongest remembered pattern, so it was likely chosen manually or by a one-off override.',
  };
}

module.exports = { assignCategory, explainAssignedCategory };
