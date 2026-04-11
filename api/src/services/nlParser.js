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

function clipTextPreview(text, max = 600) {
  const value = `${text || ''}`.trim();
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function extractJSONObjectCandidate(text) {
  const source = `${text || ''}`;
  const start = source.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  return source.slice(start).trim() || null;
}

function repairJsonCandidate(text) {
  let candidate = `${text || ''}`.trim();
  if (!candidate) return null;
  candidate = candidate.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  candidate = candidate.replace(/,\s*([}\]])/g, '$1');
  return candidate;
}

function parseJsonWithRecovery(text) {
  const cleaned = repairJsonCandidate(text);
  if (!cleaned || cleaned === 'null') {
    return { raw: null, parser_mode: 'empty' };
  }

  try {
    return { raw: JSON.parse(cleaned), parser_mode: 'direct' };
  } catch {
    const extracted = extractJSONObjectCandidate(cleaned);
    if (!extracted) return { raw: null, parser_mode: 'invalid' };
    const repaired = repairJsonCandidate(extracted);
    try {
      return { raw: JSON.parse(repaired), parser_mode: 'extracted' };
    } catch {
      return { raw: null, parser_mode: 'invalid' };
    }
  }
}

function buildNlDiagnostics(input, raw = null) {
  const text = `${input || ''}`.trim();
  const normalized = text.toLowerCase();
  const rawObject = raw && typeof raw === 'object' ? raw : null;
  const rawKeys = rawObject ? Object.keys(rawObject).sort() : [];
  const rawAmount = rawObject ? Number(rawObject.amount) : null;
  const rawMerchant = rawObject && typeof rawObject.merchant === 'string' ? rawObject.merchant.trim() : '';
  const rawDescription = rawObject && typeof rawObject.description === 'string' ? rawObject.description.trim() : '';

  return {
    input_length: text.length,
    token_count: text ? text.split(/\s+/).length : 0,
    had_numeric_token: /-?\$?\d+(?:\.\d{1,2})?/.test(text),
    had_date_like_token: /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)\b/.test(text),
    had_payment_hint: /\b(cash|debit|credit|visa|mastercard|amex|american express)\b/.test(normalized),
    raw_present: Boolean(rawObject),
    raw_keys: rawKeys,
    raw_amount_present: Number.isFinite(rawAmount) && rawAmount !== 0,
    raw_merchant_present: Boolean(rawMerchant),
    raw_description_present: Boolean(rawDescription),
  };
}

function titleCaseWords(value) {
  return `${value || ''}`
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function extractPersonPaymentPayload(prefixPattern, description) {
  const match = `${description || ''}`.trim().match(prefixPattern);
  if (!match) return null;

  const remainder = `${match[1] || ''}`.trim();
  if (!remainder) return null;

  const [personSegment, ...tailSegments] = remainder.split(/\s+for\s+/i);
  const personName = titleCaseWords(personSegment.trim());
  if (!personName) return null;

  return {
    merchant: personName,
    description: tailSegments.join(' for ').trim() || description,
  };
}

function normalizePersonPaymentFields({ merchant, description, notes }) {
  const cleanMerchant = `${merchant || ''}`.trim();
  const cleanDescription = `${description || ''}`.trim();
  const cleanNotes = `${notes || ''}`.trim();

  if (cleanMerchant || !cleanDescription) {
    return {
      merchant: cleanMerchant || null,
      description: cleanDescription || null,
      notes: cleanNotes || null,
      counterparty_type: null,
      merchant_source: cleanMerchant ? 'model' : null,
    };
  }

  const patterns = [
    /^(?:payment|pay(?:ment)?)\s+to\s+(.+)$/i,
    /^(?:paid|pay)\s+(.+?)(?:\s+back)?$/i,
    /^(?:venmo|zelle|paypal)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const payload = extractPersonPaymentPayload(pattern, cleanDescription);
    if (!payload) continue;
    return {
      merchant: payload.merchant || null,
      description: payload.description || cleanDescription,
      notes: cleanNotes || cleanDescription,
      counterparty_type: 'person',
      merchant_source: 'person_payment_promotion',
    };
  }

  return {
    merchant: null,
    description: cleanDescription || null,
    notes: cleanNotes || null,
    counterparty_type: null,
    merchant_source: null,
  };
}

function cleanParsedExpense(parsed, todayDate) {
  if (!parsed || typeof parsed !== 'object') return null;

  const merchant = typeof parsed.merchant === 'string' ? parsed.merchant.trim() : '';
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
  const amount = Number(parsed.amount);
  const rawDate = typeof parsed.date === 'string' ? parsed.date.trim() : '';
  const hasValidDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate);
  const items = Array.isArray(parsed.items) ? parsed.items : null;
  const paymentMethod = ['cash', 'credit', 'debit'].includes(parsed.payment_method) ? parsed.payment_method : null;
  const cardLabel = typeof parsed.card_label === 'string' && parsed.card_label.trim() ? parsed.card_label.trim() : null;
  const noteText = typeof parsed.notes === 'string' && parsed.notes.trim() ? parsed.notes.trim() : null;
  const normalizedPartyFields = normalizePersonPaymentFields({
    merchant,
    description,
    notes: noteText,
  });

  const normalized = {
    merchant: normalizedPartyFields.merchant,
    description: normalizedPartyFields.description,
    amount: Number.isFinite(amount) && amount !== 0 ? amount : null,
    date: hasValidDate ? rawDate : todayDate,
    notes: normalizedPartyFields.notes,
    counterparty_type: normalizedPartyFields.counterparty_type,
    merchant_source: normalizedPartyFields.merchant_source,
    payment_method: paymentMethod,
    card_label: cardLabel,
    items,
  };

  const review_fields = [];
  const field_confidence = {
    merchant: normalized.merchant ? 'high' : (normalized.description ? 'medium' : 'low'),
    description: normalized.description ? 'high' : (normalized.merchant ? 'medium' : 'low'),
    amount: normalized.amount != null ? 'high' : 'low',
    date: hasValidDate ? 'high' : 'medium',
    payment_method: normalized.payment_method ? 'medium' : 'low',
    card_label: normalized.card_label ? 'medium' : 'low',
    items: items?.length ? 'medium' : 'low',
  };

  if (!normalized.merchant && !normalized.description) review_fields.push('merchant or description');
  if (normalized.amount == null) review_fields.push('amount');
  if (!hasValidDate) review_fields.push('date');
  if (!normalized.payment_method && normalized.card_label) review_fields.push('payment method');

  if (normalized.amount == null || (!normalized.merchant && !normalized.description)) {
    return null;
  }

  return {
    ...normalized,
    parse_status: review_fields.length > 0 ? 'partial' : 'complete',
    review_fields,
    field_confidence,
  };
}

async function parseExpense(input, todayDate) {
  const result = await parseExpenseDetailed(input, todayDate);
  return result.parsed;
}

async function parseExpenseDetailed(input, todayDate) {
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return { parsed: null, failureReason: 'missing_required_fields', raw: null, diagnostics: buildNlDiagnostics(input) };
  }

  // Validate todayDate is an ISO date string (YYYY-MM-DD)
  if (!todayDate || !/^\d{4}-\d{2}-\d{2}$/.test(todayDate)) {
    throw new Error('todayDate must be a valid ISO date string (YYYY-MM-DD)');
  }

  const text = await complete({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Today's date: ${todayDate}\nExpense input: ${input}` }],
  });

  if (!text) {
    return {
      parsed: null,
      failureReason: 'empty_model_response',
      raw: null,
      diagnostics: buildNlDiagnostics(input),
    };
  }

  const { raw, parser_mode } = parseJsonWithRecovery(text);
  const baseDiagnostics = {
    raw_text_preview: clipTextPreview(text),
    response_length: text.length,
    parser_mode,
  };
  if (!raw) {
    return {
      parsed: null,
      failureReason: parser_mode === 'empty' ? 'empty_model_response' : 'invalid_model_json',
      raw: null,
      diagnostics: { ...buildNlDiagnostics(input), ...baseDiagnostics },
    };
  }

  const parsed = cleanParsedExpense(raw, todayDate);
  const diagnostics = { ...buildNlDiagnostics(input, raw), ...baseDiagnostics };
  if (parsed) return { parsed, failureReason: null, raw, diagnostics };

  const amount = Number(raw?.amount);
  const merchant = typeof raw?.merchant === 'string' ? raw.merchant.trim() : '';
  const description = typeof raw?.description === 'string' ? raw.description.trim() : '';

  let failureReason = 'missing_required_fields';
  if (!Number.isFinite(amount) || amount === 0) {
    failureReason = (!merchant && !description) ? 'missing_required_fields' : 'missing_amount';
  } else if (!merchant && !description) {
    failureReason = 'missing_merchant_or_description';
  }

  return { parsed: null, failureReason, raw, diagnostics };
}

module.exports = {
  parseExpense,
  parseExpenseDetailed,
  cleanParsedExpense,
  parseJsonWithRecovery,
  normalizePersonPaymentFields,
};
