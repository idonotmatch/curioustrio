const {
  basketSimilarity,
  canonicalMerchantKey,
  daysBetween,
} = require('./matchPrimitives');

const PROFILES = {
  duplicate: {
    merchant: 30,
    amountExact: 40,
    amountNear: 20,
    dateSame: 30,
    dateOne: 20,
    dateTwo: 10,
    payment: 15,
    place: 15,
    transaction: 100,
    basketStrong: 35,
    basketMedium: 15,
    fuzzyThreshold: 60,
  },
  gmailLifecycle: {
    merchant: 30,
    amountExact: 30,
    amountNear: 15,
    dateSame: 20,
    dateNear: 12,
    dateWindow: 4,
    senderRoot: 8,
    complementaryEvents: 18,
    basketStrong: 25,
    mediumThreshold: 65,
    highThreshold: 88,
  },
};

function sameMerchant(left = {}, right = {}) {
  if (left.merchant_entity_id && right.merchant_entity_id) {
    return left.merchant_entity_id === right.merchant_entity_id;
  }
  const leftKey = canonicalMerchantKey(left.merchant);
  const rightKey = canonicalMerchantKey(right.merchant);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function samePayment(left = {}, right = {}) {
  if (left.payment_instrument_id && right.payment_instrument_id) {
    return left.payment_instrument_id === right.payment_instrument_id;
  }
  return Boolean(
    left.card_last4
    && right.card_last4
    && `${left.card_last4}` === `${right.card_last4}`
    && (!left.payment_method || !right.payment_method || left.payment_method === right.payment_method)
  );
}

function buildMatchEvidence(left = {}, right = {}, extras = {}) {
  const leftAmount = Math.abs(Number(left.amount || 0));
  const rightAmount = Math.abs(Number(right.amount || 0));
  const amountDistance = Math.abs(leftAmount - rightAmount);
  const dateDistance = daysBetween(left.date, right.date);
  const amountExactTolerance = Number(extras.amountExactTolerance ?? 0.005);
  const amountNearTolerance = Number(extras.amountNearTolerance ?? 1);
  const leftEvent = `${extras.leftEvent || left.eventType || left.email_event_type || 'unknown'}`;
  const rightEvent = `${extras.rightEvent || right.eventType || right.email_event_type || 'unknown'}`;
  const eventTypes = new Set([leftEvent, rightEvent]);

  const paymentIdentityMatch = Boolean(
    left.payment_instrument_id
    && right.payment_instrument_id
    && left.payment_instrument_id === right.payment_instrument_id
  );
  const cardLast4Match = Boolean(
    left.card_last4
    && right.card_last4
    && `${left.card_last4}` === `${right.card_last4}`
  );
  return {
    merchantMatch: extras.merchantMatch ?? sameMerchant(left, right),
    paymentMatch: extras.paymentMatch ?? samePayment(left, right),
    paymentIdentityMatch,
    cardLast4Match,
    placeMatch: Boolean(extras.placeMatch),
    transactionMatch: Boolean(extras.transactionMatch),
    amountDistance,
    amountExact: leftAmount > 0 && rightAmount > 0 && amountDistance <= amountExactTolerance,
    amountNear: leftAmount > 0 && rightAmount > 0 && amountDistance <= amountNearTolerance,
    dateDistance,
    basketSimilarity: extras.basketSimilarity == null
      ? basketSimilarity(left.items || [], right.items || [])
      : Number(extras.basketSimilarity || 0),
    senderRootMatch: Boolean(
      extras.senderRootMatch
      ?? (left.senderRootDomain && right.sender_root_domain && left.senderRootDomain === right.sender_root_domain)
    ),
    complementaryEvents: eventTypes.has('purchase_confirmation') && eventTypes.has('charge'),
    learnedDifferent: Boolean(extras.learnedDifferent),
  };
}

function scoreDuplicateEvidence(evidence) {
  const weights = PROFILES.duplicate;
  let score = 0;
  const reasons = [];
  if (evidence.merchantMatch) { score += weights.merchant; reasons.push('Same merchant'); }
  if (evidence.amountExact) { score += weights.amountExact; reasons.push('Same amount'); }
  else if (evidence.amountNear) { score += weights.amountNear; reasons.push('Amount within $1'); }
  if (evidence.dateDistance === 0) { score += weights.dateSame; reasons.push('Same date'); }
  else if (evidence.dateDistance === 1) { score += weights.dateOne; reasons.push('Dates one day apart'); }
  else if (evidence.dateDistance === 2) { score += weights.dateTwo; reasons.push('Dates two days apart'); }
  if (evidence.paymentMatch) {
    score += weights.payment;
    reasons.push(evidence.paymentIdentityMatch ? 'Same payment method' : 'Same card');
  }
  if (evidence.placeMatch) { score += weights.place; reasons.push('Same location'); }
  if (evidence.transactionMatch) { score += weights.transaction; reasons.push('Same receipt transaction ID'); }
  if (evidence.basketSimilarity >= 0.6) {
    score += weights.basketStrong;
    reasons.push(`Same basket (${Math.round(evidence.basketSimilarity * 100)}%)`);
  } else if (evidence.basketSimilarity >= 0.4) {
    score += weights.basketMedium;
    reasons.push(`Similar basket (${Math.round(evidence.basketSimilarity * 100)}%)`);
  }
  if (evidence.learnedDifferent && !evidence.transactionMatch) {
    score = Math.max(0, score - 25);
    reasons.push('Similar matches were previously kept separate');
  }
  const exact = !evidence.learnedDifferent && (
    evidence.transactionMatch
    || (evidence.merchantMatch && evidence.amountExact && evidence.dateDistance === 0)
  );
  return {
    score,
    reasons,
    confidence: exact ? 'exact' : score >= weights.fuzzyThreshold ? 'fuzzy' : 'uncertain',
    evidence,
  };
}

function scoreLifecycleEvidence(evidence) {
  const weights = PROFILES.gmailLifecycle;
  let score = 0;
  const reasons = [];
  if (evidence.merchantMatch) { score += weights.merchant; reasons.push('merchant'); }
  if (evidence.amountExact) { score += weights.amountExact; reasons.push('amount_exact'); }
  else if (evidence.amountNear) { score += weights.amountNear; reasons.push('amount_near'); }
  if (evidence.dateDistance === 0) { score += weights.dateSame; reasons.push('date_same'); }
  else if (evidence.dateDistance <= 3) { score += weights.dateNear; reasons.push('date_near'); }
  else if (evidence.dateDistance <= 7) { score += weights.dateWindow; reasons.push('date_window'); }
  if (evidence.senderRootMatch) { score += weights.senderRoot; reasons.push('sender_root'); }
  if (evidence.complementaryEvents) { score += weights.complementaryEvents; reasons.push('complementary_events'); }
  if (evidence.basketSimilarity >= 0.6) { score += weights.basketStrong; reasons.push('basket_match'); }
  const confidence = score >= weights.highThreshold
    && (evidence.complementaryEvents || evidence.basketSimilarity >= 0.6)
    ? 'high'
    : (score >= weights.mediumThreshold ? 'medium' : 'none');
  return { score, confidence, reasons, basketSimilarity: evidence.basketSimilarity, evidence };
}

function scoreMatch(left, right, { profile = 'duplicate', ...extras } = {}) {
  const exactTolerance = profile === 'gmailLifecycle'
    ? Math.max(0.05, Math.abs(Number(right.amount || 0)) * 0.01)
    : 0.005;
  const nearTolerance = profile === 'gmailLifecycle'
    ? Math.max(1, Math.abs(Number(right.amount || 0)) * 0.03)
    : 1;
  const evidence = buildMatchEvidence(left, right, {
    amountExactTolerance: exactTolerance,
    amountNearTolerance: nearTolerance,
    ...extras,
  });
  return profile === 'gmailLifecycle'
    ? scoreLifecycleEvidence(evidence)
    : scoreDuplicateEvidence(evidence);
}

module.exports = {
  PROFILES,
  buildMatchEvidence,
  sameMerchant,
  samePayment,
  scoreDuplicateEvidence,
  scoreLifecycleEvidence,
  scoreMatch,
};
