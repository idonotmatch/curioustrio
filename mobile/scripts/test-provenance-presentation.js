const assert = require('assert');
const {
  fieldProvenance,
  confidencePresentation,
  locationStatusPresentation,
  reviewReasonSummary,
  sourcePresentation,
} = require('../services/provenancePresentation');

assert.strictEqual(sourcePresentation({ source: 'email', review_source: 'gmail' }).label, 'Gmail import');
assert.strictEqual(sourcePresentation({ source: 'camera' }).label, 'Receipt scan');
assert.strictEqual(confidencePresentation({ source: 'camera', review_fields: ['amount'] }).label, 'Check extracted fields');
assert.strictEqual(confidencePresentation({ source: 'manual' }).label, 'Entered by you');
assert.strictEqual(
  reviewReasonSummary({ gmail_review_hint: { likely_changed_fields: ['amount', 'category_id'] } }),
  'Double-check amount and category before approving.'
);
assert.deepStrictEqual(fieldProvenance({ category_source: 'manual_edit' }), [{ label: 'Category', value: 'user edit' }]);
assert.strictEqual(locationStatusPresentation({ status: 'permission_denied' }).label, 'Location unavailable');
assert.deepStrictEqual(
  locationStatusPresentation({ source: 'manual_text', status: 'user_entered' }),
  { label: 'Added by you', detail: 'Saved using the place name you entered.' }
);

process.stdout.write('[mobile-logic] provenance presentation checks passed\n');
