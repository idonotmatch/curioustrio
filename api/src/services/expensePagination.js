function encodeExpenseCursor(expense = {}) {
  if (!expense?.id || !expense?.date || !expense?.created_at) return null;
  return Buffer.from(JSON.stringify({
    date: expense.date,
    created_at: expense.created_at,
    id: expense.id,
  })).toString('base64url');
}

function decodeExpenseCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(`${value}`, 'base64url').toString('utf8'));
    if (!parsed?.id || !/^\d{4}-\d{2}-\d{2}/.test(`${parsed?.date || ''}`)) return null;
    if (Number.isNaN(new Date(parsed.created_at).getTime())) return null;
    return {
      id: `${parsed.id}`,
      date: `${parsed.date}`.slice(0, 10),
      created_at: new Date(parsed.created_at).toISOString(),
    };
  } catch {
    return null;
  }
}

function buildExpensePage(rows = [], pageSize = 25) {
  const safeSize = Math.max(1, Math.min(Number(pageSize) || 25, 50));
  const hasMore = rows.length > safeSize;
  const items = rows.slice(0, safeSize);
  return {
    items,
    next_cursor: hasMore ? encodeExpenseCursor(items[items.length - 1]) : null,
  };
}

module.exports = {
  buildExpensePage,
  decodeExpenseCursor,
  encodeExpenseCursor,
};
