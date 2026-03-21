const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a receipt parser. Extract structured data from a receipt image.
Return ONLY a JSON object with these fields: merchant (string), amount (number), date (ISO date string YYYY-MM-DD), notes (string or null).
The amount should be the total paid. If you cannot extract the data, return null.
Do not include any text outside the JSON object.`;

async function parseReceipt(imageBase64, todayDate) {
  if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.trim().length === 0) {
    throw new Error('imageBase64 must be a non-empty string');
  }

  if (!todayDate || !/^\d{4}-\d{2}-\d{2}$/.test(todayDate)) {
    throw new Error('todayDate must be a valid ISO date string (YYYY-MM-DD)');
  }

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: `Today's date: ${todayDate}. Extract expense data from this receipt.` }
      ]
    }],
  });

  const text = message.content?.[0]?.text?.trim();
  if (!text) return null;
  if (text === 'null') return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = { parseReceipt };
