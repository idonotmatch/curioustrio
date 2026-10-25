const {
  basketSimilarity,
  canonicalMerchantKey,
  daysBetween,
  itemIdentityKey,
  normalizeDateOnly,
} = require('../../src/services/matchPrimitives');

describe('matchPrimitives', () => {
  it('uses the shared merchant canonicalizer', () => {
    expect(canonicalMerchantKey('Bobby Boy Bakeshop, LLC')).toBe('bobbyboybakeshop');
    expect(canonicalMerchantKey('BOBBY BOY BAKESHOP')).toBe('bobbyboybakeshop');
  });

  it('normalizes date-only values without timezone drift', () => {
    expect(normalizeDateOnly('2026-10-20T23:30:00-07:00')).toBe('2026-10-20');
    expect(daysBetween('2026-10-20', '2026-10-22T04:00:00.000Z')).toBe(2);
    expect(daysBetween('not-a-date', '2026-10-22')).toBe(Infinity);
  });

  it('prioritizes product and comparable identities for basket overlap', () => {
    const product = { product_id: 'product-1', description: 'AVOCADOS' };
    expect(itemIdentityKey(product)).toBe('product:product-1');
    expect(basketSimilarity(
      [product, { comparable_key: 'strawberry|1|lb' }],
      [{ product_id: 'product-1' }, { comparable_key: 'strawberry|1|lb' }]
    )).toBe(1);
  });
});
