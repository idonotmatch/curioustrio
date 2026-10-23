const FINANCIAL_EVENT_TYPES = new Set(['purchase_confirmation', 'charge', 'refund']);
const NON_FINANCIAL_EVENT_TYPES = new Set(['shipping_update', 'cancellation', 'return_update']);

function normalizeExternalId(value) {
  const clean = `${value || ''}`
    .trim()
    .replace(/^#+/, '')
    .replace(/[\s/]+/g, '-')
    .replace(/[^a-z0-9._-]/gi, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80);
  if (clean.length < 3) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
  return clean.toUpperCase();
}

function firstReferenceMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const normalized = normalizeExternalId(match?.[1]);
    if (normalized) return normalized;
  }
  return null;
}

function extractOrderId(text = '') {
  return firstReferenceMatch(`${text || ''}`, [
    /\border\s*(?:number|no\.?|id)?\s*[:#]\s*([a-z0-9][a-z0-9._\-/]{2,79})/i,
    /\bconfirmation\s*(?:number|no\.?|code|id)?\s*[:#]\s*([a-z0-9][a-z0-9._\-/]{2,79})/i,
    /\binvoice\s*(?:number|no\.?|id)?\s*[:#]\s*([a-z0-9][a-z0-9._\-/]{2,79})/i,
  ]);
}

function extractTransactionId(text = '') {
  return firstReferenceMatch(`${text || ''}`, [
    /\btransaction\s*(?:number|no\.?|id)?\s*[:#]\s*([a-z0-9][a-z0-9._\-/]{2,79})/i,
    /\bpayment\s*(?:reference|number|no\.?|id)\s*[:#]\s*([a-z0-9][a-z0-9._\-/]{2,79})/i,
    /\b(?:paypal|stripe)\s*(?:transaction|payment)?\s*id\s*[:#]\s*([a-z0-9][a-z0-9._\-/]{2,79})/i,
  ]);
}

function classifyLifecycleEvent(subject = '', body = '', classification = {}) {
  const subjectText = `${subject || ''}`.toLowerCase();
  const bodyText = `${body || ''}`.toLowerCase();
  const text = `${subjectText}\n${bodyText}`;
  if (classification?.disposition === 'refund' || /\b(refund(?:ed)?|money back|credit issued|refund processed)\b/.test(text)) {
    return 'refund';
  }
  if (/\b(cancelled|canceled|cancellation)\b/.test(subjectText)
    || /\b(?:your )?order (?:was |has been )?cancel(?:led|ed)\b/.test(bodyText)) {
    return 'cancellation';
  }
  if (/\b(return (?:started|received|accepted|requested)|return authorization|return label)\b/.test(subjectText)
    || /\b(?:we received|we accepted) your return\b/.test(bodyText)) {
    return 'return_update';
  }
  if (/\b(shipped|shipping update|out for delivery|delivered|tracking update|on its way)\b/.test(subjectText)) {
    return 'shipping_update';
  }
  if (/\b(order confirmation|order confirmed|order received|thanks for your order|purchase confirmation)\b/.test(text)) {
    return 'purchase_confirmation';
  }
  if (/\b(?:your )?order (?:has |was )?shipped\b/.test(bodyText)
    || /\b(?:out for delivery|tracking update)\b/.test(bodyText)) return 'shipping_update';
  if (/\b(charged|payment (?:received|processed|complete)|you paid|paid receipt|card was charged)\b/.test(text)) {
    return 'charge';
  }
  if (classification?.disposition === 'expense') return 'charge';
  return 'unknown';
}

function extractEmailTransactionLifecycle({
  subject = '',
  body = '',
  classification = {},
  parsed = {},
  threadId = null,
} = {}) {
  const evidence = `${subject || ''}\n${body || ''}`;
  return {
    gmailThreadId: `${threadId || ''}`.trim() || null,
    externalOrderId: normalizeExternalId(parsed?.order_id) || extractOrderId(evidence),
    externalTransactionId: normalizeExternalId(parsed?.transaction_id) || extractTransactionId(evidence),
    eventType: classifyLifecycleEvent(subject, body, classification),
  };
}

function isNonFinancialLifecycleEvent(eventType) {
  return NON_FINANCIAL_EVENT_TYPES.has(eventType);
}

function shouldReuseLifecycleExpense(eventType, relatedEvent, currentExpense = {}) {
  if (!FINANCIAL_EVENT_TYPES.has(eventType) || eventType === 'refund') return false;
  if (!relatedEvent?.expense_id) return false;
  if (relatedEvent.match_key === 'transaction_id' || relatedEvent.match_key === 'order_id') return true;
  if (relatedEvent.match_key !== 'gmail_thread') return false;

  const currentAmount = Math.abs(Number(currentExpense.amount || 0));
  const priorAmount = Math.abs(Number(relatedEvent.amount || 0));
  const tolerance = Math.max(0.05, priorAmount * 0.01);
  if (!currentAmount || !priorAmount || Math.abs(currentAmount - priorAmount) > tolerance) return false;

  const currentDate = new Date(`${currentExpense.date || ''}T12:00:00Z`);
  const priorDate = new Date(`${relatedEvent.date || ''}T12:00:00Z`);
  if (Number.isNaN(currentDate.getTime()) || Number.isNaN(priorDate.getTime())) return false;
  return Math.abs(currentDate.getTime() - priorDate.getTime()) <= 14 * 24 * 60 * 60 * 1000;
}

module.exports = {
  normalizeExternalId,
  extractOrderId,
  extractTransactionId,
  classifyLifecycleEvent,
  extractEmailTransactionLifecycle,
  isNonFinancialLifecycleEvent,
  shouldReuseLifecycleExpense,
};
