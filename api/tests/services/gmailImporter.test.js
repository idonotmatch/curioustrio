const {
  findLikelyAmount,
  normalizePeerPaymentExpense,
  normalizeParsedAmountAgainstDeterministicTotal,
  buildGmailImportPushPayload,
  buildItemHistoryReviewAdjustment,
  buildStructuredItemReviewAdjustment,
  buildEmailItemsForPersistence,
  shouldSkipTemplateBeforeClassification,
  discoverGmailMessages,
} = require('../../src/services/gmailImporter');

describe('discoverGmailMessages', () => {
  it('uses Gmail history after an initial cursor has been stored', async () => {
    const gmailSession = {
      listHistoryMessages: jest.fn().mockResolvedValue({
        messages: [{ id: 'new-message' }],
        historyId: '103',
      }),
      listRecentMessages: jest.fn(),
      getProfileHistoryId: jest.fn(),
    };

    await expect(discoverGmailMessages('user-1', gmailSession, { gmail_history_id: '100' }))
      .resolves.toEqual({
        messages: [{ id: 'new-message' }],
        nextHistoryId: '103',
        syncMode: 'incremental',
      });
    expect(gmailSession.listRecentMessages).not.toHaveBeenCalled();
  });

  it('falls back to a bounded recovery scan when Gmail expires the cursor', async () => {
    const expired = Object.assign(new Error('history expired'), { response: { status: 404 } });
    const gmailSession = {
      listHistoryMessages: jest.fn().mockRejectedValue(expired),
      getProfileHistoryId: jest.fn().mockResolvedValue('205'),
      listRecentMessages: jest.fn().mockResolvedValue([{ id: 'recovered-message' }]),
    };

    await expect(discoverGmailMessages('user-1', gmailSession, { gmail_history_id: '100' }))
      .resolves.toEqual({
        messages: [{ id: 'recovered-message' }],
        nextHistoryId: '205',
        syncMode: 'recovery',
      });
  });
});

describe('buildEmailItemsForPersistence', () => {
  it('trusts deterministic item matches and lowers confidence for inconsistent item math', () => {
    const result = buildEmailItemsForPersistence([
      { description: 'Avocados', amount: 6, quantity: 2, unit_price: 3 },
      { description: 'Strawberries', amount: 9, quantity: 2, unit_price: 3 },
    ], [
      { description: 'Avocados', amount: 6, quantity: 2, unit_price: 3 },
    ]);

    expect(result[0]).toEqual(expect.objectContaining({
      source_type: 'email',
      extraction_confidence: 'high',
    }));
    expect(result[1]).toEqual(expect.objectContaining({
      source_type: 'email',
      extraction_confidence: 'low',
    }));
  });
});

describe('shouldSkipTemplateBeforeClassification', () => {
  it('honors repeated explicit exclusion feedback even when the email contains a total', () => {
    expect(shouldSkipTemplateBeforeClassification({
      templateQuality: { should_skip_prequeue: true, filtering_dismissals: 2 },
      signals: { shouldSurfaceToReview: true, strongMoneySignal: true, mediumMoneySignal: true },
    })).toBe(true);
  });

  it('does not apply learned filtering when the user forces review', () => {
    expect(shouldSkipTemplateBeforeClassification({
      templateQuality: { should_skip_prequeue: true, filtering_dismissals: 3 },
      signals: { shouldSurfaceToReview: true, strongMoneySignal: true },
      senderForceReview: true,
    })).toBe(false);
  });

  it('only applies baseline template filtering when transaction signals are absent', () => {
    expect(shouldSkipTemplateBeforeClassification({
      templateQuality: { should_skip_prequeue: true, filtering_dismissals: 0 },
      signals: { shouldSurfaceToReview: true, strongMoneySignal: true },
    })).toBe(false);
  });
});

describe('findLikelyAmount', () => {
  it('prefers an explicit total over trailing savings-like amounts', () => {
    expect(findLikelyAmount(
      'Whole Foods receipt',
      '',
      'Subtotal $20.94 Total Savings -$1.61 Sales Tax $0.51 Total $19.84 $1.61 promotions applied'
    )).toBe(19.84);
  });

  it('does not turn an unlabeled promotional price into an expense total', () => {
    expect(findLikelyAmount(
      'Exclusive deals: Save $300',
      'XGIMI for $849',
      'Shop products starting at $109. Offer ends soon.'
    )).toBeNull();
  });

  it('does not treat a year following the word total as money', () => {
    expect(findLikelyAmount('Daily update', '', 'The total for 2026 remains unknown.')).toBeNull();
  });
});

describe('normalizeParsedAmountAgainstDeterministicTotal', () => {
  it('replaces savings-like parsed amounts when the receipt has an explicit final total', () => {
    expect(normalizeParsedAmountAgainstDeterministicTotal(
      { amount: 1.61, card_last4: '9749' },
      'Subtotal $20.94 Total Savings -$1.61 Sales Tax $0.51 Total $19.84',
      { disposition: 'expense' }
    )).toEqual(expect.objectContaining({ amount: 19.84 }));
  });
});

describe('normalizePeerPaymentExpense', () => {
  it('uses the recipient as merchant and discards non-product payment-email rows', () => {
    expect(normalizePeerPaymentExpense({
      merchant: 'Coros Apex 4 Statisfy',
      notes: 'Payment sent to Jennifer A Stoops',
      items: [
        { description: 'Hello, Dang Nguyen', amount: 390 },
        { description: 'Paid with: AMEX x-1005', amount: 390 },
      ],
    })).toEqual(expect.objectContaining({
      merchant: 'Jennifer A Stoops',
      items: null,
    }));
  });
});

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
        current_item_amount: 18.49,
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
        current_item_amount: 39.99,
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
