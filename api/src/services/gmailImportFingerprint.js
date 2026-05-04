function extractSenderDomain(fromAddress = '') {
  const raw = `${fromAddress || ''}`.trim().toLowerCase();
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw)) return raw;
  const match = raw.match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  return match?.[1] || 'unknown';
}

function extractSubjectPattern(subject = '', fromAddress = '') {
  const senderDomain = extractSenderDomain(fromAddress);
  const trimmed = `${subject || ''}`.trim();
  const normalized = trimmed.replace(/\s+/g, ' ');
  const lower = normalized.toLowerCase();

  if (senderDomain === 'amazon.com') {
    if (/^ORDER:\s*/i.test(normalized)) return 'amazon_order';
    if (/\b(refund|return|returned|refund processed)\b/i.test(normalized)) return 'amazon_refund';
    if (/\b(shipped|shipping|arriving|delivered|out for delivery|has shipped|on the way)\b/i.test(normalized)) {
      return 'amazon_shipping';
    }
    if (/\b(deal|promotion|recommended|save on|subscribe & save)\b/i.test(normalized)) {
      return 'amazon_marketing';
    }
  }

  const genericPatterns = [
    ['generic_order', /^order:\s*/i],
    ['generic_receipt', /\b(receipt|your receipt|order receipt|purchase receipt)\b/i],
    ['generic_refund', /\b(refund|return processed|refund processed|returned)\b/i],
    ['generic_shipping', /\b(shipped|shipping update|arriving|delivered|out for delivery|has shipped|on the way|ready for pickup)\b/i],
    ['generic_payment', /\b(payment sent|payment received|receipt for your payment|paid to|you paid)\b/i],
    ['generic_invoice', /\b(invoice|bill available|statement ready)\b/i],
    ['generic_subscription', /\b(subscription|renewal|membership renewal|plan renewal)\b/i],
    ['generic_trip', /\b(trip receipt|ride receipt|your trip|your ride|thanks for riding|stay receipt|booking confirmation|reservation confirmed)\b/i],
    ['generic_marketing', /\b(deal|promotion|recommended|save on|weekly deals|sale|special offer)\b/i],
  ];
  for (const [key, pattern] of genericPatterns) {
    if (pattern.test(normalized)) return key;
  }

  const leadingToken = normalized.match(/^([A-Za-z][A-Za-z0-9 '&/-]{1,30}:)/);
  if (leadingToken) return leadingToken[1].toLowerCase();

  const tokenized = lower
    .replace(/\b\d{1,4}[/-]\d{1,4}([/-]\d{2,4})?\b/g, ' * ')
    .replace(/\b\d+\b/g, ' * ')
    .replace(/\b[a-f0-9]{8,}\b/gi, ' * ')
    .replace(/\b(order|invoice|receipt|payment|refund|return|trip|booking|reservation)\s+#?[a-z0-9-]+\b/gi, '$1 *')
    .replace(/\s+/g, ' ')
    .trim();

  return tokenized.slice(0, 64) || 'unknown_subject';
}

module.exports = {
  extractSenderDomain,
  extractSubjectPattern,
};
