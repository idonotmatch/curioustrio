const assert = require('assert');
const {
  fieldProvenance,
  confidencePresentation,
  locationStatusPresentation,
  reviewReasonSummary,
  sourcePresentation,
} = require('../services/provenancePresentation');
const { buildPriorityReviewFields } = require('../services/expenseDetailPresentation');

assert.strictEqual(sourcePresentation({ source: 'email', review_source: 'gmail' }).label, 'Gmail import');
assert.strictEqual(sourcePresentation({ source: 'camera' }).label, 'Receipt scan');
assert.strictEqual(sourcePresentation({ source: 'share' }).label, 'Receipt file');
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
const priorityFields = buildPriorityReviewFields({
  expense: { merchant: 'Corner Cafe', amount: 18.4, items: [] },
  gmailReviewHint: {
    field_evidence: {
      merchant: { confidence: 'high', questionable: false, detail: 'Matched the subject.' },
      amount: { confidence: 'low', questionable: true, detail: 'Final total was not explicit.' },
      date: { confidence: 'medium', questionable: false, detail: 'Used the received date.' },
    },
    questionable_fields: ['amount'],
  },
  formattedDate: 'Oct 4, 2026',
  categoryLabel: 'Dining',
});
assert.deepStrictEqual(priorityFields.map((field) => field.key), ['amount']);

process.stdout.write('[mobile-logic] provenance presentation checks passed\n');
