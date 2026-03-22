const { complete } = require('./ai');

const SYSTEM_PROMPT = `You are an expense parser. Extract structured data from natural language expense input.
Return ONLY a JSON object with these fields:
- merchant (string or null): the store or vendor name. Only set this if a specific store/vendor is named (e.g. "Trader Joe's", "Amazon", "Shell"). Otherwise null.
- description (string or null): the item, product, or category being purchased (e.g. "running shoes", "lunch", "gas", "groceries"). Set this when there is no specific merchant, or when an item is named alongside a merchant.
- amount (number): the expense amount, negative for refunds/returns.
- date (ISO date string): the date of the expense.
- notes (string or null): any additional context.

Examples:
- "lunch 14" → { merchant: null, description: "lunch", amount: 14, ... }
- "trader joes 50" → { merchant: "Trader Joe's", description: "groceries", amount: 50, ... }
- "refund amazon 24.50" → { merchant: "Amazon", description: null, amount: -24.50, ... }
- "gas yesterday 60" → { merchant: null, description: "gas", amount: 60, ... }

If the input cannot be parsed as an expense or refund, return null.
Today's date is provided in the user message. If no date is mentioned, use today's date.
Do not include any text outside the JSON object.`;

async function parseExpense(input, todayDate) {
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return null;
  }

  // Validate todayDate is an ISO date string (YYYY-MM-DD)
  if (!todayDate || !/^\d{4}-\d{2}-\d{2}$/.test(todayDate)) {
    throw new Error('todayDate must be a valid ISO date string (YYYY-MM-DD)');
  }

  const text = await complete({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Today's date: ${todayDate}\nExpense input: ${input}` }],
  });

  if (!text) return null;

  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  if (!cleaned || cleaned === 'null') return null;

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

module.exports = { parseExpense };
