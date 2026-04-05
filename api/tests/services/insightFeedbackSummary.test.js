const {
  normalizeInsightType,
  summarizeFeedbackEvents,
  feedbackAdjustmentForInsight,
  suppressionForInsightType,
  shouldSuppressInsight,
} = require('../../src/services/insightFeedbackSummary');
const { insightRankScore } = require('../../src/services/insightBuilder');

describe('normalizeInsightType', () => {
  it('prefers metadata insight_type or type when present', () => {
    expect(normalizeInsightType({
      insight_id: 'too_low:personal:2026-04',
      metadata: { insight_type: 'budget_too_low' },
    })).toBe('budget_too_low');

    expect(normalizeInsightType({
      insight_id: 'ignored',
      metadata: { type: 'recurring_repurchase_due' },
    })).toBe('recurring_repurchase_due');
  });

  it('maps legacy id prefixes back to canonical insight types', () => {
    expect(normalizeInsightType({ insight_id: 'top_driver:personal:2026-04:groceries' })).toBe('top_category_driver');
    expect(normalizeInsightType({ insight_id: 'one_offs:personal:2026-04' })).toBe('one_offs_driving_variance');
    expect(normalizeInsightType({ insight_id: 'too_low:personal:2026-04' })).toBe('budget_too_low');
  });
});

describe('summarizeFeedbackEvents', () => {
  it('aggregates feedback counts and reasons by insight type', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'spend_pace_ahead:personal:2026-04',
        event_type: 'shown',
        metadata: { type: 'spend_pace_ahead' },
        created_at: '2026-04-04T10:00:00Z',
      },
      {
        insight_id: 'spend_pace_ahead:personal:2026-04',
        event_type: 'not_helpful',
        metadata: { type: 'spend_pace_ahead', reason: 'wrong_timing' },
        created_at: '2026-04-04T11:00:00Z',
      },
      {
        insight_id: 'spend_pace_ahead:personal:2026-04',
        event_type: 'helpful',
        metadata: { type: 'spend_pace_ahead' },
        created_at: '2026-04-04T12:00:00Z',
      },
    ]);

    expect(summary.get('spend_pace_ahead')).toEqual(expect.objectContaining({
      shown: 1,
      not_helpful: 1,
      helpful: 1,
      reasons: expect.objectContaining({ wrong_timing: 1 }),
    }));
  });
});

describe('feedbackAdjustmentForInsight', () => {
  it('demotes insight types with repeated negative signals', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'spend_pace_ahead:personal:2026-04',
        event_type: 'not_helpful',
        metadata: { type: 'spend_pace_ahead', reason: 'not_relevant' },
        created_at: new Date().toISOString(),
      },
      {
        insight_id: 'spend_pace_ahead:personal:2026-04',
        event_type: 'dismissed',
        metadata: null,
        created_at: new Date().toISOString(),
      },
    ]);

    expect(feedbackAdjustmentForInsight({ type: 'spend_pace_ahead' }, summary)).toBeLessThan(0);
  });

  it('boosts insight types with helpful engagement', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'recurring_repurchase_due:product:abc:2026-04-08',
        event_type: 'helpful',
        metadata: null,
        created_at: new Date().toISOString(),
      },
      {
        insight_id: 'recurring_repurchase_due:product:abc:2026-04-08',
        event_type: 'tapped',
        metadata: { type: 'recurring_repurchase_due' },
        created_at: new Date().toISOString(),
      },
    ]);

    expect(feedbackAdjustmentForInsight({ type: 'recurring_repurchase_due' }, summary)).toBeGreaterThan(0);
  });
});

describe('suppressionForInsightType', () => {
  it('suppresses repeatedly not-helpful insight types for a cooldown window', () => {
    const now = new Date().toISOString();
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'spend_pace_ahead:personal:2026-04',
        event_type: 'not_helpful',
        metadata: { type: 'spend_pace_ahead', reason: 'not_relevant' },
        created_at: now,
      },
      {
        insight_id: 'spend_pace_ahead:personal:2026-04',
        event_type: 'not_helpful',
        metadata: { type: 'spend_pace_ahead', reason: 'not_relevant' },
        created_at: now,
      },
    ]);

    expect(suppressionForInsightType('spend_pace_ahead', summary)).toEqual(
      expect.objectContaining({
        suppressed: true,
        cooldown_days: 21,
        reason: 'not_relevant',
      })
    );
  });

  it('uses a shorter cooldown for wrong timing feedback', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'recurring_repurchase_due:product:abc:2026-04-08',
        event_type: 'not_helpful',
        metadata: { type: 'recurring_repurchase_due', reason: 'wrong_timing' },
        created_at: new Date().toISOString(),
      },
    ]);

    expect(suppressionForInsightType('recurring_repurchase_due', summary)).toEqual(
      expect.objectContaining({
        suppressed: true,
        cooldown_days: 7,
        reason: 'wrong_timing',
      })
    );
  });

  it('does not suppress after the cooldown has passed', () => {
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'buy_soon_better_price:product:abc:target:2026-04-04',
        event_type: 'not_helpful',
        metadata: { type: 'buy_soon_better_price', reason: 'wrong_timing' },
        created_at: old,
      },
    ]);

    expect(suppressionForInsightType('buy_soon_better_price', summary).suppressed).toBe(false);
  });
});

describe('shouldSuppressInsight', () => {
  it('filters insight objects by the current cooldown state', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'top_driver:personal:2026-04:groceries',
        event_type: 'dismissed',
        metadata: null,
        created_at: new Date().toISOString(),
      },
      {
        insight_id: 'top_driver:personal:2026-04:groceries',
        event_type: 'dismissed',
        metadata: null,
        created_at: new Date().toISOString(),
      },
    ]);

    expect(shouldSuppressInsight({ type: 'top_category_driver' }, summary)).toBe(true);
  });
});

describe('insightRankScore', () => {
  it('lets user feedback outrank same-severity candidates', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'recurring_repurchase_due:product:abc:2026-04-08',
        event_type: 'helpful',
        metadata: { type: 'recurring_repurchase_due' },
        created_at: new Date().toISOString(),
      },
      {
        insight_id: 'buy_soon_better_price:product:abc:target:2026-04-04',
        event_type: 'not_helpful',
        metadata: { type: 'buy_soon_better_price', reason: 'not_relevant' },
        created_at: new Date().toISOString(),
      },
    ]);

    const dueScore = insightRankScore({ type: 'recurring_repurchase_due', severity: 'medium' }, summary);
    const dealScore = insightRankScore({ type: 'buy_soon_better_price', severity: 'medium' }, summary);
    expect(dueScore).toBeGreaterThan(dealScore);
  });
});
