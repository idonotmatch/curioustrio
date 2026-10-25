const {
  analyzeEmailSignals,
  extractDeterministicTotalAmount,
} = require('./emailParser');
const {
  extractOrderId,
  extractTransactionId,
} = require('./emailTransactionLifecycle');

const GENERIC_MERCHANT_NAMES = new Set([
  'e', 'email', 'emails', 'mail', 'mailer', 'member', 'message', 'news', 'newsletter',
  'newsletters', 'notification', 'notifications', 'orders', 'receipts', 'support',
]);

const TRANSACTION_SUBJECT_PATTERNS = [
  /\b(?:your )?(?:order|purchase|payment|booking|reservation|renewal) (?:confirmation|confirmed|received|processed|successful)\b/i,
  /\b(?:receipt|invoice) (?:for|from|#|no\.?|number)\b/i,
  /\b(?:your |trip |ride |stay |payment |purchase |order )?receipt\b/i,
  /\brefund (?:issued|processed|confirmed|complete|completed)\b/i,
  /^ordered\s+\d+\s+items?\b/i,
  /\bthanks for (?:your )?(?:order|purchase|payment|riding)\b/i,
  /\b(?:you paid|payment sent|paid to)\b/i,
  /\b(?:we(?:'ve| have) )?received your .{0,50}\border\b/i,
];

const MARKETING_SUBJECT_PATTERN = /\b(?:newsletter|daily update|daily (?:brief|digest|mail)|weekly digest|google alert|breaking news|exclusive deals?|hot deals?|special offer|offer is ready|offer expiring|offer ends|save \$?\d|save up to|\d+% off|promo code|gift card|reward at|rewards? offer|activate rewards?|cash back|sale ends|warehouse sale|limited releases?|shop now|wishlist|new collection|now available|introducing|free .*(?:weekend|event|shipping|order)|benefits? (?:with|have|has)|new for sale)\b/i;
const NON_TRANSACTIONAL_SUBJECT_PATTERN = /\b(?:giveaway|editors?'? picks|club news|subscription product update|payment reminder|upcoming payment|offer expires?|offer alert|restaurants? everyone is loving|meals? for less|daily mail|renewal)\b|^pre-order\b/i;
const MARKETING_BODY_PATTERN = /\b(?:unsubscribe|manage email preferences|trouble viewing this email|view here|view (?:this email )?in (?:your )?browser|view (?:as a )?web page|view online|shop now|shop [a-z]|limited time|offer ends|promo code|cash back offer|you have won|claim your .*gift card|starting at|save (?:big|up to)|up to \d+% off|\d+% off|earn \d+%|spend \$?\d+|weekly newsletter|featured deals?|exclusive deals?|presented by|subscribe|read in browser|redeem your .*offer|new arrivals|newly listed|win (?:over )?\$?\d+|book your next adventure|check out these (?:trending|affordable)|coverage designed|email alert)\b/i;
const NEWSLETTER_SUBJECT_PATTERN = /\b(?:daily|weekly|morning|evening) (?:brief|briefing|digest|mail|newsletter|update)\b|\bnewsletter\b/i;
const EDITORIAL_BODY_PATTERN = /(?:^|\b)(?:plus[:,]|but first:|today'?s (?:news|stories)|business news|money\s*&\s*markets|read in browser|newsletter logo|presented by)(?:\b|\s)/i;
const PROMOTIONAL_SENDER_PATTERN = /^(?:offers?|promotions?|promo|marketing|newsletter|newsletters|news|store-news|announcements|dailymail)(?:[+._-]|@)/i;
const PROMOTIONAL_DOMAIN_PATTERN = /(?:^|\.)(?:offers?|promotions?|promo|marketing|newsletter|newsletters)(?:\.|$)/i;
const NEWS_SENDER_PATTERN = /(?:^|\.)(?:newsletter|newsletters|nl|news|interactive|digest)(?:\.|$)/i;
const TRUSTED_TRANSACTIONAL_SENDER_PATTERN = /@(amazon|walmart|target|uber|lyft|lyftmail|ubereats|instacart|doordash|stripe|shopify|square|paypal|venmo|expedia|delta|united|airbnb|booking|hilton|marriott|costco|bestbuy|etsy|ebay|wayfair|chewy|seamless|grubhub)\./i;

function titleCase(value = '') {
  const normalized = `${value || ''}`
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/[a-z]/.test(normalized) && /[A-Z]/.test(normalized)) return normalized;
  return normalized
    .toLowerCase()
    .replace(/(^|\s)\w/g, (match) => match.toUpperCase());
}

function senderDisplayName(fromAddress = '') {
  const raw = `${fromAddress || ''}`.trim();
  const displayMatch = raw.match(/^\s*"?([^"<]+?)"?\s*</);
  const display = titleCase(displayMatch?.[1] || '');
  if (display && !GENERIC_MERCHANT_NAMES.has(display.toLowerCase())) return display;

  const domain = raw.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/i)?.[1]
    || (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw) ? raw.toLowerCase() : '');
  if (!domain) return null;
  const labels = domain.split('.').filter(Boolean);
  const compoundSuffix = labels.length >= 3 && ['co', 'com', 'org', 'net'].includes(labels.at(-2));
  const brandLabel = labels.at(compoundSuffix ? -3 : -2) || labels[0];
  const knownBrands = {
    americanexpress: 'American Express',
    teacollection: 'Tea Collection',
    washingtonpost: 'The Washington Post',
    wholefoodsmarket: 'Whole Foods Market',
  };
  const brand = knownBrands[brandLabel] || titleCase(brandLabel);
  return brand && !GENERIC_MERCHANT_NAMES.has(brand.toLowerCase()) ? brand : null;
}

function isGenericMerchantName(value = '') {
  const normalized = `${value || ''}`.replace(/[^a-z]/gi, '').toLowerCase();
  return !normalized || normalized.length <= 1 || GENERIC_MERCHANT_NAMES.has(normalized);
}

function normalizeEmailMerchant(value, fromAddress = '') {
  const rawMerchant = `${value || ''}`.replace(/\s+/g, ' ').trim();
  const merchant = titleCase(rawMerchant);
  const senderBrand = senderDisplayName(fromAddress);
  const domain = `${fromAddress || ''}`.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/i)?.[1] || '';
  const firstDomainLabel = domain.split('.')[0]?.replace(/[^a-z0-9]/g, '') || '';
  const merchantKey = merchant.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const merchantIsMailboxLabel = domain.split('.').length >= 3
    && merchantKey
    && merchantKey === firstDomainLabel;
  if (merchant && !isGenericMerchantName(merchant) && !merchantIsMailboxLabel) return merchant;
  return senderBrand || 'Merchant needs review';
}

function hasTransactionalSubject(subject = '') {
  return TRANSACTION_SUBJECT_PATTERNS.some((pattern) => pattern.test(`${subject || ''}`));
}

function senderAddressParts(fromAddress = '') {
  const raw = `${fromAddress || ''}`.trim().toLowerCase();
  const address = raw.match(/<?([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+)>?/i)?.[1] || '';
  const [localPart = '', domain = ''] = address.split('@');
  return { address, localPart, domain };
}

function classifyNonTransactionalContent({ subject = '', fromAddress = '', body = '', snippet = '' } = {}) {
  const combined = `${subject}\n${snippet}\n${body}`;
  const { localPart, domain } = senderAddressParts(fromAddress);
  const displayName = `${fromAddress || ''}`.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] || '';
  const marketingSubject = MARKETING_SUBJECT_PATTERN.test(subject);
  const marketingBody = MARKETING_BODY_PATTERN.test(combined);
  const newsSender = NEWS_SENDER_PATTERN.test(domain);
  const promotionalSender = PROMOTIONAL_SENDER_PATTERN.test(`${localPart}@`);
  const bulkSenderDomain = /^(?:e|mail)\./i.test(domain);
  const promotionalDomain = PROMOTIONAL_DOMAIN_PATTERN.test(domain);
  const newsletterSubject = NEWSLETTER_SUBJECT_PATTERN.test(subject);
  const nonTransactionalSubject = NON_TRANSACTIONAL_SUBJECT_PATTERN.test(subject);
  const editorialBody = EDITORIAL_BODY_PATTERN.test(combined);
  const editorialDisplayName = /\b(?:daily|brief|newsletter|what'?s news|magazine|journal)\b/i.test(displayName);
  const strongContentNoise = marketingSubject
    || newsletterSubject
    || nonTransactionalSubject
    || (promotionalSender && marketingBody)
    || (promotionalDomain && marketingBody)
    || (bulkSenderDomain && (marketingBody || editorialBody))
    || (newsSender && (marketingBody || editorialBody))
    || (editorialDisplayName && editorialBody)
    || (editorialBody && marketingBody);

  return {
    marketingSubject,
    marketingBody,
    newsSender,
    promotionalSender,
    promotionalDomain,
    bulkSenderDomain,
    newsletterSubject,
    nonTransactionalSubject,
    editorialBody,
    editorialDisplayName,
    strongContentNoise,
  };
}

function buildEmailAdmissionEvidence({
  subject = '',
  fromAddress = '',
  body = '',
  snippet = '',
  labelIds = [],
  attachmentTextCount = 0,
  structuredItemSignal = {},
} = {}) {
  const combined = `${subject}\n${snippet}\n${body}`;
  const signals = analyzeEmailSignals(subject, fromAddress, combined);
  const labels = new Set((Array.isArray(labelIds) ? labelIds : []).map((label) => `${label}`.toUpperCase()));
  const transactionalSubject = hasTransactionalSubject(subject);
  const finalTotal = extractDeterministicTotalAmount(combined);
  const orderId = extractOrderId(combined);
  const transactionId = extractTransactionId(combined);
  const marketingLabel = labels.has('CATEGORY_PROMOTIONS') || labels.has('CATEGORY_SOCIAL');
  const content = classifyNonTransactionalContent({ subject, fromAddress, body, snippet });
  const {
    marketingSubject,
    marketingBody,
    newsSender,
    promotionalSender,
    promotionalDomain,
    bulkSenderDomain,
    newsletterSubject,
    nonTransactionalSubject,
    editorialBody,
    editorialDisplayName,
    strongContentNoise,
  } = content;
  const trustedTransactionalSender = TRUSTED_TRANSACTIONAL_SENDER_PATTERN.test(fromAddress);
  const strongItems = structuredItemSignal?.level === 'strong'
    && Number(structuredItemSignal?.deterministic_item_count || 0) >= 2;

  let score = 0;
  if (transactionalSubject) score += 5;
  if (Number.isFinite(finalTotal) && finalTotal !== 0) score += 5;
  if (orderId || transactionId) score += 4;
  if (strongItems && Number.isFinite(finalTotal)) score += 2;
  if (Number(attachmentTextCount || 0) > 0 && (transactionalSubject || orderId || transactionId)) score += 2;
  if (trustedTransactionalSender) score += 1;
  if (marketingLabel) score -= 4;
  if (marketingSubject) score -= 4;
  if (marketingBody) score -= 2;
  if (newsSender) score -= 3;
  if (promotionalSender) score -= 2;
  if (promotionalDomain) score -= 2;
  if (bulkSenderDomain && (marketingBody || editorialBody)) score -= 2;
  if (newsletterSubject) score -= 3;
  if (nonTransactionalSubject) score -= 4;
  if (editorialBody) score -= 2;
  if (editorialDisplayName) score -= 2;

  return {
    score,
    signals,
    transactionalSubject,
    finalTotal: Number.isFinite(finalTotal) ? finalTotal : null,
    orderId,
    transactionId,
    strongItems,
    marketingLabel,
    marketingSubject,
    marketingBody,
    newsSender,
    promotionalSender,
    promotionalDomain,
    bulkSenderDomain,
    newsletterSubject,
    nonTransactionalSubject,
    editorialBody,
    editorialDisplayName,
    strongContentNoise,
    trustedTransactionalSender,
    hasAnchor: transactionalSubject
      || (Number.isFinite(finalTotal) && finalTotal !== 0)
      || Boolean(orderId || transactionId),
  };
}

function assessEmailAdmission(input = {}) {
  if (input.forceReview) {
    return { admit: true, reason: 'user_forced_review', evidence: buildEmailAdmissionEvidence(input) };
  }

  const evidence = buildEmailAdmissionEvidence(input);
  if (!evidence.hasAnchor) {
    return { admit: false, reason: 'no_transaction_evidence', evidence };
  }
  const explicitTransactionProof = evidence.transactionalSubject && evidence.finalTotal !== null;
  if (evidence.strongContentNoise && !explicitTransactionProof) {
    return { admit: false, reason: 'non_transactional_content', evidence };
  }
  if (
    (evidence.marketingLabel || evidence.marketingSubject || evidence.newsSender)
    && evidence.score < 5
    && !explicitTransactionProof
  ) {
    return { admit: false, reason: 'marketing_or_news', evidence };
  }
  if (evidence.score < 4) {
    return { admit: false, reason: 'weak_transaction_evidence', evidence };
  }

  const disposition = `${input.classification?.disposition || ''}`.toLowerCase();
  if (disposition === 'not_expense') {
    return { admit: false, reason: 'classifier_not_expense', evidence };
  }
  if (disposition === 'uncertain' && evidence.score < 5) {
    return { admit: false, reason: 'classifier_uncertain', evidence };
  }
  return { admit: true, reason: 'transaction_evidence', evidence };
}

function assessStoredImport({ subject = '', fromAddress = '', from_address: storedFromAddress = '', snippet = '' } = {}) {
  const sender = fromAddress || storedFromAddress;
  if (hasTransactionalSubject(subject)) return { quarantine: false, reason: null };
  if (/\byour order\b/i.test(subject)) return { quarantine: false, reason: null };
  const combined = `${subject}\n${snippet}`;
  const content = classifyNonTransactionalContent({ subject, fromAddress: sender, snippet });
  const explicitOrderReference = /\b(?:order|confirmation|invoice|receipt)\s*(?:#|no\.?|number|id|:)\s*[a-z0-9-]{3,}\b/i.test(combined);
  if (explicitOrderReference) return { quarantine: false, reason: 'order_reference' };
  if (content.marketingSubject) return { quarantine: true, reason: 'marketing_subject' };
  if (content.nonTransactionalSubject) return { quarantine: true, reason: 'non_transactional_subject' };
  if (content.newsletterSubject) return { quarantine: true, reason: 'newsletter_subject' };
  if (content.newsSender) {
    return { quarantine: true, reason: 'publisher_content' };
  }
  if (content.promotionalSender || content.promotionalDomain) {
    return { quarantine: true, reason: 'promotional_sender' };
  }
  if (content.editorialBody || content.editorialDisplayName) {
    return { quarantine: true, reason: 'publisher_content' };
  }
  if (content.marketingBody) return { quarantine: true, reason: 'marketing_body' };
  if (content.strongContentNoise) return { quarantine: true, reason: 'non_transactional_content' };
  if (/\b(?:unsubscribe|manage email preferences|you have won|claim your .*gift card)\b/i.test(combined)) {
    return { quarantine: true, reason: 'marketing_body' };
  }
  return { quarantine: false, reason: null };
}

function shouldQuarantineStoredImport(input = {}) {
  return assessStoredImport(input).quarantine;
}

module.exports = {
  assessEmailAdmission,
  assessStoredImport,
  buildEmailAdmissionEvidence,
  classifyNonTransactionalContent,
  hasTransactionalSubject,
  isGenericMerchantName,
  normalizeEmailMerchant,
  senderDisplayName,
  shouldQuarantineStoredImport,
};
