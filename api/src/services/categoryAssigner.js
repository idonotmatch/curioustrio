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
      return { category_id: category.id, source: 'heuristic', confidence: 2 };
    }
  }

  for (const [categoryName, pattern] of CATEGORY_KEYWORDS) {
    if (!pattern.test(expenseText)) continue;
    const category = findCategoryByName(categories, categoryName);
    if (category) return { category_id: category.id, source: 'heuristic', confidence: 2 };
  }

  return null;
}

async function assignCategory({ merchant, description, householdId, categories, placeType }) {
  const learnedDecision = await CategoryDecisionEvent.findBestLearnedMatch({
    householdId,
    merchantName: merchant,
    description,
  });
  if (learnedDecision?.category_id) {
    return {
      category_id: learnedDecision.category_id,
      source: learnedDecision.match_type === 'merchant_description' ? 'decision_memory' : 'description_memory',
      confidence: confidenceFromDecisionCount(learnedDecision.decision_count),
    };
  }

  // 1. Check merchant memory (only when a specific merchant name is known)
  if (merchant) {
    const mapping = await MerchantMapping.findByMerchant(householdId, merchant);
    if (mapping) {
      return {
        category_id: mapping.category_id,
        source: 'memory',
        confidence: confidenceFromHitCount(mapping.hit_count),
      };
    }
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
    };
  } catch (err) {
    console.error('[categoryAssigner] Error:', err.message);
    return { category_id: null, source: 'claude', confidence: 0 };
  }
}

module.exports = { assignCategory };
