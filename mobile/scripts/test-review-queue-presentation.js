const assert = require('assert');
const {
  isGenericReviewTitle,
  pendingActionCount,
  reviewQueuePresentation,
  senderBrand,
} = require('../services/reviewQueuePresentation');

assert.strictEqual(isGenericReviewTitle('Newsletter'), true);
assert.strictEqual(isGenericReviewTitle('E'), true);
assert.strictEqual(isGenericReviewTitle('Amazon'), false);
assert.strictEqual(senderBrand('News <news@e.washingtonpost.com>'), 'The Washington Post');
assert.strictEqual(senderBrand("McDonald's <receipts@mcdonalds.com>"), "McDonald's");

assert.deepStrictEqual(
  reviewQueuePresentation({
    merchant: 'Newsletter',
    email_from_address: 'Amazon.com <store-news@amazon.com>',
    email_subject: 'Your Amazon.com order #123-456 has shipped',
  }),
  {
    title: 'Amazon.com',
    context: 'Your Amazon.com order #123-456 has shipped',
    subject: 'Your Amazon.com order #123-456 has shipped',
    brand: 'Amazon.com',
  }
);

assert.deepStrictEqual(
  reviewQueuePresentation({
    merchant: 'Whole Foods Market',
    email_from_address: 'orders@wholefoodsmarket.com',
    email_subject: 'Whole Foods Market',
    items: [{ name: 'Organic strawberries' }, { description: 'Hass avocados' }],
  }),
  {
    title: 'Whole Foods Market',
    context: 'Organic strawberries + Hass avocados',
    subject: 'Whole Foods Market',
    brand: 'Whole Foods Market',
  }
);

assert.strictEqual(pendingActionCount({ loadedCount: 25, serverCount: 83 }), 83);
assert.strictEqual(pendingActionCount({ loadedCount: 25, serverCount: 83, optimisticDelta: -2 }), 81);
assert.strictEqual(pendingActionCount({ loadedCount: 25, serverCount: 0 }), 25);
assert.strictEqual(pendingActionCount({ loadedCount: 0, serverCount: 1, optimisticDelta: -1 }), 0);

console.log('[review-queue-presentation] tests passed');
