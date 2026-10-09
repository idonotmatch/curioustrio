const {
  classifyItemInsightContext,
  automaticItemInsightDecision,
  summarizeItemInsightEligibility,
} = require('../../src/services/itemInsightEligibility');

function occurrence(overrides = {}) {
  return {
    comparable_key: 'sparkling water|brand:water co',
    product_match_confidence: 'medium',
    expense_category_name: 'Groceries',
    ...overrides,
  };
}

describe('itemInsightEligibility', () => {
  it('suppresses automatic item insights from dining contexts', () => {
    expect(classifyItemInsightContext({ expense_category_name: 'Dining Out' })).toEqual(
      expect.objectContaining({
        eligible: false,
        tier: 'suppressed',
        suppressed_reason: 'dining_context',
      })
    );
  });

  it('uses a parent category when a custom child category is present', () => {
    expect(classifyItemInsightContext({
      expense_category_name: 'Date Night',
      parent_category_name: 'Dining Out',
      category_group_name: 'Dining Out',
    })).toEqual(expect.objectContaining({
      eligible: false,
      suppressed_reason: 'dining_context',
    }));
  });

  it('recognizes common custom dining category names', () => {
    expect(classifyItemInsightContext({
      expense_category_name: 'Restaurants & Dining',
    })).toEqual(expect.objectContaining({
      eligible: false,
      suppressed_reason: 'dining_context',
    }));
  });

  it('removes dining observations without discarding valid grocery history', () => {
    const decision = automaticItemInsightDecision([
      occurrence(),
      occurrence(),
      occurrence(),
      occurrence({ expense_category_name: 'Dining Out' }),
    ]);

    expect(decision).toMatchObject({
      eligible: true,
      eligible_occurrence_count: 3,
      minimum_occurrences: 3,
      tier: 'product_friendly',
      excluded_reasons: ['dining_context'],
    });
    expect(decision.eligible_rows).toHaveLength(3);
  });

  it('requires four strong observations for an ambiguous custom category', () => {
    const weakRows = Array.from({ length: 4 }, () => occurrence({
      expense_category_name: 'Miscellaneous Purchases',
    }));
    const weakDecision = automaticItemInsightDecision(weakRows);
    expect(weakDecision).toMatchObject({
      eligible: false,
      minimum_occurrences: 4,
      requires_strong_identity: true,
      suppressed_reason: 'ambiguous_category_identity',
    });

    const strongRows = weakRows.map((row) => ({
      ...row,
      product_match_confidence: 'high',
    }));
    expect(automaticItemInsightDecision(strongRows)).toMatchObject({
      eligible: true,
      tier: 'ambiguous',
      minimum_occurrences: 4,
      strong_identity: true,
    });
  });

  it('keeps legacy uncategorized histories at the existing threshold', () => {
    const rows = Array.from({ length: 3 }, () => occurrence({
      expense_category_name: null,
    }));

    expect(automaticItemInsightDecision(rows)).toMatchObject({
      eligible: true,
      tier: 'unclassified',
      minimum_occurrences: 3,
    });
  });

  it('summarizes eligible, suppressed, uncategorized, and cross-source identity groups', () => {
    expect(summarizeItemInsightEligibility([
      {
        source_types: ['camera', 'email'],
        insight_eligibility: { eligible: true, tier: 'product_friendly' },
      },
      {
        source_types: ['manual'],
        insight_eligibility: { eligible: false, tier: 'suppressed', suppressed_reason: 'dining_context' },
      },
      {
        source_types: [],
        insight_eligibility: { eligible: true, tier: 'unclassified' },
      },
    ])).toMatchObject({
      total_groups: 3,
      eligible_groups: 2,
      suppressed_groups: 1,
      unclassified_groups: 1,
      source_diverse_groups: 1,
      by_tier: { product_friendly: 1, suppressed: 1, unclassified: 1 },
      by_suppression_reason: { dining_context: 1 },
    });
  });
});
