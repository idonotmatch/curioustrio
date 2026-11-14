const { extractDeterministicTotalAmount } = require('./emailParser');

const AMOUNT_AMBIGUITY_RULES = Object.freeze([
  {
    code: 'estimated_total',
    pattern: /\b(?:estimated|approximate|projected) (?:order )?(?:total|amount)|(?:total|amount) (?:may|can|could) (?:change|vary)\b/i,
    detail: 'The email shows an estimated total that may change before the final charge.',
  },
  {
    code: 'financing',
    pattern: /\b(?:installment(?: plan)?|amount financed|financing|pay over time|monthly payment|buy now,? pay later|afterpay|klarna|affirm)\b/i,
    detail: 'The purchase includes financing or installments, so the amount charged now may differ from the purchase price.',
  },
  {
    code: 'trade_in',
    pattern: /\btrade[ -]?in\b/i,
    detail: 'The email includes a trade-in value that may not be part of the amount charged now.',
  },
  {
    code: 'preauthorization',
    pattern: /\b(?:pre[ -]?authori[sz](?:ation|ed)|temporary hold|authorization hold|pending hold)\b/i,
    detail: 'The email describes a temporary authorization rather than a settled final charge.',
  },
  {
    code: 'split_payment',
    pattern: /\b(?:split (?:payment|tender)|multiple payment methods?|paid with (?:a )?gift card and|gift card.*(?:visa|mastercard|amex)|(?:visa|mastercard|amex).*gift card)\b/i,
    detail: 'The total appears to be split across more than one payment source.',
  },
]);

function approximatelyEqual(left, right) {
  const a = Math.abs(Number(left) || 0);
  const b = Math.abs(Number(right) || 0);
  return a > 0 && b > 0 && Math.abs(a - b) <= Math.max(0.05, b * 0.01);
}

function escapedAmountPattern(value) {
  const amount = Math.abs(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const fixed = amount.toFixed(2);
  const flexible = fixed.endsWith('.00') ? `${Math.trunc(amount)}(?:\\.00)?` : fixed.replace('.', '\\.');
  return flexible;
}

function hasExplicitSettledAmount(body = '', amount = null, eventType = 'charge') {
  const amountPattern = escapedAmountPattern(amount);
  if (!amountPattern) return false;
  const label = eventType === 'refund'
    ? '(?:refund amount|refund total|amount refunded)'
    : '(?:total charged|amount charged|charged today|amount paid|total paid|you paid|payment total|grand total|final total)';
  return new RegExp(`\\b${label}\\b[^$\\d]{0,40}(?:USD\\s*)?\\$?\\s*${amountPattern}\\b`, 'i').test(`${body || ''}`);
}

function itemTotal(items = []) {
  const amounts = (Array.isArray(items) ? items : [])
    .map((item) => Number(item?.amount))
    .filter(Number.isFinite);
  if (!amounts.length) return null;
  return Number(amounts.reduce((sum, amount) => sum + amount, 0).toFixed(2));
}

function assessEmailAmount({
  body = '',
  parsedAmount = null,
  items = [],
  eventType = 'charge',
} = {}) {
  const amount = Math.abs(Number(parsedAmount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      confidence: 'low',
      questionable: true,
      source: 'missing_amount',
      detail: 'A reliable final transaction amount was not found.',
      reason_codes: ['missing_amount'],
      requires_full_review: true,
    };
  }

  const ambiguities = AMOUNT_AMBIGUITY_RULES.filter((rule) => rule.pattern.test(`${body || ''}`));
  const explicitSettled = hasExplicitSettledAmount(body, amount, eventType);
  const deterministicTotal = extractDeterministicTotalAmount(body);
  const deterministicMatch = approximatelyEqual(amount, deterministicTotal);
  const extractedItemTotal = itemTotal(items);
  const itemMatch = approximatelyEqual(amount, extractedItemTotal);
  const materialAmbiguity = ambiguities.some((rule) => rule.code !== 'split_payment');

  let confidence = 'low';
  let source = 'extraction';
  let detail = 'The final charged total was not tied to a strong amount label. Confirm it before approving.';

  if (explicitSettled) {
    confidence = 'high';
    source = eventType === 'refund' ? 'refund_total' : 'settled_total';
    detail = eventType === 'refund'
      ? 'The amount matches an explicit completed refund total in the email.'
      : 'The amount matches an explicit final charge or amount-paid total in the email.';
  } else if (deterministicMatch && !materialAmbiguity) {
    confidence = 'high';
    source = 'email_total';
    detail = 'The amount matches the email’s explicit final or order total.';
  } else if (deterministicMatch || itemMatch) {
    confidence = materialAmbiguity ? 'low' : 'medium';
    source = deterministicMatch ? 'email_total' : 'line_items';
    detail = materialAmbiguity
      ? ambiguities[0].detail
      : 'The amount is supported by the extracted order total or line items, but should be double-checked.';
  } else if (materialAmbiguity) {
    detail = ambiguities[0].detail;
  }

  const reasonCodes = ambiguities.map((rule) => rule.code);
  if (!explicitSettled && !deterministicMatch && !itemMatch) reasonCodes.push('no_final_total_anchor');

  return {
    confidence,
    questionable: confidence === 'low',
    source,
    detail,
    reason_codes: [...new Set(reasonCodes)],
    requires_full_review: confidence === 'low',
    deterministic_total: Number.isFinite(Number(deterministicTotal)) ? Math.abs(Number(deterministicTotal)) : null,
    item_total: Number.isFinite(Number(extractedItemTotal)) ? Math.abs(Number(extractedItemTotal)) : null,
  };
}

module.exports = {
  AMOUNT_AMBIGUITY_RULES,
  assessEmailAmount,
  hasExplicitSettledAmount,
};
