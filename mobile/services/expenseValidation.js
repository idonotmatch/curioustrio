function isValidExpenseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(`${value || ''}`)) return false;
  const [year, month, day] = `${value}`.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function expenseDraftError({ merchant, amount, date } = {}) {
  if (!`${merchant || ''}`.trim()) return 'Add a merchant or description before saving.';
  const numericAmount = Number(amount);
  if (amount === '' || amount == null || !Number.isFinite(numericAmount) || numericAmount === 0) {
    return 'Enter a non-zero amount before saving.';
  }
  if (!isValidExpenseDate(date)) return 'Choose a valid expense date before saving.';
  return null;
}

module.exports = {
  expenseDraftError,
  isValidExpenseDate,
};
