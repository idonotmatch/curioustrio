const {
  consolidateScopedInsightGroup,
  resolveInsightCompetition,
} = require('../../src/services/insightPortfolio');

describe('insightPortfolio', () => {
  it('rewrites consolidated weekly spend copy as one coherent combined-scope read', () => {
    const personal = {
      id: 'personal-weekly',
      type: 'developing_weekly_spend_change',
      title: 'Recent spending is running lighter than the week before',
      body: 'Your personal spending in the last 7 days is about $654 lower than the prior 7-day window.',
      severity: 'low',
      entity_type: 'budget_period',
      entity_id: 'personal:rolling:2026-05-01',
      created_at: '2026-05-08T12:00:00Z',
      metadata: {
        scope: 'personal',
        window_days: 7,
        current_spend: 453,
        previous_spend: 1106.91,
        delta_amount: -653.91,
        maturity: 'developing',
      },
    };
    const household = {
      ...personal,
      id: 'household-weekly',
      entity_id: 'household:rolling:2026-05-01',
      metadata: {
        ...personal.metadata,
        scope: 'household',
      },
    };

    const consolidated = consolidateScopedInsightGroup([personal, household]);

    expect(consolidated.title).toBe('Your recent spending eased, and the household view eased too');
    expect(consolidated.body).toContain('Your last 7 days are about $654 lower');
    expect(consolidated.body).toContain('household view moved the same way');
    expect(consolidated.body).not.toMatch(/folded|personal spending/i);
    expect(consolidated.metadata.scope_relationship).toBe('personal_household_overlap');
  });

  it('keeps one evidence-rich anomaly narrative across type and scope', () => {
    const base = {
      title: 'A few unusual purchases are driving most of the pressure',
      body: 'Unusual spend is lifting the month.',
      severity: 'high',
      entity_type: 'budget_period',
      created_at: '2026-10-08T12:00:00Z',
      metadata: { month: '2026-10' },
    };
    const personalVariance = {
      ...base,
      id: 'one_offs:personal:2026-10',
      type: 'one_offs_driving_variance',
      metadata: { ...base.metadata, scope: 'personal', evidence_confidence: 'medium' },
    };
    const personalProjection = {
      ...base,
      id: 'projection:personal:2026-10:expense-1',
      type: 'one_off_expense_skewing_projection',
      entity_type: 'expense',
      entity_id: 'expense-1',
      metadata: {
        ...base.metadata,
        scope: 'personal',
        evidence_confidence: 'high',
        top_unusual_expense: { id: 'expense-1', merchant: 'Wedding Present', amount: 400 },
      },
    };
    const householdProjection = {
      ...personalProjection,
      id: 'projection:household:2026-10:expense-1',
      metadata: { ...personalProjection.metadata, scope: 'household' },
    };

    const resolved = resolveInsightCompetition([
      personalVariance,
      personalProjection,
      householdProjection,
    ]);

    expect(resolved).toHaveLength(1);
    expect(resolved[0].type).toBe('one_off_expense_skewing_projection');
    expect(resolved[0].metadata.consolidated_scopes).toEqual(['personal', 'household']);
    expect(resolved[0].metadata.top_unusual_expense.merchant).toBe('Wedding Present');
  });
});
