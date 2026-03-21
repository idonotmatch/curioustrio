const { completeWithImage } = require('./ai');

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

  const text = await completeWithImage({
    system: SYSTEM_PROMPT,
    imageBase64,
    text: `Today's date: ${todayDate}. Extract expense data from this receipt.`,
  });

  if (!text) return null;
  if (text === 'null') return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = { parseReceipt };
