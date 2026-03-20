const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an expense parser. Extract structured data from natural language expense input.
Return ONLY a JSON object with these fields: merchant (string), amount (number), date (ISO date string), notes (string or null).
If the input cannot be parsed as an expense, return null.
Today's date is provided in the user message. If no date is mentioned, use today's date.
Do not include any text outside the JSON object.`;

async function parseExpense(input, todayDate) {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Today's date: ${todayDate}\nExpense input: ${input}`,
    }],
  });

  const text = message.content[0].text.trim();
  if (text === 'null') return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = { parseExpense };
