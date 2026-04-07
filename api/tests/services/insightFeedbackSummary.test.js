const {
  isPositiveOpportunityType,
  normalizeInsightType,
  normalizeOutcomeType,
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

describe('isPositiveOpportunityType', () => {
  it('recognizes newer positive opportunity insights', () => {
    expect(isPositiveOpportunityType('projected_month_end_under_budget')).toBe(true);
    expect(isPositiveOpportunityType('projected_category_under_baseline')).toBe(true);
    expect(isPositiveOpportunityType('recurring_restock_window')).toBe(true);
    expect(isPositiveOpportunityType('spend_pace_ahead')).toBe(false);
  });
});

describe('normalizeOutcomeType', () => {
  it('prefers explicit outcome metadata fields when present', () => {
    expect(normalizeOutcomeType({
      metadata: { outcome_type: 'restocked_item' },
    })).toBe('restocked_item');

    expect(normalizeOutcomeType({
      metadata: { action_type: 'used_headroom' },
    })).toBe('used_headroom');
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

  it('captures acted outcomes separately from taps and feedback', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'recurring_restock_window:abc:2026-04',
        event_type: 'acted',
        metadata: { type: 'recurring_restock_window', outcome_type: 'restocked_item' },
        created_at: '2026-04-04T12:00:00Z',
      },
    ]);

    expect(summary.get('recurring_restock_window')).toEqual(expect.objectContaining({
      acted: 1,
      outcomes: expect.objectContaining({ restocked_item: 1 }),
      last_acted_at: '2026-04-04T12:00:00Z',
    }));
  });

  it('captures unusual-spend review judgments from acted events', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'one_offs:personal:2026-04',
        event_type: 'acted',
        metadata: {
          type: 'one_offs_driving_variance',
          review_type: 'unusual_purchase_review',
          unusual_review: 'expected',
        },
        created_at: '2026-04-04T12:00:00Z',
      },
    ]);

    expect(summary.get('one_offs_driving_variance')).toEqual(expect.objectContaining({
      acted: 1,
      reviews: expect.objectContaining({ expected: 1 }),
    }));
  });

  it('captures category-shift review judgments from acted events', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'top_driver:personal:2026-04:groceries',
        event_type: 'acted',
        metadata: {
          type: 'top_category_driver',
          review_type: 'category_shift_review',
          category_review: 'expected_pattern',
        },
        created_at: '2026-04-04T12:00:00Z',
      },
    ]);

    expect(summary.get('top_category_driver')).toEqual(expect.objectContaining({
      acted: 1,
      reviews: expect.objectContaining({ expected_pattern: 1 }),
    }));
  });

  it('captures recurring-pressure review judgments from acted events', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'recurring_cost_pressure:household:abc',
        event_type: 'acted',
        metadata: {
          type: 'recurring_cost_pressure',
          review_type: 'recurring_pressure_review',
          recurring_review: 'expected_cost',
        },
        created_at: '2026-04-04T12:00:00Z',
      },
    ]);

    expect(summary.get('recurring_cost_pressure')).toEqual(expect.objectContaining({
      acted: 1,
      reviews: expect.objectContaining({ expected_cost: 1 }),
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

  it('demotes positive opportunity insights more when users already knew about them', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'recurring_restock_window:product:abc:2026-04',
        event_type: 'not_helpful',
        metadata: { type: 'recurring_restock_window', reason: 'already_knew' },
        created_at: new Date().toISOString(),
      },
    ]);

    expect(feedbackAdjustmentForInsight({ type: 'recurring_restock_window' }, summary)).toBeLessThan(-4);
  });

  it('boosts outcome-producing insights more strongly when users act on them', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'recurring_restock_window:product:abc:2026-04',
        event_type: 'acted',
        metadata: { type: 'recurring_restock_window', outcome_type: 'restocked_item' },
        created_at: new Date().toISOString(),
      },
    ]);

    expect(feedbackAdjustmentForInsight({ type: 'recurring_restock_window' }, summary)).toBeGreaterThan(5);
  });

  it('demotes opportunity insights that are shown repeatedly but never acted on', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'projected_month_end_under_budget:personal:2026-04',
        event_type: 'shown',
        metadata: { type: 'projected_month_end_under_budget' },
        created_at: new Date().toISOString(),
      },
      {
        insight_id: 'projected_month_end_under_budget:personal:2026-04',
        event_type: 'shown',
        metadata: { type: 'projected_month_end_under_budget' },
        created_at: new Date().toISOString(),
      },
      {
        insight_id: 'projected_month_end_under_budget:personal:2026-04',
        event_type: 'shown',
        metadata: { type: 'projected_month_end_under_budget' },
        created_at: new Date().toISOString(),
      },
      {
        insight_id: 'projected_month_end_under_budget:personal:2026-04',
        event_type: 'shown',
        metadata: { type: 'projected_month_end_under_budget' },
        created_at: new Date().toISOString(),
      },
    ]);

    expect(feedbackAdjustmentForInsight({ type: 'projected_month_end_under_budget' }, summary)).toBeLessThan(0);
  });

  it('demotes one-off explanatory insights when users say the spend was expected', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'one_off_projection:personal:2026-04',
        event_type: 'acted',
        metadata: {
          type: 'one_off_expense_skewing_projection',
          review_type: 'unusual_purchase_review',
          unusual_review: 'expected',
        },
        created_at: new Date().toISOString(),
      },
    ]);

    expect(feedbackAdjustmentForInsight({ type: 'one_off_expense_skewing_projection' }, summary)).toBeLessThan(0);
  });

  it('boosts one-off explanatory insights when users confirm the spend was truly one-off', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'one_offs:personal:2026-04',
        event_type: 'acted',
        metadata: {
          type: 'one_offs_driving_variance',
          review_type: 'unusual_purchase_review',
          unusual_review: 'truly_one_off',
        },
        created_at: new Date().toISOString(),
      },
    ]);

    expect(feedbackAdjustmentForInsight({ type: 'one_offs_driving_variance' }, summary)).toBeGreaterThan(0);
  });

  it('demotes category explanatory insights when users say the pattern was expected', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'top_driver:personal:2026-04:groceries',
        event_type: 'acted',
        metadata: {
          type: 'top_category_driver',
          review_type: 'category_shift_review',
          category_review: 'expected_pattern',
        },
        created_at: new Date().toISOString(),
      },
    ]);

    expect(feedbackAdjustmentForInsight({ type: 'top_category_driver' }, summary)).toBeLessThan(0);
  });

  it('boosts category explanatory insights when users say the shift reflects a new pattern', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'projected_category_surge:personal:2026-04:groceries',
        event_type: 'acted',
        metadata: {
          type: 'projected_category_surge',
          review_type: 'category_shift_review',
          category_review: 'new_pattern',
        },
        created_at: new Date().toISOString(),
      },
    ]);

    expect(feedbackAdjustmentForInsight({ type: 'projected_category_surge' }, summary)).toBeGreaterThan(0);
  });

  it('demotes recurring pressure insights when users say the cost is expected', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'recurring_cost_pressure:household:abc',
        event_type: 'acted',
        metadata: {
          type: 'recurring_cost_pressure',
          review_type: 'recurring_pressure_review',
          recurring_review: 'expected_cost',
        },
        created_at: new Date().toISOString(),
      },
    ]);

    expect(feedbackAdjustmentForInsight({ type: 'recurring_cost_pressure' }, summary)).toBeLessThan(0);
  });

  it('boosts recurring pressure insights when users say the pressure is real', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'recurring_cost_pressure:household:abc',
        event_type: 'acted',
        metadata: {
          type: 'recurring_cost_pressure',
          review_type: 'recurring_pressure_review',
          recurring_review: 'new_pressure',
        },
        created_at: new Date().toISOString(),
      },
    ]);

    expect(feedbackAdjustmentForInsight({ type: 'recurring_cost_pressure' }, summary)).toBeGreaterThan(0);
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

  it('suppresses positive opportunity insights longer after irrelevant/already knew feedback', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'projected_month_end_under_budget:personal:2026-04',
        event_type: 'not_helpful',
        metadata: { type: 'projected_month_end_under_budget', reason: 'already_knew' },
        created_at: new Date().toISOString(),
      },
      {
        insight_id: 'projected_month_end_under_budget:personal:2026-04',
        event_type: 'dismissed',
        metadata: { type: 'projected_month_end_under_budget' },
        created_at: new Date().toISOString(),
      },
    ]);

    expect(suppressionForInsightType('projected_month_end_under_budget', summary)).toEqual(
      expect.objectContaining({
        suppressed: true,
        cooldown_days: 30,
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
