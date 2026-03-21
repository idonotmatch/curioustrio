const { complete } = require('./ai');

const SYSTEM_PROMPT = `You are a receipt email parser. Extract purchase data from email receipts, order confirmations, and refund notifications.
Return ONLY a JSON object with: merchant (string), amount (number), date (ISO date string YYYY-MM-DD), notes (string or null).
If the email describes a refund or return, set amount as a negative number.
If the email is not purchase/refund related, return null.
The amount should be the total charged or refunded. Use the email date if no explicit purchase date is found.
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

  if (!text || text === 'null') return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = { parseEmailExpense };
