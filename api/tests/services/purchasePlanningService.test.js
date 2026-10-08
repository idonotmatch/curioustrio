jest.mock('../../src/models/purchasePlan', () => ({}));
jest.mock('../../src/models/productPriceObservation', () => ({}));
jest.mock('../../src/services/spendProjectionAnalyzer', () => ({}));

const {
  buildFundingRecommendation,
  bestPriceObservation,
  buildPriceOptions,
  detectPlanMaterialChange,
  projectionHeadroom,
} = require('../../src/services/purchasePlanningService');

describe('purchasePlanningService', () => {
  it('does not offer headroom that another active plan already reserved', () => {
    const result = buildFundingRecommendation({
      amount: 500,
      projectedHeadroom: 400,
      minimumBuffer: 50,
      reservedElsewhere: 150,
      recoveryMonths: 3,
    });

    expect(result.current_headroom).toBe(200);
    expect(result.funded_amount).toBe(200);
    expect(result.funding_gap).toBe(300);
    expect(result.recovery_monthly).toBe(100);
  });

  it('combines reserved money, current room, and usable pools without double counting', () => {
    const result = buildFundingRecommendation({
      amount: 600,
      projectedHeadroom: 250,
      allocations: [{ source_type: 'current_headroom', state: 'reserved', amount: 100 }],
      pools: [{ id: 'pool-1', name: 'Travel savings', pool_type: 'savings', usable_amount: 300 }],
    });

    expect(result.already_reserved).toBe(100);
    expect(result.funded_amount).toBe(550);
    expect(result.funding_gap).toBe(50);
    expect(result.funding_breakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_type: 'current_headroom', amount: 150 }),
      expect.objectContaining({ source_type: 'funding_pool', amount: 300 }),
    ]));
  });

  it('uses a savings strategy when pools close the full gap', () => {
    const result = buildFundingRecommendation({
      amount: 300,
      projectedHeadroom: 100,
      pools: [{ id: 'pool-1', name: 'Savings', pool_type: 'savings', usable_amount: 250 }],
    });
    expect(result.funding_gap).toBe(0);
    expect(result.recommended_strategy).toBe('use_savings');
  });

  it('detects meaningful price or funding movement', () => {
    expect(detectPlanMaterialChange(
      { funding_gap: 200, observed_price: 500 },
      { funding_gap: 150, observed_price: 450, evaluated_amount: 450 }
    )).toBe('improved');
    expect(detectPlanMaterialChange(
      { funding_gap: 100, evaluated_amount: 500 },
      { funding_gap: 140, evaluated_amount: 500 }
    )).toBe('worsened');
  });

  it('falls back to remaining budget room when a projection is still developing', () => {
    expect(projectionHeadroom({ overall: { projected_budget_delta: null, budget_limit: 1000, current_spend_to_date: 650 } })).toBe(350);
  });

  it('selects the best matching observation across merchants', () => {
    const observations = [
      { merchant: 'Retailer A', observed_price: 949, observed_at: '2026-10-01' },
      { merchant: 'Retailer B', observed_price: 899, observed_at: '2026-10-02' },
    ];
    expect(bestPriceObservation(observations)).toEqual(expect.objectContaining({
      merchant: 'Retailer B',
      observed_price: 899,
    }));
  });

  it('keeps the lowest observed offer from each merchant', () => {
    const options = buildPriceOptions([
      { merchant: 'Retailer A', observed_price: 949, observed_at: '2026-10-01', source_type: 'email' },
      { merchant: 'Retailer A', observed_price: 929, observed_at: '2026-10-02', source_type: 'email' },
      { merchant: 'Retailer B', observed_price: 899, observed_at: '2026-10-02', source_type: 'trusted_provider' },
    ]);
    expect(options).toEqual([
      expect.objectContaining({ merchant: 'Retailer B', price: 899 }),
      expect.objectContaining({ merchant: 'Retailer A', price: 929 }),
    ]);
  });
});
