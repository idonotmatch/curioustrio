jest.mock('../../src/db', () => ({ query: jest.fn() }));

const db = require('../../src/db');
const { getItemQualitySummary } = require('../../src/services/itemQualityService');

describe('itemQualityService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports bounded household item coverage without exposing private expenses', async () => {
    db.query.mockResolvedValue({
      rows: [{
        total_items: 20,
        canonical_items: 12,
        history_eligible_items: 18,
        comparable_price_items: 8,
        quantity_items: 10,
        structured_size_items: 5,
        low_confidence_items: 2,
        repeated_groups: 6,
        insight_ready_groups: 4,
        cross_merchant_groups: 2,
      }],
    });

    await expect(getItemQualitySummary({ id: 'user-1', household_id: 'household-1' }, { days: 999 }))
      .resolves.toEqual(expect.objectContaining({
        lookback_days: 365,
        coverage: {
          canonical_identity: 0.6,
          history_eligible: 0.9,
          comparable_price: 0.4,
          quantity: 0.5,
          structured_size: 0.25,
          low_confidence: 0.1,
        },
      }));
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('(COALESCE(e.is_private, FALSE) = FALSE OR e.user_id = $3)'),
      ['household-1', 365, 'user-1']
    );
  });
});
