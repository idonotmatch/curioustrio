const { complete } = require('./ai');

const SYSTEM_PROMPT = `You are an expense parser. Extract structured data from natural language expense input.
Return ONLY a JSON object with these fields:
- merchant (string or null): the store or vendor name. Only set this if a specific store/vendor is named (e.g. "Trader Joe's", "Amazon", "Shell"). Otherwise null.
- description (string or null): the item, product, or category being purchased (e.g. "running shoes", "lunch", "gas", "groceries"). Set this when there is no specific merchant, or when an item is named alongside a merchant.
- amount (number): the expense amount, negative for refunds/returns.
- date (ISO date string): the date of the expense.
- notes (string or null): any additional context.
- payment_method (string or null): one of "cash", "credit", "debit", or null if not mentioned. Infer from context: "amex", "visa", "mastercard", "credit card" → "credit"; "debit card" → "debit"; "cash" → "cash".
- card_label (string or null): the card nickname or description if mentioned (e.g. "platinum amex", "chase sapphire", "blue visa"). null if not mentioned.
- items (array or null): individual line items if specific products/services are named, each as { "description": string, "amount": number or null }. Set to null if no specific items are mentioned beyond the overall description.

Examples:
- "lunch 14" → { merchant: null, description: "lunch", amount: 14, items: null, payment_method: null, card_label: null, ... }
- "trader joes 50" → { merchant: "Trader Joe's", description: "groceries", amount: 50, items: null, payment_method: null, card_label: null, ... }
- "65 at gym for monthly dues on platinum amex" → { merchant: "gym", description: "monthly dues", amount: 65, items: null, payment_method: "credit", card_label: "platinum amex", ... }
- "coffee 5 cash" → { merchant: null, description: "coffee", amount: 5, items: null, payment_method: "cash", card_label: null, ... }
- "amazon 34 on chase sapphire" → { merchant: "Amazon", description: null, amount: 34, items: null, payment_method: "credit", card_label: "chase sapphire", ... }
- "125 nike running shoes from nordstrom using amex platinum" → { merchant: "Nordstrom", description: null, amount: 125, items: [{ description: "Nike running shoes", amount: 125 }], payment_method: "credit", card_label: "amex platinum", ... }
- "50 dinner and drinks at nobu with two glasses of wine" → { merchant: "Nobu", description: "dinner and drinks", amount: 50, items: [{ description: "dinner", amount: null }, { description: "drinks (2 glasses wine)", amount: null }], ... }

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
