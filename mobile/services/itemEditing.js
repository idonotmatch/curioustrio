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

function createEditableExpenseItem(item = {}) {
  return {
    ...item,
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

function normalizeExpenseItemPayload(item = {}) {
  return {
    description: `${item.description || ''}`.trim(),
    amount: item.amount ? parseItemNumber(item.amount) : null,
    quantity: item.quantity ? parseItemNumber(item.quantity) : null,
    unit_price: item.unit_price ? parseItemNumber(item.unit_price) : null,
    upc: item.upc || null,
    sku: item.sku || null,
    brand: item.brand || null,
    product_size: item.product_size || null,
    pack_size: item.pack_size || null,
    unit: item.unit || null,
  };
}

module.exports = {
  createEditableExpenseItem,
  normalizeExpenseItemPayload,
  parseItemNumber,
  updateEditableExpenseItem,
};
