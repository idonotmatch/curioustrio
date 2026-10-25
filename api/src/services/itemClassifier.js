const ITEM_TYPE_PATTERNS = {
  discount: /^(discount|coupon|promo(?:tion)?|savings|reward|credit|markdown|sale discount)/i,
  fee: /^(?:(?:local|state|county|city|municipal|regional|[a-z ]+ transportation commerce)\s+)?(?:(?:sales|lodging|occupancy|hotel|room)\s+)?(?:tax|taxes|hst|gst|pst|vat)\b|\b(?:sales|commerce|occupancy|lodging|hotel|room) tax(?:es)?(?:\s*\([^)]*\))?$|^(?:tip|gratuity|booking fee|service charge|service fee|(?:back of house\s+)?support charge|delivery(?: fee)?|standard delivery|shipping|handling|bag fee|surcharge|platform fee|processing fee)\b/i,
  summary: /^(subtotal|total|order total|amount paid|amount charged|grand total|trip fare|ride fare|base fare|you paid\b|payment (?:sent|received)\b|.*\bpoints? earned\b)/i,
};

function classifyExpenseItemType(description = '') {
  const text = `${description || ''}`.trim();
  if (!text) return 'product';
  if (ITEM_TYPE_PATTERNS.discount.test(text)) return 'discount';
  if (ITEM_TYPE_PATTERNS.fee.test(text)) return 'fee';
  if (ITEM_TYPE_PATTERNS.summary.test(text)) return 'summary';
  return 'product';
}

function isProductLikeItem(item = {}) {
  const itemType = item.item_type || classifyExpenseItemType(item.description);
  return itemType === 'product';
}

module.exports = {
  classifyExpenseItemType,
  isProductLikeItem,
};
