const assert = require('assert');
const { createExpenseIdempotencyKey } = require('../services/expenseIdempotency');

const first = createExpenseIdempotencyKey('manual');
const second = createExpenseIdempotencyKey('manual');

assert.match(first, /^manual:[a-z0-9]+:[a-z0-9]+:[a-z0-9]+$/);
assert.notStrictEqual(first, second);
assert.ok(first.length <= 128);

process.stdout.write('[mobile-logic] expense idempotency checks passed\n');
