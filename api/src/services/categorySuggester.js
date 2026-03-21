const ai = require('./ai');
const Category = require('../models/category');
const CategorySuggestion = require('../models/categorySuggestion');

const SYSTEM_PROMPT = `You are a personal finance category organizer.
Given a new parent category and a list of existing categories, return which existing categories should be grouped under the parent.
Respond ONLY with a valid JSON array of objects: [{"leaf_id":"...","parent_id":"..."}].
Return [] if no categories are a good match.
Be conservative — only suggest categories that clearly belong under the parent.`;

async function suggest(householdId, newParentId) {
  try {
    const all = await Category.findByHousehold(householdId);

    // Unassigned household-owned categories, excluding the new parent itself
    const leaves = all.filter(
      c => c.household_id === householdId && !c.parent_id && c.id !== newParentId
    );
    if (leaves.length === 0) return;

    const parent = all.find(c => c.id === newParentId);
    if (!parent) return;

    const leafList = leaves.map(c => `- ${c.id}: ${c.name}`).join('\n');
    const userMessage = `New parent category: "${parent.name}" (id: ${newParentId})\n\nExisting categories to consider:\n${leafList}\n\nWhich of these belong under "${parent.name}"?`;

    const responseText = await ai.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 256,
    });

    if (!responseText) return;

    // Strip markdown code fences if present
    const clean = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const suggestions = JSON.parse(clean);

    for (const s of suggestions) {
      if (s.leaf_id && s.parent_id) {
        await CategorySuggestion.upsertForLeaf(householdId, s.leaf_id, s.parent_id);
      }
    }
  } catch {
    // Non-fatal — failure here must never block the categories route
  }
}

module.exports = { suggest };
