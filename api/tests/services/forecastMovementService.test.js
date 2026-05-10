const {
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
