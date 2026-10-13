jest.mock('../../src/db', () => ({ query: jest.fn() }));

const db = require('../../src/db');
const ItemFamilyComparisonDecision = require('../../src/models/itemFamilyComparisonDecision');

describe('itemFamilyComparisonDecision', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores variant pairs in stable order', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'decision-1' }] });

    await ItemFamilyComparisonDecision.upsert({
      householdId: 'household-1',
      userId: 'user-1',
      familyKey: 'produce:avocado',
      leftVariantKey: 'variant:z',
      rightVariantKey: 'variant:a',
      decision: 'comparable',
    });

    expect(db.query.mock.calls[0][1]).toEqual([
      'household-1',
      'user-1',
      'produce:avocado',
      'variant:a',
      'variant:z',
      'comparable',
    ]);
  });

  it('treats a missing pre-migration table as no decisions', async () => {
    db.query.mockRejectedValueOnce(Object.assign(new Error('missing item_family_comparison_decisions'), { code: '42P01' }));
    await expect(ItemFamilyComparisonDecision.findByFamily('household-1', 'produce:avocado')).resolves.toEqual([]);
  });
});
