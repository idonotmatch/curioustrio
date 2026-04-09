const { complete } = require('./ai');

const CLASSIFIER_SYSTEM_PROMPT = `You are an email expense classifier.
Given an email subject, sender, and a few body excerpts, classify it as one of:
- expense
- refund
- uncertain
- not_expense

Return ONLY a JSON object with:
- disposition (one of "expense", "refund", "uncertain", "not_expense")
- merchant (string or null)
- reason (short string or null)

Use "uncertain" when the email looks purchase-related but lacks a clearly readable final charge.
Use "not_expense" for newsletters, promos, shipping-only updates, account alerts, or non-purchase emails.
Do not include any text outside the JSON object.`;

const SYSTEM_PROMPT = `You are a receipt email parser. Extract purchase data from email receipts, order confirmations, and refund notifications.
Return ONLY a JSON object with:
- merchant (string)
- amount (number): the FINAL total actually charged to the payment method — this must include subtotal, shipping, tax, and any other fees. Do NOT use the subtotal. If the email shows "Order total: $53.42" or "Total charged: $53.42", use that number.
- date (ISO date string YYYY-MM-DD)
- notes (string or null)
- payment_method (string or null): one of "cash", "credit", "debit", or null if not visible. Infer "visa", "mastercard", "amex", "credit" as credit; "debit" as debit.
- card_label (string or null): card brand or nickname shown in the email when visible (for example "Visa", "Chase Sapphire", "Amex Gold"). null if not visible.
- card_last4 (string or null): the final 4 digits of the card if visible. null if not visible.
- items (array or null): individual line items from the email, each as { "description": string, "amount": number or null, "upc": string or null, "sku": string or null, "brand": string or null, "product_size": string or null, "pack_size": string or null, "unit": string or null }. Include product lines AND fees (shipping, tax, service fees, etc.) as separate items so that items sum to the total amount. For fee/tax/shipping lines set upc/sku/brand/product_size/pack_size/unit to null. Set items to null if the email does not list individual items.

If the email describes a refund or return, set amount as a negative number.
If the email is not purchase/refund related, return null.
Do not include any text outside the JSON object.`;

function cleanText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function analyzeEmailSignals(subject = '', fromAddress = '', emailBody = '') {
  const text = `${subject}\n${fromAddress}\n${emailBody}`.toLowerCase();
  const senderLooksTransactional = /@(amazon|walmart|target|ubereats|instacart|doordash|stripe|shopify|square|paypal|apple|google|expedia|delta|united|airbnb|booking|hilton|marriott|costco|bestbuy|etsy|ebay|wayfair|chewy|seamless|grubhub)\./i.test(fromAddress);
  const negativeSignals = /(tracking|shipped|out for delivery|delivered|newsletter|unsubscribe|promotion|sale ends|weekly digest|security alert|sign in|password reset|view in browser|manage preferences)/i.test(text);
  const transactionalContext = /(receipt|order|confirmation|purchase|charged|invoice|payment|refund|return|renewal|booking|subscription|trip|reservation)/i.test(text);
  const strongMoneySignal = /(?:order total|total charged|amount charged|amount paid|payment total|grand total|refund amount|refund total|you paid|charged to)[^$\d]{0,30}\$?\s?-?\d+(?:\.\d{2})?/i.test(text);
  const mediumMoneySignal = /(?:\btotal\b|\binvoice amount\b|\bpayment received\b|\bamount\b)[^$\d]{0,20}\$?\s?-?\d+(?:\.\d{2})?/i.test(text)
    || (/\$\s?-?\d+(?:\.\d{2})?/.test(text) && transactionalContext);
  const weakMoneySignal = /(?:save|from|starting at|under|up to|earn|credit|discount)[^$\d]{0,20}\$?\s?\d+(?:\.\d{2})?/i.test(text)
    || /\$\s?\d+(?:\.\d{2})?/.test(text);

  const shouldSurfaceToReview = strongMoneySignal
    || (mediumMoneySignal && (transactionalContext || senderLooksTransactional))
    || (transactionalContext && senderLooksTransactional && /\$\s?-?\d+(?:\.\d{2})?/.test(text));

  return {
    senderLooksTransactional,
    negativeSignals,
    transactionalContext,
    strongMoneySignal,
    mediumMoneySignal,
    weakMoneySignal,
    shouldSurfaceToReview,
  };
}

function classifyEmailModality(subject = '', fromAddress = '', emailBody = '') {
  const text = `${subject}\n${fromAddress}\n${emailBody}`.toLowerCase();
  const hasShippingSignals = /(tracking|shipped|out for delivery|delivered|estimated delivery|ship to|shipment|package)/i.test(text);
  const hasDigitalSignals = /(subscription|renewal|streaming|digital receipt|ebook|download|membership)/i.test(text);
  const hasPickupSignals = /(pickup|pick up|curbside|ready for pickup|ready for pick up|in store pickup|store pickup)/i.test(text);
  const hasInStoreSignals = /(in-store|instore|store #|register|terminal|lane \d+|thanks for shopping with us today|receipt|visited|cashier)/i.test(text);
  const hasAddressLikeSignal = /\b\d{2,6}\s+[a-z0-9.'-]+(?:\s+[a-z0-9.'-]+){0,5}\s(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place)\b/i.test(text);

  if (hasShippingSignals) return 'delivery';
  if (hasDigitalSignals && !hasInStoreSignals && !hasPickupSignals) return 'digital';
  if (hasPickupSignals) return 'pickup';
  if (hasInStoreSignals || hasAddressLikeSignal) return 'in_person';
  if (/(order confirmation|order total|your order|placed your order|delivery order)/i.test(text)) return 'online';
  return 'unknown';
}

function extractEmailLocationCandidate(subject = '', fromAddress = '', emailBody = '') {
  const text = `${subject}\n${emailBody}`;
  const storeNumberMatch = text.match(/\bstore\s*#?\s*([a-z0-9-]{1,12})\b/i);
  const addressMatch = text.match(/\b\d{2,6}\s+[a-z0-9.'-]+(?:\s+[a-z0-9.'-]+){0,5}\s(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place)\b(?:,?\s+[a-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?)?/i);
  const cityStateZipMatch = text.match(/\b([A-Z][a-zA-Z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?)\b/);

  const address = addressMatch?.[0]?.replace(/\s+/g, ' ').trim() || null;
  const cityState = cityStateZipMatch?.[1]?.replace(/\s+/g, ' ').trim() || null;
  const storeNumber = storeNumberMatch?.[1] || null;

  if (!address && !cityState && !storeNumber) return null;
  return {
    address,
    city_state: cityState,
    store_number: storeNumber,
  };
}

function selectRelevantEmailText(emailBody, snippet = '') {
  const cleaned = cleanText(emailBody);
  const normalizedSnippet = cleanText(snippet);
  if (!cleaned) return { classifierText: '', extractionText: '' };

  const top = cleaned.slice(0, 1200);
  const bottom = cleaned.length > 1200 ? cleaned.slice(-1200) : '';
  const keywordLines = cleaned
    .split(/[\r\n]+/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => /(total|charged|amount|payment|receipt|refund|return|order total|tax|shipping|service fee)/i.test(line))
    .slice(0, 12)
    .join('\n');

  const classifierText = [normalizedSnippet, top, bottom && bottom !== top ? bottom : '']
    .filter(Boolean)
    .join('\n...\n')
    .slice(0, 2600);

  const extractionText = [normalizedSnippet, top, keywordLines, bottom && bottom !== top ? bottom : '']
    .filter(Boolean)
    .join('\n...\n')
    .slice(0, 3600);

  return { classifierText, extractionText };
}

function heuristicDisposition(subject = '', fromAddress = '', emailBody = '') {
  const signals = analyzeEmailSignals(subject, fromAddress, emailBody);
  if (!signals.shouldSurfaceToReview && signals.negativeSignals && !signals.strongMoneySignal && !signals.mediumMoneySignal) {
    return 'not_expense';
  }
  return null;
}

function parseJsonResponse(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!cleaned || cleaned === 'null') return null;
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function normalizeParsedPaymentFields(parsed = {}) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const paymentMethod = ['cash', 'credit', 'debit'].includes(parsed.payment_method) ? parsed.payment_method : null;
  const cardLabel = typeof parsed.card_label === 'string' && parsed.card_label.trim() ? parsed.card_label.trim() : null;
  const rawLast4 = typeof parsed.card_last4 === 'string' ? parsed.card_last4 : parsed.card_last4 != null ? String(parsed.card_last4) : '';
  const cardLast4 = /^\d{4}$/.test(rawLast4.trim()) ? rawLast4.trim() : null;
  return {
    ...parsed,
    payment_method: paymentMethod,
    card_label: cardLabel,
    card_last4: cardLast4,
  };
}

async function classifyEmailExpense(emailBody, subject, fromAddress, todayDate, snippet = '') {
  if (!emailBody || typeof emailBody !== 'string' || emailBody.trim().length === 0) {
    throw new Error('emailBody is required');
  }
  if (!todayDate || !/^\d{4}-\d{2}-\d{2}$/.test(todayDate)) {
    throw new Error('todayDate must be a valid ISO date string (YYYY-MM-DD)');
  }

  const heuristic = heuristicDisposition(subject, fromAddress, emailBody);
  if (heuristic) {
    return { disposition: heuristic, merchant: null, reason: 'heuristic_skip' };
  }

  const { classifierText } = selectRelevantEmailText(emailBody, snippet);
  const text = await complete({
    system: CLASSIFIER_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Subject: ${subject}\nFrom: ${fromAddress}\nToday: ${todayDate}\n\n${classifierText}`,
    }],
    maxTokens: 120,
  });

  const parsed = parseJsonResponse(text);
  if (!parsed?.disposition) return { disposition: 'uncertain', merchant: null, reason: 'classifier_parse_failed' };
  return {
    disposition: parsed.disposition,
    merchant: parsed.merchant || null,
    reason: parsed.reason || null,
  };
}

async function parseEmailExpense(emailBody, subject, fromAddress, todayDate, snippet = '') {
  if (!emailBody || typeof emailBody !== 'string' || emailBody.trim().length === 0) {
    throw new Error('emailBody is required');
  }
  if (!todayDate || !/^\d{4}-\d{2}-\d{2}$/.test(todayDate)) {
    throw new Error('todayDate must be a valid ISO date string (YYYY-MM-DD)');
  }

  const { extractionText } = selectRelevantEmailText(emailBody, snippet);

  const text = await complete({
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Subject: ${subject}\nFrom: ${fromAddress}\nToday: ${todayDate}\n\n${extractionText}`,
    }],
  });

  return normalizeParsedPaymentFields(parseJsonResponse(text));
}

function clampExpenseDate(candidateDate, maxDate) {
  if (!candidateDate || !/^\d{4}-\d{2}-\d{2}$/.test(candidateDate)) return maxDate;
  if (!maxDate || !/^\d{4}-\d{2}-\d{2}$/.test(maxDate)) return candidateDate;
  return candidateDate > maxDate ? maxDate : candidateDate;
}

module.exports = {
  parseEmailExpense,
  classifyEmailExpense,
  selectRelevantEmailText,
  heuristicDisposition,
  analyzeEmailSignals,
  classifyEmailModality,
  extractEmailLocationCandidate,
  clampExpenseDate,
};
