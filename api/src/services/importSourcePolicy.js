const ALLOWED_CONFIDENCE = new Set(['low', 'medium', 'high', 'confirmed']);
const ALLOWED_FIELDS = new Set([
  'merchant', 'amount', 'date', 'items', 'currency', 'category',
  'payment_method', 'card_last4', 'location', 'transaction_id',
]);

const SOURCE_ROLES = {
  manual: 'user',
  camera: 'detail',
  email: 'detail',
  forwarded_email: 'detail',
  share: 'detail',
  refund: 'settlement',
  financekit: 'settlement',
  bank: 'settlement',
};

function sourceRole(source) {
  return SOURCE_ROLES[`${source || ''}`] || 'detail';
}

function normalizeFieldConfidence(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([field, confidence]) => ALLOWED_FIELDS.has(field) && ALLOWED_CONFIDENCE.has(confidence))
  );
}

function normalizeFieldEvidence(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  for (const [field, evidence] of Object.entries(value)) {
    if (!ALLOWED_FIELDS.has(field) || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)) continue;
    const confidence = ALLOWED_CONFIDENCE.has(evidence.confidence) ? evidence.confidence : null;
    const detail = `${evidence.detail || evidence.reason || ''}`.replace(/\s+/g, ' ').trim().slice(0, 280);
    normalized[field] = {
      confidence,
      questionable: evidence.questionable === true || confidence === 'low',
      detail: detail || null,
      source: `${evidence.source || ''}`.trim().slice(0, 40) || null,
    };
  }
  return normalized;
}

function buildReceiptFieldEvidence(validation = {}) {
  const confidence = normalizeFieldConfidence(validation.field_confidence || {});
  const uncertain = new Set(Array.isArray(validation.uncertain_fields) ? validation.uncertain_fields : []);
  const labels = {
    merchant: 'Merchant name was read from the receipt header.',
    amount: 'Total was read from the receipt summary.',
    date: 'Purchase date was read from the receipt.',
    items: 'Line items were read from the receipt body.',
    payment_method: 'Payment method was read from the receipt.',
    card_last4: 'Card digits were read from the receipt.',
    currency: 'Currency was read from the receipt.',
    transaction_id: 'Transaction ID was read from the receipt.',
  };
  const evidence = {};
  for (const [field, level] of Object.entries(confidence)) {
    if (!ALLOWED_FIELDS.has(field)) continue;
    const questionable = uncertain.has(field) || level === 'low';
    evidence[field] = {
      confidence: level,
      questionable,
      detail: questionable ? `The ${field.replace(/_/g, ' ')} was not fully clear on the receipt.` : labels[field] || 'Read from the receipt.',
      source: 'receipt',
    };
  }
  return normalizeFieldEvidence(evidence);
}

function observedExpenseFields(expense = {}, extra = {}) {
  return {
    merchant: expense.merchant || null,
    amount: expense.amount == null ? null : Number(expense.amount),
    date: expense.date ? `${expense.date}`.slice(0, 10) : null,
    currency: extra.currency || null,
    payment_method: expense.payment_method || null,
    card_last4: expense.card_last4 || null,
    transaction_id: extra.transaction_id || null,
    item_count: Number(extra.item_count || 0),
  };
}

function canMergeSources(importedSource, existingSource) {
  const importedRole = sourceRole(importedSource);
  const existingRole = sourceRole(existingSource);
  if (existingSource === 'manual' && importedRole !== 'user') return true;
  if (importedRole === 'settlement' && existingRole === 'detail') return true;
  return false;
}

module.exports = {
  buildReceiptFieldEvidence,
  canMergeSources,
  normalizeFieldConfidence,
  normalizeFieldEvidence,
  observedExpenseFields,
  sourceRole,
};
