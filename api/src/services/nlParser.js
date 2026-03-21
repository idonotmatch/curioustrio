const { complete } = require('./ai');

const SYSTEM_PROMPT = `You are an expense parser. Extract structured data from natural language expense input.
Return ONLY a JSON object with these fields: merchant (string), amount (number), date (ISO date string), notes (string or null).
If the input describes a refund or return (e.g., "refund trader joes 24.50", "return amazon"), set amount as a negative number.
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
  if (text === 'null') return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = { parseExpense };
