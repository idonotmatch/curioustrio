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

function buildReceiptDiagnostics(imageBase64, raw = null) {
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

  if (!text) return { parsed: null, failureReason: 'empty_model_response', raw: null, diagnostics: buildReceiptDiagnostics(imageBase64) };
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!cleaned || cleaned === 'null') {
    return { parsed: null, failureReason: 'empty_model_response', raw: null, diagnostics: buildReceiptDiagnostics(imageBase64) };
  }
  try {
    const raw = JSON.parse(cleaned);
    const parsed = cleanParsedReceipt(raw, todayDate);
    const diagnostics = buildReceiptDiagnostics(imageBase64, raw);
    if (parsed) return { parsed, failureReason: null, raw, diagnostics };

    const amount = Number(raw?.amount);
    const merchant = typeof raw?.merchant === 'string' ? raw.merchant.trim() : '';
    let failureReason = 'missing_required_fields';
    if (!Number.isFinite(amount) || amount === 0) {
      failureReason = 'missing_total';
    } else if (!merchant) {
      failureReason = 'missing_required_fields';
    }
    return { parsed: null, failureReason, raw, diagnostics };
  } catch {
    return { parsed: null, failureReason: 'invalid_model_json', raw: null, diagnostics: buildReceiptDiagnostics(imageBase64) };
  }
}

module.exports = { parseReceipt, parseReceiptDetailed, cleanParsedReceipt };
