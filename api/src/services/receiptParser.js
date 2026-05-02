const { completeWithImage } = require('./ai');
const {
  receiptFamilyStrategiesMode,
} = require('./parsingOptimizationConfig');

const SYSTEM_PROMPT = `You are a receipt parser. Extract structured data from a receipt image.
Return ONLY a JSON object with these fields:
- merchant (string)
- amount (number): the total paid (including tax and fees)
- date (ISO date string YYYY-MM-DD)
- notes (string or null)
- payment_method (string or null): one of "cash", "credit", "debit", or null if not visible. Infer "visa", "mastercard", "amex", "credit" as credit; "debit" as debit.
- card_label (string or null): card brand or nickname shown on the receipt when visible (for example "Visa", "Amex Gold"). null if not visible.
- card_last4 (string or null): the final 4 digits of the card if visible. null if not visible.
- store_address (string or null): the physical store address if clearly visible on the receipt
- store_number (string or null): the store/location number if clearly visible on the receipt
- items (array or null): individual line items from the receipt, each as { "description": string, "amount": number or null }. Include up to 30 of the most legible product and fee lines you can read. Omit subtotal lines. If more than 30 items are visible, prefer the clearest rows and valid JSON over exhaustive extraction. Set to null if line items are not clearly visible.

If you cannot extract the data, return null.
Do not include any text outside the JSON object.`;

const FALLBACK_SYSTEM_PROMPT = `You are a receipt parser. Extract only the core purchase details from a receipt image.
Return ONLY a JSON object with these fields:
- merchant (string or null)
- amount (number or null): the final total paid
- date (ISO date string YYYY-MM-DD or null)
- notes (string or null)
- payment_method (string or null): one of "cash", "credit", "debit", or null if not visible
- card_label (string or null): card brand or nickname shown on the receipt when visible
- card_last4 (string or null): the final 4 digits of the card if visible
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
    const endsAbruptly = extracted.trim().startsWith('{') && !extracted.trim().endsWith('}');
    const repaired = repairJsonCandidate(extracted);
    try {
      return { raw: JSON.parse(repaired), parser_mode: 'extracted' };
    } catch {
      return { raw: null, parser_mode: endsAbruptly ? 'truncated' : 'invalid' };
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
  const paymentMethod = ['cash', 'credit', 'debit'].includes(parsed.payment_method) ? parsed.payment_method : null;
  const cardLabel = typeof parsed.card_label === 'string' && parsed.card_label.trim() ? parsed.card_label.trim() : null;
  const cardLast4Raw = typeof parsed.card_last4 === 'string' ? parsed.card_last4 : parsed.card_last4 != null ? String(parsed.card_last4) : '';
  const cardLast4 = /^\d{4}$/.test(cardLast4Raw.trim()) ? cardLast4Raw.trim() : null;

  const normalized = {
    merchant: merchant || null,
    amount: Number.isFinite(amount) && amount !== 0 ? amount : null,
    date: hasValidDate ? rawDate : todayDate,
    notes: typeof parsed.notes === 'string' && parsed.notes.trim() ? parsed.notes.trim() : null,
    payment_method: paymentMethod,
    card_label: cardLabel,
    card_last4: cardLast4,
    store_address: typeof parsed.store_address === 'string' && parsed.store_address.trim() ? parsed.store_address.trim() : null,
    store_number: typeof parsed.store_number === 'string' && parsed.store_number.trim() ? parsed.store_number.trim() : null,
    items,
  };

  const review_fields = [];
  const field_confidence = {
    merchant: normalized.merchant ? 'high' : 'low',
    amount: normalized.amount != null ? 'high' : 'low',
    date: hasValidDate ? 'high' : 'medium',
    payment_method: normalized.payment_method ? 'medium' : 'low',
    card_label: normalized.card_label ? 'medium' : 'low',
    card_last4: normalized.card_last4 ? 'high' : 'low',
    items: items?.length ? 'medium' : 'low',
  };

  if (!normalized.merchant) review_fields.push('merchant');
  if (normalized.amount == null) review_fields.push('amount');
  if (!hasValidDate) review_fields.push('date');
  if (!items?.length) review_fields.push('items');
  if (!normalized.payment_method && (normalized.card_label || normalized.card_last4)) review_fields.push('payment method');

  if (normalized.amount == null) return null;

  return {
    ...normalized,
    parse_status: review_fields.length > 0 ? 'partial' : 'complete',
    review_fields,
    field_confidence,
  };
}

function normalizeComparableText(value) {
  return `${value || ''}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function classifyReceiptFamily({ merchant = '', items = [], priors = [] } = {}) {
  const merchantText = normalizeComparableText(merchant);
  const itemText = Array.isArray(items)
    ? items.map((item) => normalizeComparableText(item?.description || '')).join(' ')
    : '';
  const priorText = Array.isArray(priors)
    ? priors.map((value) => normalizeComparableText(value)).join(' ')
    : '';
  const corpus = [merchantText, itemText, priorText].filter(Boolean).join(' ');

  const rules = [
    { family: 'grocery_receipt', confidence: 'high', pattern: /\b(whole foods|trader joes|trader joe s|aldi|kroger|safeway|publix|wegmans|food lion|produce|bananas|milk|eggs|feta|lasagne|lasagna)\b/ },
    { family: 'restaurant_receipt', confidence: 'high', pattern: /\b(starbucks|chipotle|sweetgreen|restaurant|cafe|pizza|burger|sushi|coffee|latte)\b/ },
    { family: 'pharmacy_receipt', confidence: 'high', pattern: /\b(cvs|walgreens|rite aid|pharmacy|prescription|medicine)\b/ },
    { family: 'gas_receipt', confidence: 'high', pattern: /\b(shell|chevron|exxon|bp|mobil|sunoco|fuel|gallons)\b/ },
    { family: 'big_box_retail_receipt', confidence: 'medium', pattern: /\b(target|walmart|costco|home depot|lowes|lowe s)\b/ },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(corpus)) return { family: rule.family, confidence: rule.confidence };
  }

  return { family: 'generic_receipt', confidence: 'low' };
}

function buildPrimaryPrompt(todayDate, priors = [], familyHint = null) {
  const priorSection = Array.isArray(priors) && priors.length
    ? `\nKnown household purchase priors:\n- ${priors.join('\n- ')}\nUse these only to disambiguate uncertain merchant abbreviations or product lines. Do not invent unseen items.`
    : '';
  const familySection = familyHint && receiptFamilyStrategiesMode() !== 'off'
    ? `\nLikely receipt family: ${familyHint.family}. Use that as a soft hint only if it helps extract merchant, total, and line items more cleanly.`
    : '';
  return `Today's date: ${todayDate}. Extract expense data from this receipt.${familySection}${priorSection}`;
}

async function parseReceipt(imageBase64, todayDate, options = {}) {
  const result = await parseReceiptDetailed(imageBase64, todayDate, options);
  return result.parsed;
}

function buildFallbackPrompt(todayDate, priors = [], familyHint = null) {
  const priorSection = Array.isArray(priors) && priors.length
    ? `\nKnown household purchase priors:\n- ${priors.join('\n- ')}\nUse these only to disambiguate uncertain line items or merchant abbreviations. Do not invent unseen items.`
    : '';
  const familySection = familyHint && receiptFamilyStrategiesMode() !== 'off'
    ? ` This likely behaves like a ${familyHint.family.replace(/_/g, ' ')}.`
    : '';
  return `Today's date: ${todayDate}. Extract the merchant, final total, date, and up to 30 obvious line items from this receipt.${familySection} If more than 30 items are visible or item details are messy, still prioritize merchant, final total, and valid JSON over exhaustive extraction.${priorSection}`;
}

async function parseReceiptDetailed(imageBase64, todayDate, options = {}) {
  const startedAt = Date.now();
  const priors = Array.isArray(options?.priors) ? options.priors.filter(Boolean) : [];
  const passMode = options?.passMode || 'full';
  const familyHint = options?.familyHint || null;
  const shouldRunPrimary = passMode !== 'fallback_only';
  const shouldRunFallback = passMode !== 'primary_only';
  if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.trim().length === 0) {
    throw new Error('imageBase64 must be a non-empty string');
  }

  if (!todayDate || !/^\d{4}-\d{2}-\d{2}$/.test(todayDate)) {
    throw new Error('todayDate must be a valid ISO date string (YYYY-MM-DD)');
  }

  let text = null;
  let primaryDurationMs = 0;
  if (shouldRunPrimary) {
    const primaryStartedAt = Date.now();
    text = await completeWithImage({
      system: SYSTEM_PROMPT,
      imageBase64,
      text: buildPrimaryPrompt(todayDate, priors, familyHint),
      maxTokens: 1400,
    });
    primaryDurationMs = Date.now() - primaryStartedAt;
  }

  if (shouldRunPrimary && !text) {
    return {
      parsed: null,
      failureReason: 'empty_model_response',
      raw: null,
      diagnostics: buildReceiptDiagnostics(imageBase64, null, {
        response_length: 0,
        raw_text_preview: null,
        parser_mode: 'empty',
        primary_duration_ms: primaryDurationMs,
        fallback_duration_ms: 0,
        model_call_count: shouldRunPrimary ? 1 : 0,
        total_parse_duration_ms: Date.now() - startedAt,
      }),
    };
  }

  const { raw, parser_mode } = shouldRunPrimary
    ? parseJsonWithRecovery(text)
    : { raw: null, parser_mode: 'skipped' };
  const familyClassification = classifyReceiptFamily({
    merchant: raw?.merchant || familyHint?.merchant || '',
    items: raw?.items || [],
    priors,
  });
  const diagnostics = buildReceiptDiagnostics(imageBase64, raw, {
    response_length: text ? `${text}`.length : 0,
    raw_text_preview: text ? clipTextPreview(text) : null,
    parser_mode,
    fallback_attempted: shouldRunFallback && !shouldRunPrimary ? true : false,
    fallback_succeeded: false,
    context_prior_count: priors.length,
    primary_duration_ms: primaryDurationMs,
    fallback_duration_ms: 0,
    model_call_count: shouldRunPrimary ? 1 : 0,
    receipt_family: familyClassification.family,
    receipt_family_confidence: familyClassification.confidence,
    receipt_family_mode: receiptFamilyStrategiesMode(),
    pass_mode: passMode,
  });

  const primaryParsed = raw ? cleanParsedReceipt(raw, todayDate) : null;
  if (primaryParsed) {
    return {
      parsed: primaryParsed,
      failureReason: null,
      raw,
      diagnostics: {
        ...diagnostics,
        total_parse_duration_ms: Date.now() - startedAt,
      },
    };
  }

  let primaryFailureReason = parser_mode === 'truncated' ? 'truncated_model_output' : 'invalid_model_json';
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

  if (!shouldRunFallback) {
    return {
      parsed: null,
      failureReason: primaryFailureReason,
      raw,
      diagnostics: {
        ...diagnostics,
        total_parse_duration_ms: Date.now() - startedAt,
      },
    };
  }

  const fallbackStartedAt = Date.now();
  const fallbackText = await completeWithImage({
    system: FALLBACK_SYSTEM_PROMPT,
    imageBase64,
    text: buildFallbackPrompt(todayDate, priors, familyHint || familyClassification),
    maxTokens: 1200,
  });
  const fallbackDurationMs = Date.now() - fallbackStartedAt;

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
        fallback_duration_ms: fallbackDurationMs,
        model_call_count: (diagnostics.model_call_count || 0) + 1,
        total_parse_duration_ms: Date.now() - startedAt,
      },
    };
  }

  const { raw: fallbackRaw, parser_mode: fallbackParserMode } = parseJsonWithRecovery(fallbackText);
  const fallbackFamilyClassification = classifyReceiptFamily({
    merchant: fallbackRaw?.merchant || raw?.merchant || '',
    items: fallbackRaw?.items || [],
    priors,
  });
  const fallbackDiagnostics = buildReceiptDiagnostics(imageBase64, fallbackRaw, {
    ...diagnostics,
    fallback_attempted: true,
    fallback_succeeded: false,
    fallback_response_length: `${fallbackText}`.length,
    fallback_raw_text_preview: clipTextPreview(fallbackText),
    fallback_parser_mode: fallbackParserMode,
    fallback_duration_ms: fallbackDurationMs,
    model_call_count: (diagnostics.model_call_count || 0) + 1,
    receipt_family: fallbackFamilyClassification.family,
    receipt_family_confidence: fallbackFamilyClassification.confidence,
  });

  if (!fallbackRaw) {
    return {
      parsed: null,
      failureReason:
        primaryFailureReason === 'truncated_model_output' || fallbackParserMode === 'truncated'
          ? 'truncated_model_output'
          : primaryFailureReason === 'invalid_model_json'
            ? 'invalid_model_json'
            : primaryFailureReason,
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
        total_parse_duration_ms: Date.now() - startedAt,
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
    diagnostics: {
      ...fallbackDiagnostics,
      total_parse_duration_ms: Date.now() - startedAt,
    },
  };
}

module.exports = {
  parseReceipt,
  parseReceiptDetailed,
  cleanParsedReceipt,
  parseJsonWithRecovery,
};
