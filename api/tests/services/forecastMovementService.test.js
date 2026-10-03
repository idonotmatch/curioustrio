const {
  choosePortfolioChange,
  chooseForecastMovementState,
  formatSignedCurrency,
} = require('../../src/services/forecastMovementService');

describe('forecastMovementService', () => {
  it('prioritizes budget boundary crossings over other movement', () => {
    const summary = chooseForecastMovementState({
      latest: { projected_delta: 74, projected_value: 2574 },
      previous: { projected_delta: -20, projected_value: 2480 },
      pending: { count: 0, total_amount: 0 },
      hasSnapshots: true,
    });

    expect(summary).toMatchObject({
      state: 'budget_boundary_crossed',
      title: 'Month crossed above budget',
      cta: { target: 'insights' },
    });
  });

  it('shows pending review pressure before ordinary forecast movement', () => {
    const summary = chooseForecastMovementState({
      latest: { projected_delta: 220, projected_value: 2720 },
      previous: { projected_delta: 160, projected_value: 2660 },
      pending: { count: 3, total_amount: 92 },
      hasSnapshots: true,
    });

    expect(summary).toMatchObject({
      state: 'pending_review_affecting_forecast',
      title: '3 receipts need review',
      cta: { target: 'actions' },
    });
  });

  it('surfaces material movement when pending work is not blocking', () => {
    const summary = chooseForecastMovementState({
      latest: {
        projected_delta: 320,
        projected_value: 2820,
        feature_snapshot: { category_key: 'groceries' },
      },
      previous: { projected_delta: 110, projected_value: 2610 },
      pending: { count: 0, total_amount: 0 },
      hasSnapshots: true,
    });

    expect(summary).toMatchObject({
      state: 'forecast_moved_up',
      title: 'Projection rose $210',
      cta: { target: 'insights' },
    });
    expect(summary.body).toMatch(/groceries/);
  });

  it('falls back to import synced when there is no material movement', () => {
    const summary = chooseForecastMovementState({
      latest: { projected_delta: 105, confidence_label: 'directional' },
      previous: { projected_delta: 101, confidence_label: 'directional' },
      pending: { count: 0, total_amount: 0 },
      importSummary: { imported: 2, last_imported_at: '2026-05-07T12:00:00Z' },
      hasSnapshots: true,
    });

    expect(summary).toMatchObject({
      state: 'import_synced_no_material_change',
      cta: { target: 'gmail' },
    });
  });

  it('surfaces a new material insight before import-only fallback', () => {
    const portfolioChange = choosePortfolioChange({
      latest: [
        {
          insight_id: 'groceries-now',
          forecast_type: 'category_month_end',
          entity_type: 'category',
          entity_id: 'groceries',
          projected_delta: 72,
          feature_snapshot: { category_key: 'Groceries' },
        },
      ],
      previous: [
        {
          insight_id: 'dining-before',
          forecast_type: 'category_month_end',
          entity_type: 'category',
          entity_id: 'dining',
          projected_delta: 18,
          feature_snapshot: { category_key: 'Dining' },
        },
      ],
    });
    const summary = chooseForecastMovementState({
      latest: { projected_delta: 105, confidence_label: 'directional' },
      previous: { projected_delta: 101, confidence_label: 'directional' },
      pending: { count: 0, total_amount: 0 },
      importSummary: { imported: 2 },
      portfolioChange,
      hasSnapshots: true,
    });

    expect(summary).toMatchObject({
      state: 'new_insight_detected',
      title: 'Groceries moved into focus',
      cta: { target: 'insights' },
      source: 'insights',
    });
  });

  it('detects when the top material driver changes', () => {
    const change = choosePortfolioChange({
      latest: [
        { insight_id: 'groceries', forecast_type: 'category_month_end', entity_type: 'category', entity_id: 'groceries', projected_delta: 95, feature_snapshot: { category_key: 'Groceries' } },
        { insight_id: 'dining', forecast_type: 'category_month_end', entity_type: 'category', entity_id: 'dining', projected_delta: 42, feature_snapshot: { category_key: 'Dining' } },
      ],
      previous: [
        { insight_id: 'groceries', forecast_type: 'category_month_end', entity_type: 'category', entity_id: 'groceries', projected_delta: 40, feature_snapshot: { category_key: 'Groceries' } },
        { insight_id: 'dining', forecast_type: 'category_month_end', entity_type: 'category', entity_id: 'dining', projected_delta: 90, feature_snapshot: { category_key: 'Dining' } },
      ],
    });

    expect(change).toMatchObject({
      type: 'top_driver_changed',
      item: { entity_id: 'groceries' },
      previous: { entity_id: 'dining' },
    });
  });

  it('reports first-run learning when no snapshots exist', () => {
    const summary = chooseForecastMovementState({ hasSnapshots: false });

    expect(summary).toMatchObject({
      state: 'first_run',
      cta: { target: 'add' },
    });
  });

  it('formats signed short currency', () => {
    expect(formatSignedCurrency(1220)).toBe('+$1.2k');
    expect(formatSignedCurrency(-74)).toBe('-$74');
  });
});
