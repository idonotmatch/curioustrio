const crypto = require('crypto');
const {
  basketSimilarity,
  canonicalMerchantKey,
  daysBetween,
} = require('./matchPrimitives');

const FINANCIAL_EVENT_TYPES = new Set(['purchase_confirmation', 'charge', 'refund']);
const NON_FINANCIAL_EVENT_TYPES = new Set(['shipping_update', 'cancellation', 'return_update']);

function normalizeExternalId(value) {
  const clean = `${value || ''}`
    .trim()
    .replace(/^#+/, '')
    .replace(/[\s/]+/g, '-')
    .replace(/[^a-z0-9._-]/gi, '')
    .replace(/-{2,}/g, '-')
    .replace(/[._-]+$/g, '')
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
  const value = `${text || ''}`;
  const direct = firstReferenceMatch(value, [
    /\border\s*(?:number|no\.?|id)?\s*(?:#\s*:|:\s*#|[:#])\s*([a-z0-9][a-z0-9._\-/]{2,79})/i,
    /\bconfirmation\s*(?:number|no\.?|code|id)?\s*[:#]\s*([a-z0-9][a-z0-9._\-/]{2,79})/i,
    /\binvoice\s*(?:number|no\.?|id)?\s*[:#]\s*([a-z0-9][a-z0-9._\-/]{2,79})/i,
    /\bconfirmation\s+for\s+order\s*[#:\[]?\s*([a-z0-9][a-z0-9._\-/]{3,79})/i,
    /\bthanks\s+for\s+your\s+order\s*[#:\[]?\s*([a-z0-9][a-z0-9._\-/]{3,79})/i,
    /\border\s*\[\s*([a-z0-9][a-z0-9._\-/]{3,79})\s*\]/i,
  ]);
  if (direct) return direct;
  const ending = value.match(/\border\s+ending\s+in\s+([a-z0-9]{3,12})\b/i)?.[1];
  return ending ? `ENDING-${normalizeExternalId(ending)}` : null;
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

  if (/\b(cancelled|canceled|cancellation)\b/.test(subjectText)
    || /\b(?:your )?order (?:was |has been )?cancel(?:led|ed)\b/.test(bodyText)) return 'cancellation';
  if (/\b(return (?:started|received|accepted|requested)|return authorization|return label)\b/.test(subjectText)
    || /\b(?:we received|we accepted) your return\b/.test(bodyText)) return 'return_update';

  const fulfillmentSubject = /\b(?:shipped|shipment|shipping update|tracking update|in transit|out for delivery|delivered|arriving|arrives today|has arrived|about to ship|on (?:its|the) way|ready for (?:pickup|collection)|picked up|pickup complete|an update to your order|(?:your |the )?(?:drive up )?order (?:is|was) ready(?:\s+(?:at|for)\b)?|(?:getting|preparing) your (?:autoship )?order ready)\b/;
  const fulfillmentBody = /\b(?:(?:your |the )?(?:order|package|shipment) (?:has |was |is )?(?:shipped|in transit|on (?:its|the) way|out for delivery|delivered|ready for (?:pickup|collection)|picked up)|(?:we(?:'re| are) )?(?:getting|preparing) your (?:autoship )?order ready)\b/;
  if (fulfillmentSubject.test(subjectText) || fulfillmentBody.test(bodyText)) return 'shipping_update';

  if (classification?.disposition === 'refund' || /\b(refund(?:ed)?|money back|credit issued|refund processed)\b/.test(text)) return 'refund';
  if (/\b(order confirmation|order confirmed|order received|thanks for your order|purchase confirmation)\b/.test(text)
    || /\border\s*#?[a-z0-9._-]+\s+is confirmed\b/i.test(text)
    || /\bthanks for shopping with us\b[^\n]{0,80}\border\b/i.test(subjectText)) return 'purchase_confirmation';
  if (/\b(charged|payment (?:received|processed|complete)|you paid|paid receipt|card was charged)\b/.test(text)) return 'charge';
  if (classification?.disposition === 'expense') return 'charge';
  return 'unknown';
}

function normalizeFingerprintText(value = '') {
  return `${value || ''}`
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' [link] ')
    .replace(/\b[0-9a-f]{24,}\b/gi, ' [token] ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMessageFingerprint({ subject = '', fromAddress = '', body = '', snippet = '' } = {}) {
  const normalized = [fromAddress, subject, snippet, body]
    .map(normalizeFingerprintText)
    .join('\n')
    .slice(0, 6000);
  if (!normalized.replace(/\s/g, '')) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function buildPurchaseIdentityKey({
  senderRootDomain = 'unknown',
  externalOrderId = null,
  externalTransactionId = null,
  gmailThreadId = null,
  messageFingerprint = null,
} = {}) {
  const root = `${senderRootDomain || 'unknown'}`.toLowerCase();
  if (externalTransactionId) return `transaction:${root}:${externalTransactionId}`;
  if (externalOrderId) return `order:${root}:${externalOrderId}`;
  if (gmailThreadId) return `thread:${root}:${gmailThreadId}`;
  if (messageFingerprint) return `message:${messageFingerprint}`;
  return null;
}

function extractEmailTransactionLifecycle({
  subject = '', body = '', snippet = '', fromAddress = '', senderRootDomain = 'unknown',
  classification = {}, parsed = {}, threadId = null,
} = {}) {
  const evidence = `${subject || ''}\n${body || ''}`;
  const lifecycle = {
    gmailThreadId: `${threadId || ''}`.trim() || null,
    externalOrderId: normalizeExternalId(parsed?.order_id) || extractOrderId(evidence),
    externalTransactionId: normalizeExternalId(parsed?.transaction_id) || extractTransactionId(evidence),
    eventType: classifyLifecycleEvent(subject, body, classification),
    messageFingerprint: buildMessageFingerprint({ subject, fromAddress, body, snippet }),
  };
  lifecycle.purchaseIdentityKey = buildPurchaseIdentityKey({ senderRootDomain, ...lifecycle });
  return lifecycle;
}

function isNonFinancialLifecycleEvent(eventType) {
  return NON_FINANCIAL_EVENT_TYPES.has(eventType);
}

function scoreLifecycleCandidate(current = {}, candidate = {}) {
  const currentAmount = Math.abs(Number(current.amount || 0));
  const priorAmount = Math.abs(Number(candidate.amount || 0));
  const amountTolerance = Math.max(0.05, priorAmount * 0.01);
  const amountExact = currentAmount > 0 && priorAmount > 0 && Math.abs(currentAmount - priorAmount) <= amountTolerance;
  const amountNear = currentAmount > 0 && priorAmount > 0 && Math.abs(currentAmount - priorAmount) <= Math.max(1, priorAmount * 0.03);
  const dateDistance = daysBetween(current.date, candidate.date);
  const merchantMatch = canonicalMerchantKey(current.merchant) === canonicalMerchantKey(candidate.merchant);
  const rootMatch = current.senderRootDomain && candidate.sender_root_domain
    && current.senderRootDomain === candidate.sender_root_domain;
  const currentEvent = `${current.eventType || 'unknown'}`;
  const priorEvent = `${candidate.email_event_type || 'unknown'}`;
  const eventTypes = new Set([currentEvent, priorEvent]);
  const complementaryEvents = eventTypes.has('purchase_confirmation') && eventTypes.has('charge');
  const basketMatch = basketSimilarity(current.items, candidate.items);

  let score = 0;
  const reasons = [];
  if (merchantMatch) { score += 30; reasons.push('merchant'); }
  if (amountExact) { score += 30; reasons.push('amount_exact'); }
  else if (amountNear) { score += 15; reasons.push('amount_near'); }
  if (dateDistance === 0) { score += 20; reasons.push('date_same'); }
  else if (dateDistance <= 3) { score += 12; reasons.push('date_near'); }
  else if (dateDistance <= 7) { score += 4; reasons.push('date_window'); }
  if (rootMatch) { score += 8; reasons.push('sender_root'); }
  if (complementaryEvents) { score += 18; reasons.push('complementary_events'); }
  if (basketMatch >= 0.6) { score += 25; reasons.push('basket_match'); }

  const confidence = score >= 88 && (complementaryEvents || basketMatch >= 0.6)
    ? 'high'
    : (score >= 65 ? 'medium' : 'none');
  return { score, confidence, reasons, basketSimilarity: basketMatch };
}

function shouldReuseLifecycleExpense(eventType, relatedEvent, currentExpense = {}) {
  if (!FINANCIAL_EVENT_TYPES.has(eventType) || eventType === 'refund') return false;
  if (!relatedEvent?.expense_id) return false;
  if (['transaction_id', 'order_id', 'message_fingerprint'].includes(relatedEvent.match_key)) return true;
  if (relatedEvent.match_key === 'purchase_fallback') return relatedEvent.match_confidence === 'high';
  if (relatedEvent.match_key !== 'gmail_thread') return false;

  const currentAmount = Math.abs(Number(currentExpense.amount || 0));
  const priorAmount = Math.abs(Number(relatedEvent.amount || 0));
  const tolerance = Math.max(0.05, priorAmount * 0.01);
  if (!currentAmount || !priorAmount || Math.abs(currentAmount - priorAmount) > tolerance) return false;
  return daysBetween(currentExpense.date, relatedEvent.date) <= 14;
}

module.exports = {
  normalizeExternalId,
  extractOrderId,
  extractTransactionId,
  classifyLifecycleEvent,
  buildMessageFingerprint,
  buildPurchaseIdentityKey,
  extractEmailTransactionLifecycle,
  isNonFinancialLifecycleEvent,
  scoreLifecycleCandidate,
  shouldReuseLifecycleExpense,
};
