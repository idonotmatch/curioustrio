const { complete } = require('./ai');

const SYSTEM_PROMPT = `You are a receipt email parser. Extract purchase data from email receipts, order confirmations, and refund notifications.
Return ONLY a JSON object with:
- merchant (string)
- amount (number): the FINAL total actually charged to the payment method — this must include subtotal, shipping, tax, and any other fees. Do NOT use the subtotal. If the email shows "Order total: $53.42" or "Total charged: $53.42", use that number.
- date (ISO date string YYYY-MM-DD)
- notes (string or null)
- items (array or null): individual line items from the email, each as { "description": string, "amount": number or null }. Include product lines AND fees (shipping, tax, service fees, etc.) as separate items so that items sum to the total amount. Set to null if the email does not list individual items.

If the email describes a refund or return, set amount as a negative number.
If the email is not purchase/refund related, return null.
Do not include any text outside the JSON object.`;

async function parseEmailExpense(emailBody, subject, fromAddress, todayDate) {
  if (!emailBody || typeof emailBody !== 'string' || emailBody.trim().length === 0) {
    throw new Error('emailBody is required');
  }
  if (!todayDate || !/^\d{4}-\d{2}-\d{2}$/.test(todayDate)) {
    throw new Error('todayDate must be a valid ISO date string (YYYY-MM-DD)');
  }

  const truncatedBody = emailBody.length > 3000 ? emailBody.slice(0, 3000) + '...' : emailBody;

  const text = await complete({
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Subject: ${subject}\nFrom: ${fromAddress}\nToday: ${todayDate}\n\n${truncatedBody}`,
    }],
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

module.exports = { parseEmailExpense };
