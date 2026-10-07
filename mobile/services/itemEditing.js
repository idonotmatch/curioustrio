function parseItemNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number.parseFloat(`${value}`);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoneyNumber(value) {
  return Number(value).toFixed(2);
}

function formatQuantityNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  if (Math.abs(numeric - Math.round(numeric)) < 0.0001) return `${Math.round(numeric)}`;
  return numeric.toFixed(3).replace(/\.?0+$/, '');
}

function createObservationKey() {
  return `item:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function createEditableExpenseItem(item = {}) {
  return {
    ...item,
    observation_key: item.observation_key || createObservationKey(),
    raw_description: item.raw_description || item.description || '',
    description: item.description || '',
    amount: item.amount != null ? String(item.amount) : '',
    quantity: item.quantity != null ? formatQuantityNumber(item.quantity) : '',
    unit_price: item.unit_price != null ? formatMoneyNumber(item.unit_price) : '',
  };
}

function updateEditableExpenseItem(item = {}, field, value) {
  const next = {
    ...item,
    [field]: value,
    ...(['description', 'amount', 'quantity', 'unit_price'].includes(field)
      ? { extraction_confidence: 'high' }
      : {}),
  };

  const quantity = parseItemNumber(next.quantity);
  const unitPrice = parseItemNumber(next.unit_price);
  const amount = parseItemNumber(next.amount);

  if (field === 'quantity' && quantity != null && quantity > 0) {
    if (unitPrice != null) {
      next.amount = formatMoneyNumber(quantity * unitPrice);
    } else if (amount != null) {
      next.unit_price = formatMoneyNumber(amount / quantity);
    }
  }

  if (field === 'unit_price' && quantity != null && quantity > 0 && unitPrice != null) {
    next.amount = formatMoneyNumber(quantity * unitPrice);
  }

  if (field === 'amount' && quantity != null && quantity > 0 && amount != null) {
    next.unit_price = formatMoneyNumber(amount / quantity);
  }

  return next;
}

function buildItemReviewPresentation(parsed = {}, editableItems = [], amountValue = null) {
  const items = Array.isArray(editableItems) ? editableItems : [];
  if (!items.length) return null;

  const amount = Number(amountValue ?? parsed?.amount);
  const subtotal = Number(parsed?.subtotal);
  const hasSubtotal = parsed?.subtotal != null && parsed?.subtotal !== '' && Number.isFinite(subtotal);
  const comparableItems = hasSubtotal
    ? items.filter((item) => !item?.item_type || item.item_type === 'product')
    : items;
  const pricedItems = comparableItems.filter((item) => Number.isFinite(Number.parseFloat(`${item?.amount ?? ''}`)));
  const itemSum = pricedItems.length
    ? pricedItems.reduce((sum, item) => sum + Number.parseFloat(`${item.amount}`), 0)
    : null;
  const targetAmount = hasSubtotal ? subtotal : amount;
  const discounts = Number(parsed?.discounts);
  const discountExplainsGap = hasSubtotal
    && itemSum != null
    && parsed?.discounts != null
    && parsed?.discounts !== ''
    && Number.isFinite(discounts)
    && Math.abs((itemSum - Math.abs(discounts)) - targetAmount) <= Math.max(0.05, Math.abs(targetAmount) * 0.01);
  const status = (
    pricedItems.length === 0
      ? 'unpriced'
      : pricedItems.length < comparableItems.length
        ? 'partial'
        : Number.isFinite(targetAmount) && !discountExplainsGap && Math.abs(itemSum - targetAmount) > Math.max(0.05, Math.abs(targetAmount) * 0.01)
          ? 'mismatch'
          : 'matched'
  );

  if (status === 'mismatch') {
    return {
      tone: 'warning',
      title: 'Check the item total',
      body: Number.isFinite(targetAmount) && itemSum != null
        ? `Items add to $${itemSum.toFixed(2)}, while the ${hasSubtotal ? 'receipt subtotal' : 'expense'} is $${Math.abs(targetAmount).toFixed(2)}. Correct a line total that does not look right.`
        : 'The item prices do not match the expense total. Correct them, or leave them if tax or fees explain the difference.',
    };
  }

  if (status === 'partial') {
    return {
      tone: 'neutral',
      title: `${pricedItems.length} of ${comparableItems.length} item prices captured`,
      body: 'Add the missing prices if you know them, or save now and keep the item names for matching and trends.',
    };
  }

  if (status === 'unpriced') {
    return {
      tone: 'neutral',
      title: `${items.length} ${items.length === 1 ? 'item' : 'items'} found`,
      body: 'Add prices if you know them, or save now and keep the item names for matching and trends.',
    };
  }

  if (items.some((item) => item?.extraction_confidence === 'low')) {
    return {
      tone: 'warning',
      title: 'Check the item details',
      body: 'Some item details were uncertain. Correct anything that does not look right before saving.',
    };
  }

  return null;
}

function normalizeExpenseItemPayload(item = {}) {
  return {
    description: `${item.description || ''}`.trim(),
    amount: item.amount ? parseItemNumber(item.amount) : null,
    quantity: item.quantity ? parseItemNumber(item.quantity) : null,
    unit_price: item.unit_price ? parseItemNumber(item.unit_price) : null,
    item_type: item.item_type || null,
    upc: item.upc || null,
    sku: item.sku || null,
    brand: item.brand || null,
    product_size: item.product_size || null,
    pack_size: item.pack_size || null,
    unit: item.unit || null,
    observation_key: item.observation_key || null,
    source_type: item.source_type || null,
    raw_description: `${item.raw_description || item.description || ''}`.trim() || null,
    extraction_confidence: item.extraction_confidence || null,
  };
}

function buildExpenseItemsPatch(items = [], { includeItems = true } = {}) {
  if (!includeItems) return {};
  return {
    items: (Array.isArray(items) ? items : [])
      .filter((item) => `${item?.description || ''}`.trim())
      .map((item) => normalizeExpenseItemPayload(item)),
  };
}

module.exports = {
  createEditableExpenseItem,
  buildExpenseItemsPatch,
  buildItemReviewPresentation,
  normalizeExpenseItemPayload,
  parseItemNumber,
  updateEditableExpenseItem,
};
