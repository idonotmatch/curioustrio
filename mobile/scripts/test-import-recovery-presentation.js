const assert = require('assert');
const { importHistoryTitle, importHistoryReason, importRecoveryMessage } = require('../services/importRecoveryPresentation');

assert.strictEqual(importHistoryTitle({ subject: 'Receipt &amp; invoice' }), 'Receipt & invoice');
assert.strictEqual(importHistoryTitle({ subject_pattern: 'generic_receipt' }), 'Receipt');
assert.strictEqual(importHistoryReason({ status: 'skipped', skip_reason: 'duplicate_expense' }), 'Previously skipped as a possible duplicate');
assert.strictEqual(importHistoryReason({ status: 'failed', skip_reason: 'sensitive internal error' }), 'Import could not be completed');
assert.match(importHistoryReason({ status: 'skipped', skip_reason: 'template_skip_generic_receipt' }), /review history/);
assert.match(importRecoveryMessage({ imported: 1 }), /Pending/);
assert.match(importRecoveryMessage({ skipped: 1, reason: 'missing_amount' }), /Nothing was added/);
assert.match(importRecoveryMessage({ skipped: 1, reason: 'duplicate_expense' }), /duplicate comparison/);
assert.match(importRecoveryMessage({ failed: 1 }), /failed/);
console.log('[mobile-logic] import recovery presentation checks passed');
