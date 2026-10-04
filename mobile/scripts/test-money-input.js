const assert = require('assert');
const { formatMoneyInput, sanitizeMoneyInput } = require('../services/moneyInput');

assert.strictEqual(formatMoneyInput('27.10'), '27.10');
assert.strictEqual(formatMoneyInput(27.1), '27.10');
assert.strictEqual(formatMoneyInput(-27.1), '27.10');
assert.strictEqual(formatMoneyInput(''), '0.00');
assert.strictEqual(sanitizeMoneyInput('$27.10'), '27.10');
assert.strictEqual(sanitizeMoneyInput('27..10'), '27.10');

process.stdout.write('[mobile-logic] money input checks passed\n');
