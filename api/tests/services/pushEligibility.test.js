const {
  safePushData,
  shouldSendGmailReviewPush,
  shouldSendInsightPush,
} = require('../../src/services/pushEligibility');

describe('pushEligibility', () => {
  const allowedTypes = new Set(['recurring_repurchase_due']);

  it('blocks low-confidence or already-sent insight pushes', () => {
    expect(shouldSendInsightPush({
      allowedTypes,
      insight: { id: 'a', type: 'recurring_repurchase_due', severity: 'low' },
    })).toMatchObject({ send: false, reason: 'not_actionable' });

    expect(shouldSendInsightPush({
      allowedTypes,
      sentIds: new Set(['b']),
      insight: { id: 'b', type: 'recurring_repurchase_due', severity: 'medium' },
    })).toMatchObject({ send: false, reason: 'already_sent' });
  });

  it('allows actionable supported insight pushes', () => {
    expect(shouldSendInsightPush({
      allowedTypes,
      insight: { id: 'c', type: 'recurring_repurchase_due', severity: 'medium', metadata: { confidence: 'comparative' } },
    })).toMatchObject({ send: true });
  });

  it('only sends Gmail review pushes when actionable review work exists', () => {
    expect(shouldSendGmailReviewPush({ imported: 2, pendingReview: 0 })).toMatchObject({ send: false });
    expect(shouldSendGmailReviewPush({ imported: 2, pendingReview: 1 })).toMatchObject({ send: true });
  });

  it('strips sensitive transaction details from push data', () => {
    expect(safePushData({ merchant: 'Store', route: '/review-queue', count: 2 })).toEqual({
      route: '/review-queue',
      count: 2,
    });
  });
});
