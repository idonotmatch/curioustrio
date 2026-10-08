jest.mock('../../src/db', () => ({ query: jest.fn() }));

const db = require('../../src/db');
const {
  canonicalMerchantKey,
  canonicalizeMerchantForHousehold,
  cleanMerchantDisplayName,
  mergeMerchantRows,
} = require('../../src/services/merchantIdentity');

describe('merchantIdentity', () => {
  beforeEach(() => jest.clearAllMocks());

  it('removes receipt survey boilerplate without losing the merchant', () => {
    expect(cleanMerchantDisplayName('Bobby Boy Bake Shop Let us know How your visit went.'))
      .toBe('Bobby Boy Bake Shop');
    expect(cleanMerchantDisplayName('Scan the QR code to take our survey')).toBeNull();
  });

  it('uses spacing-insensitive merchant keys', () => {
    expect(canonicalMerchantKey('Bobby Boy Bake Shop')).toBe(canonicalMerchantKey('Bobby Boy Bakeshop'));
    expect(canonicalMerchantKey('Acme Foods, LLC')).toBe('acmefoods');
  });

  it('prefers the established household display name', async () => {
    db.query.mockResolvedValue({
      rows: [{ merchant: 'Bobby Boy Bakeshop', usage_count: 4, last_seen_at: '2026-10-01' }],
    });
    await expect(canonicalizeMerchantForHousehold({
      householdId: 'household-1',
      merchant: 'BOBBY BOY BAKE SHOP Let us know how your visit went',
    })).resolves.toMatchObject({
      merchant: 'Bobby Boy Bakeshop',
      merchant_key: 'bobbyboybakeshop',
      confidence: 'high',
      reason: 'household_history',
    });
  });

  it('merges polluted merchant labels for insight aggregation', () => {
    expect(mergeMerchantRows([
      { merchant_name: 'Bobby Boy Bakeshop', spent: 12 },
      { merchant_name: 'Bobby Boy Bake Shop Let us know how your visit went', spent: 8 },
    ])).toEqual([
      expect.objectContaining({ merchant_key: 'bobbyboybakeshop', spent: 20 }),
    ]);
  });
});
