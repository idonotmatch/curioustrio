function sanitizeMoneyInput(value = '') {
  return `${value || ''}`.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
}

function formatMoneyInput(value, { absolute = true } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return (absolute ? Math.abs(amount) : amount).toFixed(2);
}

module.exports = { sanitizeMoneyInput, formatMoneyInput };
