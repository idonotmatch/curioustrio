const ALLOWED_EXPENSE_SOURCES = new Set(['manual', 'camera', 'email', 'refund']);
const MAX_EXPENSE_AMOUNT = 99999999.99;

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(`${value || ''}`)) return false;
  const [year, month, day] = `${value}`.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function validateExpenseCoreFields(payload = {}, { partial = false } = {}) {
  const merchantPresent = hasOwn(payload, 'merchant');
  const amountPresent = hasOwn(payload, 'amount');
  const datePresent = hasOwn(payload, 'date');
  const sourcePresent = hasOwn(payload, 'source');

  if ((!partial || merchantPresent) && !`${payload.merchant || ''}`.trim()) {
    return { error: 'merchant is required', reason: 'missing_merchant' };
  }

  if (!partial || amountPresent) {
    const amount = Number(payload.amount);
    if (payload.amount === '' || payload.amount == null || !Number.isFinite(amount) || amount === 0) {
      return { error: 'amount must be a non-zero number', reason: 'invalid_amount' };
    }
    if (Math.abs(amount) > MAX_EXPENSE_AMOUNT) {
      return { error: 'amount is too large', reason: 'amount_out_of_range' };
    }
  }

  if ((!partial || datePresent) && !isValidDate(payload.date)) {
    return { error: 'date must be a valid YYYY-MM-DD date', reason: 'invalid_date' };
  }

  if (!partial || sourcePresent) {
    const source = `${payload.source || ''}`.trim();
    if (!ALLOWED_EXPENSE_SOURCES.has(source)) {
      return { error: 'source must be manual, camera, email, or refund', reason: 'invalid_source' };
    }
  }

  return { error: null, reason: null };
}

module.exports = {
  ALLOWED_EXPENSE_SOURCES,
  isValidDate,
  validateExpenseCoreFields,
};
