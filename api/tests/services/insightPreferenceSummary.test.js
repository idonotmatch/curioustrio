const {
  buildInsightPreferenceSummary,
  preferenceAdjustmentForInsight,
  roleForInsightType,
} = require('../../src/services/insightPreferenceSummary');

describe('roleForInsightType', () => {
  it('maps known insight types into stable roles', () => {
    expect(roleForInsightType('buy_soon_better_price')).toBe('act');
    expect(roleForInsightType('projected_month_end_under_budget')).toBe('plan');
    expect(roleForInsightType('item_staple_emerging')).toBe('explain');
    expect(roleForInsightType('usage_set_budget')).toBe('setup');
  });
});

describe('buildInsightPreferenceSummary', () => {
  it('learns scope, maturity, role, and type preferences from exposure and feedback history', () => {
    const summary = buildInsightPreferenceSummary([
      {
        insight_id: 'item_merchant_variance:personal:milk',
        event_type: 'shown',
        metadata: {
          type: 'item_merchant_variance',
          scope: 'personal',
          maturity: 'developing',
        },
      },
      {
        insight_id: 'item_merchant_variance:personal:milk',
        event_type: 'tapped',
        metadata: {
          type: 'item_merchant_variance',
          scope: 'personal',
          maturity: 'developing',
        },
      },
      {
        insight_id: 'item_merchant_variance:personal:milk',
        event_type: 'helpful',
        metadata: {
          type: 'item_merchant_variance',
          scope: 'personal',
          maturity: 'developing',
        },
      },
      {
        insight_id: 'budget_too_low:household:2026-04',
        event_type: 'shown',
        metadata: {
          type: 'budget_too_low',
          scope: 'household',
          maturity: 'mature',
        },
      },
      {
        insight_id: 'budget_too_low:household:2026-04',
        event_type: 'dismissed',
        metadata: {
          type: 'budget_too_low',
          scope: 'household',
          maturity: 'mature',
        },
      },
    ]);

    expect(summary.preferred_scope).toBe('personal');
    expect(summary.preferred_maturity).toBe('developing');
    expect(summary.preferred_role).toBe('act');
    expect(summary.type_preferences[0]).toMatchObject({
      key: 'item_merchant_variance',
    });
  });

  it('treats expired outcome windows as an implicit negative signal', () => {
    const summary = buildInsightPreferenceSummary([
      {
        insight_id: 'buy_soon_better_price:product:abc:Target:2026-04-01',
        event_type: 'shown',
        metadata: {
          type: 'buy_soon_better_price',
          scope: 'personal',
          maturity: 'mature',
        },
      },
    ], {
      outcomeWindows: [{
        insight_id: 'buy_soon_better_price:product:abc:Target:2026-04-01',
        insight_type: 'buy_soon_better_price',
        type: 'buy_soon_better_price',
        scope: 'personal',
        maturity: 'mature',
        status: 'expired_no_action',
      }],
    });

    expect(summary.expired_no_action_count).toBe(1);
    const priceWatch = summary.type_preferences.find((entry) => entry.key === 'buy_soon_better_price');
    expect(priceWatch.score).toBeLessThan(0);
  });
});

describe('preferenceAdjustmentForInsight', () => {
  it('boosts insights that match the learned preference profile', () => {
    const summary = buildInsightPreferenceSummary([
      {
        insight_id: 'item_merchant_variance:personal:milk',
        event_type: 'shown',
        metadata: {
          type: 'item_merchant_variance',
          scope: 'personal',
          maturity: 'developing',
        },
      },
      {
        insight_id: 'item_merchant_variance:personal:milk',
        event_type: 'tapped',
        metadata: {
          type: 'item_merchant_variance',
          scope: 'personal',
          maturity: 'developing',
        },
      },
      {
        insight_id: 'budget_too_low:household:2026-04',
        event_type: 'shown',
        metadata: {
          type: 'budget_too_low',
          scope: 'household',
          maturity: 'mature',
        },
      },
      {
        insight_id: 'budget_too_low:household:2026-04',
        event_type: 'dismissed',
        metadata: {
          type: 'budget_too_low',
          scope: 'household',
          maturity: 'mature',
        },
      },
    ]);

    const preferredScore = preferenceAdjustmentForInsight({
      type: 'item_merchant_variance',
      metadata: {
        scope: 'personal',
        maturity: 'developing',
      },
    }, summary);

    const nonPreferredScore = preferenceAdjustmentForInsight({
      type: 'budget_too_low',
      metadata: {
        scope: 'household',
        maturity: 'mature',
      },
    }, summary);

    expect(preferredScore).toBeGreaterThan(nonPreferredScore);
  });
});
