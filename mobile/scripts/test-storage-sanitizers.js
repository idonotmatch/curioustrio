const assert = require('assert');
const {
  sanitizeCurrentUserCache,
  sanitizeExpenseCollection,
  sanitizeExpenseSnapshot,
  sanitizeInsightSnapshot,
} = require('../services/storageSanitizers');

function run() {
  const sanitizedExpense = sanitizeExpenseSnapshot({
    id: 'expense-1',
    merchant: 'Whole Foods',
    amount: 19.84,
    email_subject: 'Your Whole Foods receipt',
    email_from_address: 'receipts@example.com',
    email_snippet: 'Here is your receipt...',
    gmail_review_hint: { likely_changed_fields: ['items'] },
    item_review_context: [{ label: 'OLIPOP', amount: 2.59 }],
    items: [
      {
        id: 'item-1',
        description: 'OLIPOP',
        amount: 2.59,
        product_id: 'prod-1',
        metadata: { raw: 'should-drop' },
      },
    ],
  });

  assert.strictEqual(sanitizedExpense.email_subject, undefined, 'expense snapshot should not retain email subject');
  assert.strictEqual(sanitizedExpense.email_from_address, undefined, 'expense snapshot should not retain sender');
  assert.strictEqual(sanitizedExpense.email_snippet, undefined, 'expense snapshot should not retain email snippets');
  assert.strictEqual(sanitizedExpense.gmail_review_hint, undefined, 'expense snapshot should not retain Gmail review hints');
  assert.strictEqual(sanitizedExpense.item_review_context, undefined, 'expense snapshot should not retain item review context');
  assert.strictEqual(sanitizedExpense.items[0].metadata, undefined, 'item metadata should be stripped from local cache');

  const sanitizedInsight = sanitizeInsightSnapshot({
    id: 'insight-1',
    title: 'Price is drifting up',
    body: 'You have been paying more lately.',
    metadata: {
      scope: 'personal',
      confidence: 'high',
      recent_expenses: [{ merchant: 'Whole Foods', amount: 19.84 }],
      consolidated_scopes: ['personal', 'household'],
    },
    action: {
      cta: 'Compare stores',
      next_step_type: 'open_activity',
      internal_payload: { debug: true },
    },
  });

  assert.deepStrictEqual(
    sanitizedInsight.metadata,
    { scope: 'personal', confidence: 'high', consolidated_scopes: ['personal', 'household'] },
    'insight snapshot should keep high-level metadata and drop nested evidence rows'
  );
  assert.deepStrictEqual(
    sanitizedInsight.action,
    { cta: 'Compare stores', next_step_type: 'open_activity' },
    'insight snapshot should keep user-facing action fields only'
  );

  const sanitizedUser = sanitizeCurrentUserCache({
    id: 'user-1',
    auth_user_id: 'auth0|user-1',
    name: 'Pat',
    email: 'pat@example.com',
    budget_start_day: 15,
    onboarding_complete: true,
  });
  assert.strictEqual(sanitizedUser.email, undefined, 'current user cache should drop email');

  const collection = sanitizeExpenseCollection([
    { id: 'expense-2', merchant: 'Coffee', amount: 4.5 },
    { id: null, merchant: 'Invalid' },
  ]);
  assert.strictEqual(collection.length, 1, 'expense collections should keep only valid snapshots');

  process.stdout.write('[mobile-logic] storage sanitizers checks passed\n');
}

run();
