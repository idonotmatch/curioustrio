const Anthropic = require('@anthropic-ai/sdk');
const MerchantMapping = require('../models/merchantMapping');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function confidenceFromHitCount(hitCount) {
  if (hitCount >= 5) return 4;
  if (hitCount >= 2) return 3;
  return 2;
}

const SYSTEM_PROMPT = `You are an expense categorizer. Given a merchant name and a list of categories,
return the best matching category_id. Return ONLY a JSON object: {"category_id": "<id or null>", "confidence": "high|medium|low|none"}.
If no category fits, return null for category_id. Do not include any text outside the JSON.`;

async function assignCategory({ merchant, householdId, categories, placeType }) {
  // 1. Check merchant memory
  const mapping = await MerchantMapping.findByMerchant(householdId, merchant);
  if (mapping) {
    return {
      category_id: mapping.category_id,
      source: 'memory',
      confidence: confidenceFromHitCount(mapping.hit_count),
    };
  }

  // 2. Claude fallback
  const categoryList = categories.map(c => `${c.id}: ${c.name}`).join('\n');
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 128,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Merchant: ${merchant}${placeType ? `\nPlace type: ${placeType}` : ''}\n\nCategories:\n${categoryList}`,
    }],
  });

  try {
    const text = message.content?.[0]?.text?.trim();
    if (!text) return { category_id: null, source: 'claude', confidence: 0 };
    const parsed = JSON.parse(text);
    return {
      category_id: parsed.category_id || null,
      source: 'claude',
      confidence: 1,
    };
  } catch {
    return { category_id: null, source: 'claude', confidence: 0 };
  }
}

module.exports = { assignCategory };
