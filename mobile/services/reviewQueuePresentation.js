const { normalizeDisplayText } = require('./text');

const GENERIC_TITLES = new Set([
  'e', 'email', 'emails', 'mail', 'mailer', 'member', 'message', 'news', 'newsletter',
  'newsletters', 'notification', 'notifications', 'orders', 'receipts', 'support',
]);

const KNOWN_BRANDS = {
  americanexpress: 'American Express',
  teacollection: 'Tea Collection',
  washingtonpost: 'The Washington Post',
  wholefoodsmarket: 'Whole Foods Market',
};

function clean(value = '') {
  return normalizeDisplayText(`${value || ''}`).replace(/\s+/g, ' ').trim();
}

function titleCase(value = '') {
  const normalized = clean(value);
  if (/[a-z]/.test(normalized) && /[A-Z]/.test(normalized)) return normalized;
  return normalized
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
    .replace(/(^|\s)\w/g, (match) => match.toUpperCase());
}

function isGeneric(value = '') {
  const normalized = clean(value).replace(/[^a-z]/gi, '').toLowerCase();
  return !normalized || normalized.length <= 1 || GENERIC_TITLES.has(normalized);
}

function senderBrand(fromAddress = '') {
  const raw = clean(fromAddress);
  const display = titleCase(raw.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] || '');
  if (display && !isGeneric(display)) return display;

  const domain = raw.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/i)?.[1] || '';
  const labels = domain.split('.').filter(Boolean);
  if (labels.length < 2) return '';
  const compoundSuffix = labels.length >= 3 && ['co', 'com', 'org', 'net'].includes(labels.at(-2));
  const label = labels.at(compoundSuffix ? -3 : -2) || labels[0];
  return KNOWN_BRANDS[label] || titleCase(label);
}

function normalizedComparison(value = '') {
  return clean(value).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function itemSummary(item = {}) {
  const items = Array.isArray(item?.items) ? item.items : [];
  const names = items
    .map((entry) => clean(entry?.name || entry?.description))
    .filter((name) => name && !isGeneric(name));
  if (!names.length) return '';
  return names.slice(0, 2).join(' + ');
}

function reviewQueuePresentation(item = {}) {
  const fromAddress = item?.gmail_review_hint?.from_address || item?.email_from_address || '';
  const rawMerchant = clean(item?.merchant);
  const brand = senderBrand(fromAddress);
  const title = rawMerchant && !isGeneric(rawMerchant)
    ? rawMerchant
    : (brand || 'Merchant needs review');
  const subject = clean(item?.gmail_review_hint?.message_subject || item?.email_subject);
  const description = clean(item?.description);
  const candidates = [subject, itemSummary(item), description];
  const context = candidates.find((candidate) => (
    candidate
    && !isGeneric(candidate)
    && normalizedComparison(candidate) !== normalizedComparison(title)
  )) || '';

  return { title, context, subject, brand };
}

function pendingActionCount({ loadedCount = 0, serverCount = 0, optimisticDelta = 0 } = {}) {
  const loaded = Math.max(0, Number(loadedCount) || 0);
  const exact = Math.max(0, (Number(serverCount) || 0) + (Number(optimisticDelta) || 0));
  return Math.max(loaded, exact);
}

module.exports = {
  isGenericReviewTitle: isGeneric,
  pendingActionCount,
  reviewQueuePresentation,
  senderBrand,
};
