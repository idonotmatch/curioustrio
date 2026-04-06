const {
  buildHistoricalCumulativeCurve,
  buildHistoricalCategoryCurves,
  classifyExpenseNormStatus,
  getCompletedHistoricalPeriods,
  getCurrentPeriodDayIndex,
  getExpectedCumulativeShareByDay,
  getTopProjectedCategoryPressures,
  periodBounds,
  projectCategorySpend,
  projectOverallSpend,
  splitNormalVsUnusualSpend,
} = require('../../src/services/spendProjectionAnalyzer');

describe('spendProjectionAnalyzer', () => {
  it('builds a historical cumulative curve and expected share by day', () => {
    const bounds = periodBounds('2026-04', 1);
    const historicalPeriods = [
      {
        ...periodBounds('2026-03', 1),
        expenses: [
          { merchant: 'Grocer', amount: 30, date: '2026-03-01', category_key: 'groceries', category_name: 'Groceries' },
          { merchant: 'Cafe', amount: 30, date: '2026-03-02', category_key: 'dining', category_name: 'Dining' },
          { merchant: 'Gas', amount: 40, date: '2026-03-03', category_key: 'transport', category_name: 'Transport' },
        ],
      },
      {
        ...periodBounds('2026-02', 1),
        expenses: [
          { merchant: 'Grocer', amount: 20, date: '2026-02-01', category_key: 'groceries', category_name: 'Groceries' },
          { merchant: 'Cafe', amount: 30, date: '2026-02-02', category_key: 'dining', category_name: 'Dining' },
          { merchant: 'Gas', amount: 50, date: '2026-02-03', category_key: 'transport', category_name: 'Transport' },
        ],
      },
      {
        ...periodBounds('2026-01', 1),
        expenses: [
          { merchant: 'Grocer', amount: 10, date: '2026-01-01', category_key: 'groceries', category_name: 'Groceries' },
          { merchant: 'Cafe', amount: 30, date: '2026-01-02', category_key: 'dining', category_name: 'Dining' },
          { merchant: 'Gas', amount: 60, date: '2026-01-03', category_key: 'transport', category_name: 'Transport' },
        ],
      },
    ];

    const curve = buildHistoricalCumulativeCurve(
      historicalPeriods,
      Math.round((bounds.toDate - bounds.fromDate) / (1000 * 60 * 60 * 24))
    );
    expect(curve.period_count).toBe(3);
    expect(Number(getExpectedCumulativeShareByDay(curve, 1).toFixed(2))).toBe(0.2);
    expect(Number(getExpectedCumulativeShareByDay(curve, 2).toFixed(2))).toBe(0.5);
    expect(Number(getExpectedCumulativeShareByDay(curve, 3).toFixed(2))).toBe(1);
  });

  it('builds category-level historical curves', () => {
    const bounds = periodBounds('2026-04', 1);
    const historicalPeriods = [
      {
        ...periodBounds('2026-03', 1),
        expenses: [
          { merchant: 'Grocer', amount: 30, date: '2026-03-01', category_key: 'groceries', category_name: 'Groceries' },
          { merchant: 'Cafe', amount: 30, date: '2026-03-02', category_key: 'dining', category_name: 'Dining' },
          { merchant: 'Grocer', amount: 40, date: '2026-03-03', category_key: 'groceries', category_name: 'Groceries' },
        ],
      },
      {
        ...periodBounds('2026-02', 1),
        expenses: [
          { merchant: 'Grocer', amount: 20, date: '2026-02-01', category_key: 'groceries', category_name: 'Groceries' },
          { merchant: 'Cafe', amount: 10, date: '2026-02-02', category_key: 'dining', category_name: 'Dining' },
          { merchant: 'Grocer', amount: 30, date: '2026-02-03', category_key: 'groceries', category_name: 'Groceries' },
        ],
      },
      {
        ...periodBounds('2026-01', 1),
        expenses: [
          { merchant: 'Grocer', amount: 15, date: '2026-01-01', category_key: 'groceries', category_name: 'Groceries' },
          { merchant: 'Cafe', amount: 15, date: '2026-01-02', category_key: 'dining', category_name: 'Dining' },
          { merchant: 'Grocer', amount: 20, date: '2026-01-03', category_key: 'groceries', category_name: 'Groceries' },
        ],
      },
    ];

    const curves = buildHistoricalCategoryCurves(
      historicalPeriods,
      Math.round((bounds.toDate - bounds.fromDate) / (1000 * 60 * 60 * 24))
    );

    expect(curves.groceries.period_count).toBe(3);
    expect(Number(getExpectedCumulativeShareByDay(curves.groceries, 1).toFixed(2))).toBe(0.42);
    expect(Number(getExpectedCumulativeShareByDay(curves.groceries, 3).toFixed(2))).toBe(1);
  });

  it('classifies a large novel expense as unusual', () => {
    const norm = classifyExpenseNormStatus(
      { merchant: 'Airline', amount: 420, date: '2026-04-04', category_key: 'travel', category_name: 'Travel' },
      {
        historicalExpenses: [
          { merchant: 'Grocer', amount: 45, date: '2026-03-01', category_key: 'groceries', category_name: 'Groceries' },
          { merchant: 'Cafe', amount: 22, date: '2026-03-02', category_key: 'dining', category_name: 'Dining' },
          { merchant: 'Gas', amount: 38, date: '2026-03-03', category_key: 'transport', category_name: 'Transport' },
        ],
      }
    );

    expect(norm.status).toBe('outlier');
    expect(norm.reason).toBe('amount_far_above_historical_range');
  });

  it('splits normal and unusual spend and keeps top unusual expenses', () => {
    const split = splitNormalVsUnusualSpend(
      [
        { id: '1', merchant: 'Grocer', amount: 42, date: '2026-04-01', category_key: 'groceries', category_name: 'Groceries' },
        { id: '2', merchant: 'Airline', amount: 500, date: '2026-04-03', category_key: 'travel', category_name: 'Travel' },
      ],
      {
        historicalExpenses: [
          { merchant: 'Grocer', amount: 40, date: '2026-03-01', category_key: 'groceries', category_name: 'Groceries' },
          { merchant: 'Grocer', amount: 44, date: '2026-02-01', category_key: 'groceries', category_name: 'Groceries' },
          { merchant: 'Cafe', amount: 18, date: '2026-03-02', category_key: 'dining', category_name: 'Dining' },
        ],
      }
    );

    expect(split.normal_spend_to_date).toBe(42);
    expect(split.unusual_spend_to_date).toBe(500);
    expect(split.top_unusual_expenses).toHaveLength(1);
    expect(split.top_unusual_expenses[0].merchant).toBe('Airline');
  });

  it('projects baseline and adjusted spend separately', () => {
    const bounds = periodBounds('2026-04', 1);
    const projection = projectOverallSpend({
      currentExpenses: [
        { merchant: 'Grocer', amount: 50, date: '2026-04-01', category_key: 'groceries', category_name: 'Groceries' },
        { merchant: 'Airline', amount: 300, date: '2026-04-02', category_key: 'travel', category_name: 'Travel' },
      ],
      historicalPeriods: [
        {
          ...periodBounds('2026-03', 1),
          expenses: [
            { merchant: 'Grocer', amount: 30, date: '2026-03-01', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Grocer', amount: 35, date: '2026-03-04', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Cafe', amount: 30, date: '2026-03-02', category_key: 'dining', category_name: 'Dining' },
            { merchant: 'Gas', amount: 40, date: '2026-03-03', category_key: 'transport', category_name: 'Transport' },
          ],
        },
        {
          ...periodBounds('2026-02', 1),
          expenses: [
            { merchant: 'Grocer', amount: 20, date: '2026-02-01', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Grocer', amount: 25, date: '2026-02-04', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Cafe', amount: 30, date: '2026-02-02', category_key: 'dining', category_name: 'Dining' },
            { merchant: 'Gas', amount: 50, date: '2026-02-03', category_key: 'transport', category_name: 'Transport' },
          ],
        },
        {
          ...periodBounds('2026-01', 1),
          expenses: [
            { merchant: 'Grocer', amount: 10, date: '2026-01-01', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Grocer', amount: 20, date: '2026-01-04', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Cafe', amount: 30, date: '2026-01-02', category_key: 'dining', category_name: 'Dining' },
            { merchant: 'Gas', amount: 60, date: '2026-01-03', category_key: 'transport', category_name: 'Transport' },
          ],
        },
      ],
      bounds,
      dayIndex: 2,
      budgetLimit: 200,
    });

    expect(Number(projection.historical_expected_share_by_day.toFixed(2))).toBe(0.39);
    expect(projection.normal_spend_to_date).toBe(50);
    expect(projection.unusual_spend_to_date).toBe(300);
    expect(projection.baseline_projected_total).toBeCloseTo(127.36, 2);
    expect(projection.adjusted_projected_total).toBeCloseTo(427.36, 2);
    expect(projection.projected_budget_delta).toBeCloseTo(227.36, 2);
  });

  it('returns null projections when history is too thin', () => {
    const bounds = periodBounds('2026-04', 1);
    const projection = projectOverallSpend({
      currentExpenses: [
        { merchant: 'Grocer', amount: 50, date: '2026-04-01', category_key: 'groceries', category_name: 'Groceries' },
      ],
      historicalPeriods: [
        {
          ...periodBounds('2026-03', 1),
          expenses: [
            { merchant: 'Grocer', amount: 30, date: '2026-03-01', category_key: 'groceries', category_name: 'Groceries' },
          ],
        },
      ],
      bounds,
      dayIndex: 1,
      budgetLimit: 200,
    });

    expect(projection.historical_period_count).toBe(1);
    expect(projection.baseline_projected_total).toBeNull();
    expect(projection.adjusted_projected_total).toBeNull();
    expect(projection.confidence).toBeNull();
  });

  it('projects a category separately from overall spend', () => {
    const bounds = periodBounds('2026-04', 1);
    const projection = projectCategorySpend({
      categoryKey: 'groceries',
      categoryName: 'Groceries',
      currentExpenses: [
        { merchant: 'Grocer', amount: 50, date: '2026-04-01', category_key: 'groceries', category_name: 'Groceries' },
        { merchant: 'Airline', amount: 300, date: '2026-04-02', category_key: 'travel', category_name: 'Travel' },
      ],
      historicalPeriods: [
        {
          ...periodBounds('2026-03', 1),
          expenses: [
            { merchant: 'Grocer', amount: 30, date: '2026-03-01', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Grocer', amount: 35, date: '2026-03-04', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Cafe', amount: 30, date: '2026-03-02', category_key: 'dining', category_name: 'Dining' },
          ],
        },
        {
          ...periodBounds('2026-02', 1),
          expenses: [
            { merchant: 'Grocer', amount: 20, date: '2026-02-01', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Grocer', amount: 25, date: '2026-02-04', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Cafe', amount: 30, date: '2026-02-02', category_key: 'dining', category_name: 'Dining' },
          ],
        },
        {
          ...periodBounds('2026-01', 1),
          expenses: [
            { merchant: 'Grocer', amount: 10, date: '2026-01-01', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Grocer', amount: 20, date: '2026-01-04', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Cafe', amount: 30, date: '2026-01-02', category_key: 'dining', category_name: 'Dining' },
          ],
        },
      ],
      bounds,
      dayIndex: 2,
    });

    expect(projection.category_key).toBe('groceries');
    expect(projection.current_spend_to_date).toBe(50);
    expect(projection.unusual_spend_to_date).toBe(0);
    expect(projection.baseline_projected_total).toBeCloseTo(121.03, 2);
    expect(projection.adjusted_projected_total).toBeCloseTo(121.03, 2);
    expect(projection.historical_average_total).toBeCloseTo(46.67, 2);
  });

  it('returns the top projected category pressures', () => {
    const bounds = periodBounds('2026-04', 1);
    const categories = getTopProjectedCategoryPressures({
      currentExpenses: [
        { merchant: 'Grocer', amount: 50, date: '2026-04-01', category_key: 'groceries', category_name: 'Groceries' },
        { merchant: 'Cafe', amount: 18, date: '2026-04-02', category_key: 'dining', category_name: 'Dining' },
      ],
      historicalPeriods: [
        {
          ...periodBounds('2026-03', 1),
          expenses: [
            { merchant: 'Grocer', amount: 30, date: '2026-03-01', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Grocer', amount: 35, date: '2026-03-04', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Cafe', amount: 10, date: '2026-03-02', category_key: 'dining', category_name: 'Dining' },
          ],
        },
        {
          ...periodBounds('2026-02', 1),
          expenses: [
            { merchant: 'Grocer', amount: 20, date: '2026-02-01', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Grocer', amount: 25, date: '2026-02-04', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Cafe', amount: 12, date: '2026-02-02', category_key: 'dining', category_name: 'Dining' },
          ],
        },
        {
          ...periodBounds('2026-01', 1),
          expenses: [
            { merchant: 'Grocer', amount: 10, date: '2026-01-01', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Grocer', amount: 20, date: '2026-01-04', category_key: 'groceries', category_name: 'Groceries' },
            { merchant: 'Cafe', amount: 14, date: '2026-01-02', category_key: 'dining', category_name: 'Dining' },
          ],
        },
      ],
      bounds,
      dayIndex: 2,
    });

    expect(categories).toHaveLength(2);
    expect(categories[0].category_key).toBe('groceries');
    expect(categories[1].category_key).toBe('dining');
  });

  it('filters completed historical periods based on first expense date and activity', () => {
    const periods = getCompletedHistoricalPeriods({
      targetMonth: '2026-04',
      startDay: 1,
      firstConfirmedExpenseAt: new Date(2026, 1, 1, 12, 0, 0, 0),
      monthsBack: 4,
      activityByMonth: {
        '2026-03': { expense_count: 3, active_day_count: 2 },
        '2026-02': { expense_count: 3, active_day_count: 2 },
        '2026-01': { expense_count: 1, active_day_count: 1 },
        '2025-12': { expense_count: 5, active_day_count: 3 },
      },
    });

    expect(periods.map((period) => period.month)).toEqual(['2026-03', '2026-02']);
  });

  it('calculates current period day index inclusively', () => {
    const bounds = periodBounds('2026-04', 1);
    const dayIndex = getCurrentPeriodDayIndex(bounds, new Date(2026, 3, 5, 12, 0, 0, 0));
    expect(dayIndex).toBe(5);
  });
});
