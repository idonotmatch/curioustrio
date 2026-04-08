jest.mock('../../src/models/productPriceObservation', () => ({
  findRecentByIdentity: jest.fn(),
}));

jest.mock('../../src/services/recurringDetector', () => ({
  detectRecurringWatchCandidates: jest.fn(),
}));

const ProductPriceObservation = require('../../src/models/productPriceObservation');
const { detectRecurringWatchCandidates } = require('../../src/services/recurringDetector');
const {
  compareObservationToBaseline,
  findBestObservationForCandidate,
  findObservationOpportunities,
} = require('../../src/services/priceObservationService');

beforeEach(() => {
  ProductPriceObservation.findRecentByIdentity.mockReset();
  detectRecurringWatchCandidates.mockReset();
});

describe('compareObservationToBaseline', () => {
  it('prefers unit-price comparison when units are compatible', () => {
    const comparison = compareObservationToBaseline(
      {
        median_unit_price: 0.50,
        median_amount: 41.0,
        normalized_total_size_unit: 'count',
      },
      {
        observed_unit_price: 0.42,
        observed_price: 34.44,
        normalized_total_size_unit: 'count',
      }
    );

    expect(comparison).toEqual(expect.objectContaining({
      comparison_type: 'unit_price',
      baseline_value: 0.5,
      observed_value: 0.42,
    }));
  });

  it('falls back to raw price when unit pricing is not comparable', () => {
    const comparison = compareObservationToBaseline(
      {
        median_unit_price: null,
        median_amount: 39.23,
      },
      {
        observed_unit_price: null,
        observed_price: 36.99,
      }
    );

    expect(comparison).toEqual(expect.objectContaining({
      comparison_type: 'price',
      baseline_value: 39.23,
      observed_value: 36.99,
      savings_amount: 2.24,
    }));
  });
});

describe('findBestObservationForCandidate', () => {
  it('returns the strongest meaningful observation for an active candidate', async () => {
    ProductPriceObservation.findRecentByIdentity.mockResolvedValueOnce([
      {
        merchant: 'Target',
        observed_price: 36.99,
        observed_unit_price: 0.4511,
        normalized_total_size_value: 82,
        normalized_total_size_unit: 'count',
        observed_at: '2026-04-04T10:00:00Z',
        source_type: 'manual',
        url: 'https://example.com/target',
      },
      {
        merchant: 'Walmart',
        observed_price: 37.99,
        observed_unit_price: 0.4632,
        normalized_total_size_value: 82,
        normalized_total_size_unit: 'count',
        observed_at: '2026-04-04T09:00:00Z',
        source_type: 'manual',
      },
    ]);

    const result = await findBestObservationForCandidate({
      group_key: 'product:abc',
      product_id: 'abc',
      item_name: 'Pampers Pure',
      median_amount: 39.23,
      median_unit_price: 0.4784,
      normalized_total_size_value: 82,
      normalized_total_size_unit: 'count',
    });

    expect(result).toBeTruthy();
    expect(result.observation.merchant).toBe('Target');
    expect(result.discount_percent).toBeGreaterThanOrEqual(5);
  });
});

describe('findObservationOpportunities', () => {
  it('returns buy-soon opportunities for active watch candidates', async () => {
    detectRecurringWatchCandidates.mockResolvedValueOnce([
      {
        group_key: 'product:abc',
        product_id: 'abc',
        identity_confidence: 'high',
        item_name: 'Pampers Pure',
        brand: 'Pampers',
        median_amount: 39.23,
        median_unit_price: 0.4784,
        normalized_total_size_value: 82,
        normalized_total_size_unit: 'count',
        next_expected_date: '2026-04-08',
        days_until_due: 4,
        status: 'watching',
        merchants: ['Target'],
      },
    ]);

    ProductPriceObservation.findRecentByIdentity.mockResolvedValueOnce([
      {
        merchant: 'Target',
        observed_price: 36.99,
        observed_unit_price: 0.4511,
        normalized_total_size_value: 82,
        normalized_total_size_unit: 'count',
        observed_at: '2026-04-04T10:00:00Z',
        source_type: 'manual',
        url: 'https://example.com/target',
      },
    ]);

    const opportunities = await findObservationOpportunities('household-1');
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({
      signal: 'buy_soon_better_price',
      item_name: 'Pampers Pure',
      merchant: 'Target',
      next_expected_date: '2026-04-08',
    });
  });

  it('is stricter about medium-confidence item opportunities', async () => {
    detectRecurringWatchCandidates.mockResolvedValueOnce([
      {
        group_key: 'comparable:pampers-pure',
        comparable_key: 'pampers-pure',
        identity_confidence: 'medium',
        item_name: 'Pampers Pure',
        brand: 'Pampers',
        median_amount: 39.23,
        median_unit_price: 0.4784,
        normalized_total_size_value: 82,
        normalized_total_size_unit: 'count',
        next_expected_date: '2026-04-08',
        days_until_due: 4,
        status: 'watching',
        merchants: ['Target'],
      },
    ]);

    ProductPriceObservation.findRecentByIdentity.mockResolvedValueOnce([
      {
        merchant: 'Target',
        observed_price: 37.95,
        observed_unit_price: 0.4628,
        normalized_total_size_value: 82,
        normalized_total_size_unit: 'count',
        observed_at: '2026-04-04T10:00:00Z',
        source_type: 'manual',
        url: 'https://example.com/target',
      },
    ]);

    const opportunities = await findObservationOpportunities('household-1');
    expect(opportunities).toHaveLength(0);
  });
});
