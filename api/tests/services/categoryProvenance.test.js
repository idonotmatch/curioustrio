const {
  categoryProvenanceWeight,
  summarizeCategoryProvenance,
  isTrustedCategoryAssignment,
} = require('../../src/services/categoryProvenance');

describe('categoryProvenance', () => {
  it('treats low-confidence merchant memory as less than fully trusted', () => {
    expect(categoryProvenanceWeight({
      category_source: 'memory',
      category_confidence: 2,
    })).toBe(0.74);
    expect(isTrustedCategoryAssignment({
      category_source: 'memory',
      category_confidence: 2,
    })).toBe(false);
  });

  it('keeps strong merchant memory trusted while exposing mixed category confidence in summaries', () => {
    const summary = summarizeCategoryProvenance([
      { amount: 80, category_source: 'memory', category_confidence: 4 },
      { amount: 20, category_source: 'memory', category_confidence: 2 },
    ]);

    expect(summary).toMatchObject({
      expense_count: 2,
      trusted_count: 1,
      low_confidence_count: 0,
    });
    expect(summary.trust_score).toBeCloseTo(0.932, 3);
  });
});
