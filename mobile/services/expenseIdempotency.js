function randomSegment() {
  return Math.random().toString(36).slice(2, 10);
}

function createExpenseIdempotencyKey(prefix = 'expense') {
  return `${prefix}:${Date.now().toString(36)}:${randomSegment()}:${randomSegment()}`;
}

module.exports = { createExpenseIdempotencyKey };
