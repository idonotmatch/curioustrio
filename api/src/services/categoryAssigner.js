const { complete } = require('./ai');
const MerchantMapping = require('../models/merchantMapping');

function confidenceFromHitCount(hitCount) {
  if (hitCount >= 5) return 4;
  if (hitCount >= 2) return 3;
  return 2;
}

const SYSTEM_PROMPT = `You are an expense categorizer. Given an expense description and a list of categories,
return the best matching category_id. Return ONLY a JSON object: {"category_id": "<id or null>", "confidence": "high|medium|low|none"}.
If no category fits, return null for category_id. Do not include any text outside the JSON.`;

async function assignCategory({ merchant, description, householdId, categories, placeType }) {
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

  // 2. Claude fallback — use both merchant and description so generic inputs
  //    like "lunch 14" (merchant=null, description="lunch") still get matched.
  const categoryList = categories.map(c => `${c.id}: ${c.name}`).join('\n');
  const expenseLine = [merchant, description].filter(Boolean).join(' — ') || 'unknown';

  console.log(`[categoryAssigner] expense="${expenseLine}" categories=${categories.length} householdId=${householdId}`);
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
    console.log(`[categoryAssigner] Claude raw response: ${text}`);
    if (!text) return { category_id: null, source: 'claude', confidence: 0 };
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    console.log(`[categoryAssigner] Assigned category_id=${parsed.category_id}`);
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
