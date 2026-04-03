const { completeWithImage } = require('./ai');

const SYSTEM_PROMPT = `You are a receipt parser. Extract structured data from a receipt image.
Return ONLY a JSON object with these fields:
- merchant (string)
- amount (number): the total paid (including tax and fees)
- date (ISO date string YYYY-MM-DD)
- notes (string or null)
- items (array or null): individual line items from the receipt, each as { "description": string, "amount": number or null, "upc": string or null, "sku": string or null, "brand": string or null, "product_size": string or null, "pack_size": string or null, "unit": string or null }. Include product lines AND fees (tax, tip, service charge, etc.) as separate named items so that the items sum to the total amount. Omit subtotal lines (they are redundant). For fee/tax/tip lines set upc/sku/brand/product_size/pack_size/unit to null. Set to null if line items are not clearly visible.

If you cannot extract the data, return null.
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
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!cleaned || cleaned === 'null') return null;
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

module.exports = { parseReceipt };
