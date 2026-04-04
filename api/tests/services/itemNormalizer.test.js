const { normalizeItemMetadata, normalizeUnit } = require('../../src/services/itemNormalizer');

describe('itemNormalizer', () => {
  it('normalizes units and derives comparable item metadata', () => {
    const normalized = normalizeItemMetadata({
      description: 'Sparkling Water Lime',
      brand: 'Water Co.',
      product_size: '12 oz',
      pack_size: '8 pack',
      unit: 'ounces',
    });

    expect(normalized).toMatchObject({
      normalized_name: 'sparkling water lime',
      normalized_brand: 'water co',
      normalized_size_value: 12,
      normalized_size_unit: 'oz',
      normalized_pack_size: 8,
      comparable_key: 'sparkling water lime|brand:water co|size:12oz|pack:8',
    });
  });

  it('keeps single-item products comparable even without package metadata', () => {
    const normalized = normalizeItemMetadata({
      description: 'Organic Bananas',
      brand: null,
    });

    expect(normalized.comparable_key).toBe('organic bananas');
    expect(normalized.normalized_size_value).toBeNull();
    expect(normalized.normalized_pack_size).toBeNull();
  });

  it('normalizes common unit aliases', () => {
    expect(normalizeUnit('ounces')).toBe('oz');
    expect(normalizeUnit('count')).toBe('ct');
    expect(normalizeUnit('liter')).toBe('l');
  });
});
