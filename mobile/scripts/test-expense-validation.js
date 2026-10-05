const assert = require('assert');
const { expenseDraftError, isValidExpenseDate } = require('../services/expenseValidation');

assert.strictEqual(expenseDraftError({ merchant: 'Cafe', amount: '27.10', date: '2026-10-04' }), null);
assert.match(expenseDraftError({ merchant: ' ', amount: '27.10', date: '2026-10-04' }), /merchant/i);
assert.match(expenseDraftError({ merchant: 'Cafe', amount: '0', date: '2026-10-04' }), /amount/i);
assert.match(expenseDraftError({ merchant: 'Cafe', amount: 'abc', date: '2026-10-04' }), /amount/i);
assert.match(expenseDraftError({ merchant: 'Cafe', amount: '27.10', date: '2026-02-30' }), /date/i);
assert.strictEqual(isValidExpenseDate('2024-02-29'), true);
assert.strictEqual(isValidExpenseDate('2025-02-29'), false);

process.stdout.write('[mobile-logic] expense validation checks passed\n');
