const {
  buildInsightForecast,
  evaluateForecastOutcome,
  forecastTypeForInsight,
  isPeriodClosed,
} = require('../../src/services/insightForecastService');

describe('insightForecastService', () => {
  it('builds a month-end forecast from projection metadata', () => {
    const forecast = buildInsightForecast({
      id: 'projected_over_budget:personal:2026-05',
      type: 'projected_month_end_over_budget',
      entity_type: 'budget',
      entity_id: 'personal:total',
      metadata: {
        scope: 'personal',
        month: '2026-05',
        adjusted_projected_total: 1240,
        budget_amount: 1100,
        projected_budget_delta: 140,
        historical_period_count: 5,
        active_day_count: 8,
        expense_count: 14,
        confidence: 'comparative',
      },
    });

    expect(forecast).toMatchObject({
      forecast_type: 'month_end_budget',
      projected_value: 1240,
      baseline_value: 1100,
      projected_delta: 140,
      confidence_label: 'calibrated',
      shape: expect.objectContaining({
        expected: 'above_baseline',
        driver: 'overall_pace',
      }),
    });
    expect(forecast.uncertainty_low).toBeLessThan(1240);
    expect(forecast.uncertainty_high).toBeGreaterThan(1240);
  });

  it('classifies category projections separately from budget projections', () => {
    expect(forecastTypeForInsight('projected_category_surge', { category_key: 'groceries' })).toBe('category_month_end');
  });

  it('applies calibration bias without mutating the original feature snapshot', () => {
    const forecast = buildInsightForecast({
      type: 'projected_category_surge',
      entity_type: 'category',
      entity_id: 'groceries',
      metadata: {
        category_key: 'groceries',
        month: '2026-05',
        adjusted_projected_total: 420,
        historical_average_total: 360,
        delta_amount: 60,
      },
    }, { bias_amount: 25 });

    expect(forecast.projected_value).toBe(445);
    expect(forecast.projected_delta).toBe(85);
    expect(forecast.feature_snapshot.delta_amount).toBe(60);
  });

  it('evaluates closed outcomes for accuracy and direction', () => {
    const outcome = evaluateForecastOutcome({
      projected_value: 500,
      projected_delta: 80,
      baseline_value: 420,
    }, 540);

    expect(outcome).toMatchObject({
      actual_value: 540,
      actual_delta: 120,
      absolute_error: 40,
      direction_correct: true,
      outcome_label: 'accurate',
    });
  });

  it('returns null when an insight has no forecastable projection or timing signal', () => {
    expect(buildInsightForecast({
      type: 'early_logging_momentum',
      metadata: { expense_count: 2 },
    })).toBeNull();
  });

  it('only closes forecast periods before the current month', () => {
    const now = new Date('2026-05-15T12:00:00.000Z');
    expect(isPeriodClosed('2026-04', now)).toBe(true);
    expect(isPeriodClosed('2026-05', now)).toBe(false);
    expect(isPeriodClosed('2026-06', now)).toBe(false);
  });
});
