const { completeWithImageDetailed } = require('./ai');
const {
  receiptFamilyStrategiesMode,
} = require('./parsingOptimizationConfig');
const { cleanMerchantDisplayName, canonicalMerchantKey } = require('./merchantIdentity');
const { cleanItemDescription, normalizeItemDisplayName } = require('./itemNormalizer');

const SYSTEM_PROMPT = `You are a receipt parser. Extract structured data from a receipt image.
Return only the JSON object required by the response schema. Extract:
- merchant (string): the store, restaurant, or service name only. Do not use a payment processor, slogan, address, store number, survey prompt, or feedback request as the merchant. Stop before phrases such as "let us know how your visit went", "share your feedback", or "take our survey".
- amount (number): the final amount actually paid, including tax, tip, and fees. Do not use subtotal, cash tendered, change, balance, savings, or a pre-authorization. Use a negative amount only for a clearly printed refund or return total.
- date (ISO date string YYYY-MM-DD): the transaction date, not a print date, loyalty date, or promotion date
- notes (string): only explicit purchase context that does not belong in another field; otherwise use an empty string
- currency (three-letter ISO currency code or null)
- subtotal, tax, tip, fees, discounts (number or null). Subtotal is the printed net subtotal immediately before tax, tip, and fees. Discounts is the positive magnitude of printed savings and is informational; do not subtract it from subtotal again.
- transaction_id (string or null): receipt, transaction, order, or reference identifier only when clearly visible
- purchase_time (24-hour HH:MM string or null)
- payment_method (string or null): one of "cash", "credit", "debit", or null if not visible. Infer "visa", "mastercard", "amex", "credit" as credit; "debit" as debit.
- card_label (string or null): card brand or nickname shown on the receipt when visible (for example "Visa", "Amex Gold"). null if not visible.
- card_last4 (string or null): the final 4 digits of the card if visible. null if not visible.
- store_address (string or null): the physical store address if clearly visible on the receipt
- store_number (string or null): the store/location number if clearly visible on the receipt
- items (array): up to 30 legible purchased product or service rows, or an empty array when no rows are legible. Do not include subtotal, total, tax, tip, fees, discounts, coupons, payment, cash tendered, change, slogans, or survey prompts. description is the purchased item name only. amount is the row's extended line total after any line-level discount, not the unit price. quantity is the printed count or weight and unit_price is the printed price per count or weight. pricing_unit is the visible basis for unit_price such as each, lb, oz, or kg. Keep unknown numeric fields at 0 and unknown text fields as an empty string. When clearly visible, also include item_type, brand, product_size, pack_size, unit, upc, and sku. Never infer UPC or SKU.
- items_truncated (boolean): true when more legible product rows are visible than fit in the items array
- visible_item_count (number): best count of visible product rows, including rows omitted because of the 30-item limit
- uncertain_fields (array): every field whose value is ambiguous in the image

If you cannot extract a nullable field, return null. Use the empty values described above for required non-null fields. Never invent a value.
Do not include any text outside the JSON object.`;

const FALLBACK_SYSTEM_PROMPT = `You are a receipt parser. Extract only the core purchase details from a receipt image.
Return ONLY a JSON object with these fields:
- merchant (string or null)
- amount (number or null): the final amount actually paid, not subtotal, cash tendered, change, or savings
- date (ISO date string YYYY-MM-DD or null): the transaction date
- notes (string): use an empty string when absent
- payment_method (string or null): one of "cash", "credit", "debit", or null if not visible
- card_label (string or null): card brand or nickname shown on the receipt when visible
- card_last4 (string or null): the final 4 digits of the card if visible
- store_address (string or null)
- store_number (string or null)
- items (array): simple purchased product or service rows as { "description": string, "amount": number }, where amount is the extended line total. Exclude subtotal, total, tax, tip, fees, discounts, payment, cash tendered, and change. If items are unclear, return an empty array.
- items_truncated (boolean): true when more legible product rows are visible than fit in the items array
- visible_item_count (number): best count of visible product rows
- uncertain_fields (array): any returned field whose value is ambiguous

Prioritize finding the final total and merchant correctly even if items are incomplete.
If you cannot extract a nullable field, return null. Never invent a value.
Do not include any text outside the JSON object.`;

const NULLABLE_STRING = { type: ['string', 'null'] };
const NULLABLE_NUMBER = { type: ['number', 'null'] };
const UNCERTAIN_FIELD_NAMES = [
  'merchant', 'amount', 'date', 'items', 'currency', 'subtotal', 'tax', 'tip',
  'fees', 'discounts', 'transaction_id', 'purchase_time', 'payment_method',
  'card_label', 'card_last4', 'store_address', 'store_number',
];
const RECEIPT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    merchant: NULLABLE_STRING,
    amount: NULLABLE_NUMBER,
    date: NULLABLE_STRING,
    notes: { type: 'string' },
    currency: NULLABLE_STRING,
    subtotal: NULLABLE_NUMBER,
    tax: NULLABLE_NUMBER,
    tip: NULLABLE_NUMBER,
    fees: NULLABLE_NUMBER,
    discounts: NULLABLE_NUMBER,
    transaction_id: NULLABLE_STRING,
    purchase_time: NULLABLE_STRING,
    payment_method: NULLABLE_STRING,
    card_label: NULLABLE_STRING,
    card_last4: NULLABLE_STRING,
    store_address: NULLABLE_STRING,
    store_number: NULLABLE_STRING,
    uncertain_fields: {
      type: 'array',
      items: { type: 'string', enum: UNCERTAIN_FIELD_NAMES },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: { type: 'string' },
          amount: { type: 'number' },
          quantity: { type: 'number' },
          unit_price: { type: 'number' },
          pricing_unit: { type: 'string' },
          item_type: { type: 'string', enum: ['product', 'fee', 'tax', 'discount', 'summary', ''] },
          brand: { type: 'string' },
          product_size: { type: 'string' },
          pack_size: { type: 'string' },
          unit: { type: 'string' },
          upc: { type: 'string' },
          sku: { type: 'string' },
        },
        required: [
          'description', 'amount', 'quantity', 'unit_price', 'pricing_unit', 'item_type', 'brand',
          'product_size', 'pack_size', 'unit', 'upc', 'sku',
        ],
      },
    },
    items_truncated: { type: 'boolean' },
    visible_item_count: { type: 'number' },
  },
  required: [
    'merchant', 'amount', 'date', 'notes', 'currency', 'subtotal', 'tax', 'tip',
    'fees', 'discounts', 'transaction_id', 'purchase_time', 'payment_method',
    'card_label', 'card_last4', 'store_address', 'store_number', 'uncertain_fields',
    'items', 'items_truncated', 'visible_item_count',
  ],
};

const FALLBACK_RECEIPT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    merchant: NULLABLE_STRING,
    amount: NULLABLE_NUMBER,
    date: NULLABLE_STRING,
    notes: { type: 'string' },
    payment_method: NULLABLE_STRING,
    card_label: NULLABLE_STRING,
    card_last4: NULLABLE_STRING,
    store_address: NULLABLE_STRING,
    store_number: NULLABLE_STRING,
    uncertain_fields: {
      type: 'array',
      items: { type: 'string', enum: UNCERTAIN_FIELD_NAMES },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: { type: 'string' },
          amount: { type: 'number' },
        },
        required: ['description', 'amount'],
      },
    },
    items_truncated: { type: 'boolean' },
    visible_item_count: { type: 'number' },
  },
  required: [
    'merchant', 'amount', 'date', 'notes', 'payment_method', 'card_label',
    'card_last4', 'store_address', 'store_number', 'uncertain_fields', 'items',
    'items_truncated', 'visible_item_count',
  ],
};

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

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function isPlausibleReceiptDate(value, todayDate) {
  if (!isValidIsoDate(value) || !isValidIsoDate(todayDate)) return false;
  const receiptTime = new Date(`${value}T12:00:00Z`).getTime();
  const todayTime = new Date(`${todayDate}T12:00:00Z`).getTime();
  return receiptTime <= todayTime + 24 * 60 * 60 * 1000;
}

function inferredReceiptItemType(item = {}) {
  const declaredType = `${item?.item_type || ''}`.trim().toLowerCase();
  if (['fee', 'tax', 'discount', 'summary'].includes(declaredType)) return declaredType;
  const description = `${item?.description || ''}`.trim().toLowerCase();
  if (!description) return null;
  if (/^(?:sub\s*total|grand total|order total|total|amount (?:paid|due|charged)|balance|payment|cash|tendered|change)\b/.test(description)) return 'summary';
  if (/^(?:(?:sales|state|local)\s+tax|tax(?:\s+\d+(?:\.\d+)?\s*%)?|gst|hst|pst|vat)$/.test(description)) return 'tax';
  if (/^(?:tip|gratuity|service charge|service fee|delivery fee|shipping|handling|processing fee|bag fee|surcharge)\b/.test(description)) return 'fee';
  if (/^(?:discount|coupon|savings|promo|reward|loyalty|markdown)\b/.test(description)) return 'discount';
  return 'product';
}

function normalizeReceiptItems(items) {
  if (!Array.isArray(items)) return null;
  const normalized = items.slice(0, 30).map((item) => {
    const rawDescription = optionalString(item?.description);
    const description = normalizeItemDisplayName(cleanItemDescription(rawDescription));
    if (!description) return null;
    const itemType = inferredReceiptItemType(item);
    if (itemType !== 'product') return null;
    const parsedAmount = optionalNumber(item?.amount);
    const amount = parsedAmount === 0 ? null : parsedAmount;
    const quantity = optionalNumber(item?.quantity);
    const parsedUnitPrice = optionalNumber(item?.unit_price);
    const unitPrice = parsedUnitPrice === 0 ? null : parsedUnitPrice;
    const hasItemMathMismatch = amount != null
      && quantity != null
      && quantity > 0
      && unitPrice != null
      && !amountsApproximatelyEqual(quantity * unitPrice, amount, amount);
    return {
      description,
      amount,
      quantity: quantity != null && quantity > 0 ? quantity : null,
      unit_price: unitPrice,
      pricing_unit: optionalString(item?.pricing_unit),
      item_type: 'product',
      brand: optionalString(item?.brand),
      product_size: optionalString(item?.product_size),
      pack_size: optionalString(item?.pack_size),
      unit: optionalString(item?.unit),
      upc: optionalString(item?.upc),
      sku: optionalString(item?.sku),
      source_type: 'camera',
      raw_description: rawDescription,
      extraction_confidence: amount != null && !hasItemMathMismatch ? 'medium' : 'low',
    };
  }).filter(Boolean);
  return normalized.length ? normalized : null;
}

function amountsApproximatelyEqual(left, right, total) {
  const tolerance = Math.max(0.05, Math.abs(Number(total) || 0) * 0.01);
  return Math.abs(left - right) <= tolerance;
}

function validateReceiptArithmetic(receipt) {
  const issues = [];
  let totalComponentsMatch = null;
  let itemSumMatchesSubtotal = null;

  if (receipt.amount != null && receipt.subtotal != null) {
    const expectedTotal = receipt.subtotal
      + (receipt.tax || 0)
      + (receipt.tip || 0)
      + (receipt.fees || 0);
    if (amountsApproximatelyEqual(expectedTotal, receipt.amount, receipt.amount)) {
      totalComponentsMatch = true;
    } else {
      const hasAnyComponent = [receipt.tax, receipt.tip, receipt.fees].some((value) => value != null);
      if (hasAnyComponent) {
        totalComponentsMatch = false;
        issues.push('total_components_mismatch');
      } else {
        issues.push('receipt_components_incomplete');
      }
    }
  }

  const productItems = (receipt.items || []).filter((item) => !item.item_type || item.item_type === 'product');
  const productAmounts = productItems.map((item) => item.amount).filter((amount) => amount != null);
  const unpricedItemCount = productItems.length - productAmounts.length;
  const itemMathMismatchCount = productItems.filter((item) => (
    item.amount != null
    && item.quantity != null
    && item.quantity > 0
    && item.unit_price != null
    && !amountsApproximatelyEqual(item.quantity * item.unit_price, item.amount, item.amount)
  )).length;
  if (unpricedItemCount > 0) issues.push('item_amounts_incomplete');
  if (itemMathMismatchCount > 0) issues.push('item_math_mismatch');

  if (receipt.subtotal != null && productAmounts.length > 0 && unpricedItemCount === 0 && !receipt.items_truncated) {
    const itemSum = productAmounts.reduce((sum, amount) => sum + amount, 0);
    itemSumMatchesSubtotal = amountsApproximatelyEqual(itemSum, receipt.subtotal, receipt.subtotal)
      || (receipt.discounts != null
        && amountsApproximatelyEqual(itemSum - Math.abs(receipt.discounts), receipt.subtotal, receipt.subtotal));
    if (!itemSumMatchesSubtotal) issues.push('item_sum_mismatch');
  }

  return {
    total_components_match: totalComponentsMatch,
    item_sum_matches_subtotal: itemSumMatchesSubtotal,
    product_item_count: productItems.length,
    unpriced_item_count: unpricedItemCount,
    item_math_mismatch_count: itemMathMismatchCount,
    issues,
  };
}

function modelDiagnostics(result = {}) {
  const response = result || {};
  return {
    model_name: response.model || null,
    model_stop_reason: response.stop_reason || null,
    structured_output_fallback_used: Boolean(response.schema_fallback_used),
    model_input_tokens: Number(response.usage?.input_tokens) || 0,
    model_output_tokens: Number(response.usage?.output_tokens) || 0,
    model_cache_creation_input_tokens: Number(response.usage?.cache_creation_input_tokens) || 0,
    model_cache_read_input_tokens: Number(response.usage?.cache_read_input_tokens) || 0,
  };
}

function cleanParsedReceipt(parsed, todayDate) {
  if (!parsed || typeof parsed !== 'object') return null;

  const rawMerchant = typeof parsed.merchant === 'string' ? parsed.merchant.trim() : '';
  const merchant = cleanMerchantDisplayName(rawMerchant) || '';
  const amount = Number(parsed.amount);
  const rawDate = typeof parsed.date === 'string' ? parsed.date.trim() : '';
  const hasValidDate = isPlausibleReceiptDate(rawDate, todayDate);
  const items = normalizeReceiptItems(parsed.items);
  const rawItemCount = Array.isArray(parsed.items)
    ? parsed.items.filter((item) => optionalString(item?.description) && inferredReceiptItemType(item) === 'product').length
    : 0;
  const reportedVisibleItemCount = optionalNumber(parsed.visible_item_count);
  const visibleItemCount = Math.max(
    rawItemCount,
    reportedVisibleItemCount == null ? 0 : Math.floor(reportedVisibleItemCount)
  );
  const itemsTruncated = Boolean(parsed.items_truncated) || rawItemCount > 30 || visibleItemCount > (items?.length || 0);
  const paymentMethod = ['cash', 'credit', 'debit'].includes(parsed.payment_method) ? parsed.payment_method : null;
  const cardLabel = typeof parsed.card_label === 'string' && parsed.card_label.trim() ? parsed.card_label.trim() : null;
  const cardLast4Raw = typeof parsed.card_last4 === 'string' ? parsed.card_last4 : parsed.card_last4 != null ? String(parsed.card_last4) : '';
  const cardLast4 = /^\d{4}$/.test(cardLast4Raw.trim()) ? cardLast4Raw.trim() : null;

  const normalized = {
    merchant: merchant || null,
    raw_merchant: rawMerchant || null,
    merchant_key: canonicalMerchantKey(merchant) || null,
    amount: Number.isFinite(amount) && amount !== 0 ? amount : null,
    date: hasValidDate ? rawDate : todayDate,
    notes: typeof parsed.notes === 'string' && parsed.notes.trim() ? parsed.notes.trim() : null,
    payment_method: paymentMethod,
    card_label: cardLabel,
    card_last4: cardLast4,
    store_address: typeof parsed.store_address === 'string' && parsed.store_address.trim() ? parsed.store_address.trim() : null,
    store_number: typeof parsed.store_number === 'string' && parsed.store_number.trim() ? parsed.store_number.trim() : null,
    currency: /^[A-Za-z]{3}$/.test(`${parsed.currency || ''}`.trim()) ? `${parsed.currency}`.trim().toUpperCase() : null,
    subtotal: optionalNumber(parsed.subtotal),
    tax: optionalNumber(parsed.tax),
    tip: optionalNumber(parsed.tip),
    fees: optionalNumber(parsed.fees),
    discounts: optionalNumber(parsed.discounts),
    transaction_id: optionalString(parsed.transaction_id),
    purchase_time: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(`${parsed.purchase_time || ''}`.trim()) ? `${parsed.purchase_time}`.trim() : null,
    items,
    items_truncated: itemsTruncated,
    visible_item_count: visibleItemCount || (items?.length || 0),
  };
  if (normalized.discounts != null) normalized.discounts = Math.abs(normalized.discounts);

  const uncertainFields = Array.isArray(parsed.uncertain_fields)
    ? [...new Set(parsed.uncertain_fields.filter((field) => UNCERTAIN_FIELD_NAMES.includes(field)))]
    : [];
  const receiptValidation = validateReceiptArithmetic(normalized);
  receiptValidation.items_truncated = itemsTruncated;
  receiptValidation.visible_item_count = normalized.visible_item_count;
  receiptValidation.extracted_item_count = items?.length || 0;
  receiptValidation.raw_merchant = rawMerchant || null;
  receiptValidation.canonical_merchant = merchant || null;
  receiptValidation.merchant_key = normalized.merchant_key;
  receiptValidation.merchant_normalization_reason = rawMerchant && rawMerchant !== merchant
    ? 'boilerplate_removed'
    : 'normalized_only';
  const totalIsInconsistent = receiptValidation.total_components_match === false;
  const receiptTotalsUncertain = ['currency', 'subtotal', 'tax', 'tip', 'fees', 'discounts']
    .some((field) => uncertainFields.includes(field));
  const receiptTotalsNeedReview = totalIsInconsistent
    || receiptValidation.issues.includes('receipt_components_incomplete')
    || receiptTotalsUncertain;
  const itemDetailsNeedReview = receiptValidation.issues.some((issue) => (
    issue === 'item_sum_mismatch' || issue === 'item_amounts_incomplete' || issue === 'item_math_mismatch'
  ));

  const review_fields = [];
  const field_confidence = {
    merchant: normalized.merchant ? (uncertainFields.includes('merchant') ? 'medium' : 'high') : 'low',
    amount: normalized.amount != null ? (uncertainFields.includes('amount') || totalIsInconsistent ? 'medium' : 'high') : 'low',
    date: hasValidDate ? (uncertainFields.includes('date') ? 'medium' : 'high') : 'low',
    payment_method: normalized.payment_method ? (uncertainFields.includes('payment_method') ? 'low' : 'medium') : 'low',
    card_label: normalized.card_label ? 'medium' : 'low',
    card_last4: normalized.card_last4 ? 'high' : 'low',
    items: items?.length ? (uncertainFields.includes('items') || itemsTruncated || itemDetailsNeedReview ? 'low' : 'medium') : 'low',
    receipt_totals: receiptTotalsNeedReview ? 'low' : (normalized.subtotal != null ? 'high' : 'medium'),
  };

  if (!normalized.merchant || uncertainFields.includes('merchant')) review_fields.push('merchant');
  if (normalized.amount == null || uncertainFields.includes('amount') || totalIsInconsistent) review_fields.push('amount');
  if (!hasValidDate || uncertainFields.includes('date')) review_fields.push('date');
  if (!items?.length || uncertainFields.includes('items') || itemsTruncated) review_fields.push('items');
  if (itemDetailsNeedReview && !review_fields.includes('items')) review_fields.push('items');
  if (receiptTotalsNeedReview) review_fields.push('receipt totals');
  if (!normalized.payment_method && (normalized.card_label || normalized.card_last4)) review_fields.push('payment method');

  if (normalized.amount == null) return null;

  return {
    ...normalized,
    parse_status: review_fields.length > 0 ? 'partial' : 'complete',
    review_fields,
    field_confidence,
    uncertain_fields: uncertainFields,
    receipt_validation: receiptValidation,
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

  let primaryModelResult = null;
  let text = null;
  let primaryDurationMs = 0;
  if (shouldRunPrimary) {
    const primaryStartedAt = Date.now();
    primaryModelResult = await completeWithImageDetailed({
      system: SYSTEM_PROMPT,
      imageBase64,
      text: buildPrimaryPrompt(todayDate, priors, familyHint),
      maxTokens: 3200,
      outputSchema: RECEIPT_OUTPUT_SCHEMA,
    });
    text = primaryModelResult.text;
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
        ...modelDiagnostics(primaryModelResult),
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
    ...modelDiagnostics(primaryModelResult),
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
  const fallbackModelResult = await completeWithImageDetailed({
    system: FALLBACK_SYSTEM_PROMPT,
    imageBase64,
    text: buildFallbackPrompt(todayDate, priors, familyHint || familyClassification),
    maxTokens: 1800,
    outputSchema: FALLBACK_RECEIPT_OUTPUT_SCHEMA,
  });
  const fallbackText = fallbackModelResult.text;
  const fallbackDurationMs = Date.now() - fallbackStartedAt;
  const fallbackModelDiagnostics = modelDiagnostics(fallbackModelResult);
  const aggregateModelDiagnostics = {
    model_name: fallbackModelDiagnostics.model_name || diagnostics.model_name || null,
    model_stop_reason: fallbackModelDiagnostics.model_stop_reason || diagnostics.model_stop_reason || null,
    model_input_tokens: (diagnostics.model_input_tokens || 0) + fallbackModelDiagnostics.model_input_tokens,
    model_output_tokens: (diagnostics.model_output_tokens || 0) + fallbackModelDiagnostics.model_output_tokens,
    model_cache_creation_input_tokens:
      (diagnostics.model_cache_creation_input_tokens || 0) + fallbackModelDiagnostics.model_cache_creation_input_tokens,
    model_cache_read_input_tokens:
      (diagnostics.model_cache_read_input_tokens || 0) + fallbackModelDiagnostics.model_cache_read_input_tokens,
    structured_output_fallback_used: Boolean(
      diagnostics.structured_output_fallback_used
      || fallbackModelDiagnostics.structured_output_fallback_used
    ),
  };

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
        ...aggregateModelDiagnostics,
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
    ...aggregateModelDiagnostics,
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
  normalizeReceiptItems,
  parseJsonWithRecovery,
  validateReceiptArithmetic,
  RECEIPT_OUTPUT_SCHEMA,
  FALLBACK_RECEIPT_OUTPUT_SCHEMA,
};
