const { completeWithImage } = require('./ai');

const SYSTEM_PROMPT = `You are a receipt parser. Extract structured data from a receipt image.
Return ONLY a JSON object with these fields:
- merchant (string)
- amount (number): the total paid (including tax and fees)
- date (ISO date string YYYY-MM-DD)
- notes (string or null)
- store_address (string or null): the physical store address if clearly visible on the receipt
- store_number (string or null): the store/location number if clearly visible on the receipt
- items (array or null): individual line items from the receipt, each as { "description": string, "amount": number or null, "upc": string or null, "sku": string or null, "brand": string or null, "product_size": string or null, "pack_size": string or null, "unit": string or null }. Include product lines AND fees (tax, tip, service charge, etc.) as separate named items so that the items sum to the total amount. Omit subtotal lines (they are redundant). For fee/tax/tip lines set upc/sku/brand/product_size/pack_size/unit to null. Set to null if line items are not clearly visible.

If you cannot extract the data, return null.
Do not include any text outside the JSON object.`;

const FALLBACK_SYSTEM_PROMPT = `You are a receipt parser. Extract only the core purchase details from a receipt image.
Return ONLY a JSON object with these fields:
- merchant (string or null)
- amount (number or null): the final total paid
- date (ISO date string YYYY-MM-DD or null)
- notes (string or null)
- store_address (string or null)
- store_number (string or null)
- items (array or null): simple visible line items as { "description": string, "amount": number or null }. Do not include product metadata. If items are unclear, return null.

Prioritize finding the final total and merchant correctly even if items are incomplete.
If you cannot extract the data, return null.
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

function buildReceiptDiagnostics(imageBase64, raw = null, extra = {}) {
  const rawObject = raw && typeof raw === 'object' ? raw : null;
  const rawKeys = rawObject ? Object.keys(rawObject).sort() : [];
  const rawAmount = rawObject ? Number(rawObject.amount) : null;
  const rawMerchant = rawObject && typeof rawObject.merchant === 'string' ? rawObject.merchant.trim() : '';
  const rawItems = Array.isArray(rawObject?.items) ? rawObject.items : [];
  const serialized = `${imageBase64 || ''}`;

  return {
    image_size: serialized.length,
    raw_present: Boolean(rawObject),
    raw_keys: rawKeys,
    raw_amount_present: Number.isFinite(rawAmount) && rawAmount !== 0,
    raw_merchant_present: Boolean(rawMerchant),
    raw_items_count: rawItems.length,
    raw_store_address_present: Boolean(rawObject?.store_address),
    raw_store_number_present: Boolean(rawObject?.store_number),
    ...extra,
  };
}

function cleanParsedReceipt(parsed, todayDate) {
  if (!parsed || typeof parsed !== 'object') return null;

  const merchant = typeof parsed.merchant === 'string' ? parsed.merchant.trim() : '';
  const amount = Number(parsed.amount);
  const rawDate = typeof parsed.date === 'string' ? parsed.date.trim() : '';
  const hasValidDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate);
  const items = Array.isArray(parsed.items) ? parsed.items : null;

  const normalized = {
    merchant: merchant || null,
    amount: Number.isFinite(amount) && amount !== 0 ? amount : null,
    date: hasValidDate ? rawDate : todayDate,
    notes: typeof parsed.notes === 'string' && parsed.notes.trim() ? parsed.notes.trim() : null,
    store_address: typeof parsed.store_address === 'string' && parsed.store_address.trim() ? parsed.store_address.trim() : null,
    store_number: typeof parsed.store_number === 'string' && parsed.store_number.trim() ? parsed.store_number.trim() : null,
    items,
  };

  const review_fields = [];
  const field_confidence = {
    merchant: normalized.merchant ? 'high' : 'low',
    amount: normalized.amount != null ? 'high' : 'low',
    date: hasValidDate ? 'high' : 'medium',
    items: items?.length ? 'medium' : 'low',
  };

  if (!normalized.merchant) review_fields.push('merchant');
  if (normalized.amount == null) review_fields.push('amount');
  if (!hasValidDate) review_fields.push('date');
  if (!items?.length) review_fields.push('items');

  if (normalized.amount == null) return null;

  return {
    ...normalized,
    parse_status: review_fields.length > 0 ? 'partial' : 'complete',
    review_fields,
    field_confidence,
  };
}

async function parseReceipt(imageBase64, todayDate) {
  const result = await parseReceiptDetailed(imageBase64, todayDate);
  return result.parsed;
}

async function parseReceiptDetailed(imageBase64, todayDate) {
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

  if (!text) {
    return {
      parsed: null,
      failureReason: 'empty_model_response',
      raw: null,
      diagnostics: buildReceiptDiagnostics(imageBase64, null, {
        response_length: 0,
        raw_text_preview: null,
        parser_mode: 'empty',
      }),
    };
  }

  const { raw, parser_mode } = parseJsonWithRecovery(text);
  const diagnostics = buildReceiptDiagnostics(imageBase64, raw, {
    response_length: `${text}`.length,
    raw_text_preview: clipTextPreview(text),
    parser_mode,
    fallback_attempted: false,
    fallback_succeeded: false,
  });

  const primaryParsed = raw ? cleanParsedReceipt(raw, todayDate) : null;
  if (primaryParsed) return { parsed: primaryParsed, failureReason: null, raw, diagnostics };

  let primaryFailureReason = 'invalid_model_json';
  if (raw) {
    const amount = Number(raw?.amount);
    const merchant = typeof raw?.merchant === 'string' ? raw.merchant.trim() : '';
    primaryFailureReason = 'missing_required_fields';
    if (!Number.isFinite(amount) || amount === 0) {
      primaryFailureReason = 'missing_total';
    } else if (!merchant) {
      primaryFailureReason = 'missing_required_fields';
    }
  }

  const fallbackText = await completeWithImage({
    system: FALLBACK_SYSTEM_PROMPT,
    imageBase64,
    text: `Today's date: ${todayDate}. Extract the merchant, final total, date, and any obvious line items from this grocery receipt. If item details are messy, still prioritize merchant and final total.`,
  });

  if (!fallbackText) {
    return {
      parsed: null,
      failureReason: primaryFailureReason,
      raw,
      diagnostics: {
        ...diagnostics,
        fallback_attempted: true,
        fallback_succeeded: false,
        fallback_response_length: 0,
        fallback_raw_text_preview: null,
        fallback_parser_mode: 'empty',
      },
    };
  }

  const { raw: fallbackRaw, parser_mode: fallbackParserMode } = parseJsonWithRecovery(fallbackText);
  const fallbackDiagnostics = buildReceiptDiagnostics(imageBase64, fallbackRaw, {
    ...diagnostics,
    fallback_attempted: true,
    fallback_succeeded: false,
    fallback_response_length: `${fallbackText}`.length,
    fallback_raw_text_preview: clipTextPreview(fallbackText),
    fallback_parser_mode: fallbackParserMode,
  });

  if (!fallbackRaw) {
    return {
      parsed: null,
      failureReason: primaryFailureReason === 'invalid_model_json' ? 'invalid_model_json' : primaryFailureReason,
      raw,
      diagnostics: fallbackDiagnostics,
    };
  }

  const fallbackParsed = cleanParsedReceipt(fallbackRaw, todayDate);
  if (fallbackParsed) {
    return {
      parsed: fallbackParsed,
      failureReason: null,
      raw: fallbackRaw,
      diagnostics: {
        ...fallbackDiagnostics,
        fallback_succeeded: true,
        parser_mode: diagnostics.parser_mode,
      },
    };
  }

  const fallbackAmount = Number(fallbackRaw?.amount);
  const fallbackMerchant = typeof fallbackRaw?.merchant === 'string' ? fallbackRaw.merchant.trim() : '';
  let fallbackFailureReason = 'missing_required_fields';
  if (!Number.isFinite(fallbackAmount) || fallbackAmount === 0) {
    fallbackFailureReason = 'missing_total';
  } else if (!fallbackMerchant) {
    fallbackFailureReason = 'missing_required_fields';
  }

  return {
    parsed: null,
    failureReason: fallbackFailureReason,
    raw: fallbackRaw,
    diagnostics: fallbackDiagnostics,
  };
}

module.exports = {
  parseReceipt,
  parseReceiptDetailed,
  cleanParsedReceipt,
  parseJsonWithRecovery,
};
