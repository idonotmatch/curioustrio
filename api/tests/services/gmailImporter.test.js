const {
  buildGmailImportPushPayload,
  buildItemHistoryReviewAdjustment,
  buildStructuredItemReviewAdjustment,
} = require('../../src/services/gmailImporter');

describe('buildGmailImportPushPayload', () => {
  it('prioritizes review queue messaging when imported expenses need confirmation', () => {
    expect(buildGmailImportPushPayload(2, { imported_pending_review: 2 })).toEqual({
      title: '2 Gmail imports need review',
      body: '2 new receipts are waiting in your review queue.',
      data: {
        type: 'review_queue',
        route: '/review-queue',
        imported_count: 2,
        review_count: 2,
      },
    });
  });

  it('uses an auto-added message when nothing needs review', () => {
    expect(buildGmailImportPushPayload(1, { imported_pending_review: 0 })).toEqual({
      title: '1 Gmail expense added',
      body: 'A new expense was added from Gmail.',
      data: {
        type: 'gmail_import',
        route: '/(tabs)/index',
        imported_count: 1,
        review_count: 0,
      },
    });
  });
});

describe('buildItemHistoryReviewAdjustment', () => {
  it('trusts parsed items that line up with familiar history', () => {
    expect(buildItemHistoryReviewAdjustment(
      { merchant: 'Target', amount: 18.49 },
      [{
        item_name: 'Sparkling Water',
        occurrence_count: 3,
        median_amount: 17.99,
        latest_purchase: { merchant: 'Target', amount: 18.19 },
      }]
    )).toEqual({
      level: 'trusted',
      message: 'Parsed items line up with familiar purchase history.',
    });
  });

  it('downgrades parsed items that conflict with familiar history', () => {
    expect(buildItemHistoryReviewAdjustment(
      { merchant: 'Whole Foods', amount: 39.99 },
      [{
        item_name: 'Sparkling Water',
        occurrence_count: 3,
        median_amount: 17.99,
        latest_purchase: { merchant: 'Target', amount: 18.19 },
      }]
    )).toEqual({
      level: 'noisy',
      message: 'Parsed items do not line up cleanly with recent item history.',
    });
  });
});

describe('buildStructuredItemReviewAdjustment', () => {
  it('promotes strong structured item blocks into an items-first review path', () => {
    expect(buildStructuredItemReviewAdjustment({
      senderQuality: {
        level: 'trusted',
        item_reliability: { level: 'unknown' },
      },
      structuredItemSignal: { level: 'strong' },
      deterministicItemCount: 5,
    })).toEqual({
      reviewMode: 'items_first',
      item_reliability: expect.objectContaining({
        level: 'mixed',
        message: expect.stringContaining('structured item block'),
      }),
    });
  });

  it('does not override noisy senders just because item rows are structured', () => {
    expect(buildStructuredItemReviewAdjustment({
      senderQuality: {
        level: 'noisy',
        item_reliability: { level: 'noisy' },
      },
      structuredItemSignal: { level: 'strong' },
      deterministicItemCount: 5,
    })).toBeNull();
  });
});
