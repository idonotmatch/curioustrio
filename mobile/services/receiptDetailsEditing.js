const RECEIPT_DETAIL_FIELDS = [
  'currency', 'subtotal', 'tax', 'tip', 'fees', 'discounts',
  'transaction_id', 'purchase_time', 'store_number',
];

const MONEY_FIELDS = new Set(['subtotal', 'tax', 'tip', 'fees', 'discounts']);

function formatOptionalMoney(value) {
  if (value == null || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : `${value}`;
}

function createEditableReceiptDetails(parsed = {}) {
  return {
    currency: `${parsed.currency || ''}`.trim().toUpperCase(),
    subtotal: formatOptionalMoney(parsed.subtotal),
    tax: formatOptionalMoney(parsed.tax),
    tip: formatOptionalMoney(parsed.tip),
    fees: formatOptionalMoney(parsed.fees),
    discounts: formatOptionalMoney(parsed.discounts),
    transaction_id: `${parsed.transaction_id || ''}`.trim(),
    purchase_time: `${parsed.purchase_time || ''}`.trim(),
    store_number: `${parsed.store_number || ''}`.trim(),
  };
}

function parseOptionalMoney(value) {
  const text = `${value ?? ''}`.trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function normalizeReceiptDetailsPayload(details = {}) {
  const currency = `${details.currency || ''}`.trim().toUpperCase();
  const purchaseTime = `${details.purchase_time || ''}`.trim();
  const discounts = parseOptionalMoney(details.discounts);
  return {
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    subtotal: parseOptionalMoney(details.subtotal),
    tax: parseOptionalMoney(details.tax),
    tip: parseOptionalMoney(details.tip),
    fees: parseOptionalMoney(details.fees),
    discounts: discounts == null ? null : Math.abs(discounts),
    transaction_id: `${details.transaction_id || ''}`.trim() || null,
    purchase_time: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(purchaseTime) ? purchaseTime : null,
    store_number: `${details.store_number || ''}`.trim() || null,
  };
}

function receiptDetailChangedFields(original = {}, current = {}) {
  const originalPayload = normalizeReceiptDetailsPayload(original);
  const currentPayload = normalizeReceiptDetailsPayload(current);
  return RECEIPT_DETAIL_FIELDS.filter((field) => {
    if (MONEY_FIELDS.has(field)) {
      const left = originalPayload[field];
      const right = currentPayload[field];
      if (left == null && right == null) return false;
      return left == null || right == null || Math.abs(left - right) >= 0.001;
    }
    return `${originalPayload[field] || ''}` !== `${currentPayload[field] || ''}`;
  });
}

function buildReceiptBreakdownPresentation(details = {}, totalValue = null) {
  const normalized = normalizeReceiptDetailsPayload(details);
  const total = Number(totalValue);
  if (!Number.isFinite(total) || normalized.subtotal == null) return null;
  const expected = normalized.subtotal
    + (normalized.tax || 0)
    + (normalized.tip || 0)
    + (normalized.fees || 0);
  const tolerance = Math.max(0.05, Math.abs(total) * 0.01);
  if (Math.abs(expected - Math.abs(total)) <= tolerance) return null;
  return {
    title: 'Check the receipt breakdown',
    body: `Subtotal, tax, tip, and fees add to $${expected.toFixed(2)}, while the paid total is $${Math.abs(total).toFixed(2)}.`,
  };
}

module.exports = {
  buildReceiptBreakdownPresentation,
  createEditableReceiptDetails,
  normalizeReceiptDetailsPayload,
  receiptDetailChangedFields,
};
