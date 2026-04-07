const ITEM_TYPE_PATTERNS = {
  discount: /^(discount|coupon|promo(?:tion)?|savings|reward|credit|markdown|sale discount)/i,
  fee: /^(tax|hst|gst|pst|vat|tip|gratuity|service charge|service fee|delivery fee|shipping|handling|bag fee|surcharge|platform fee|processing fee)/i,
  summary: /^(subtotal|total|order total|amount paid|amount charged|grand total)/i,
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
