const { normalizeItemMetadata, normalizeUnit, parsePackSize } = require('../../src/services/itemNormalizer');

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
      normalized_quantity: 8,
      normalized_total_size_value: 96,
      normalized_total_size_unit: 'oz',
      estimated_unit_price: null,
      comparable_key: 'sparkling water lime|brand:water co|size:12oz|pack:8',
    });
  });

  it('derives total size and unit price when amount is present', () => {
    const normalized = normalizeItemMetadata({
      description: 'Protein Bars',
      amount: 12.99,
      brand: 'Bar Co',
      product_size: '2.1',
      pack_size: '6',
      unit: 'oz',
    });

    expect(normalized.normalized_total_size_value).toBe(12.6);
    expect(normalized.normalized_total_size_unit).toBe('oz');
    expect(normalized.estimated_unit_price).toBeCloseTo(1.031, 4);
  });

  it('keeps single-item products comparable even without package metadata', () => {
    const normalized = normalizeItemMetadata({
      description: 'Organic Bananas',
      brand: null,
    });

    expect(normalized.comparable_key).toBe('organic bananas');
    expect(normalized.normalized_size_value).toBeNull();
    expect(normalized.normalized_pack_size).toBeNull();
    expect(normalized.normalized_quantity).toBe(1);
  });

  it('normalizes common unit aliases', () => {
    expect(normalizeUnit('ounces')).toBe('oz');
    expect(normalizeUnit('count')).toBe('ct');
    expect(normalizeUnit('liter')).toBe('l');
  });

  it('parses multiplier-style pack sizes', () => {
    expect(parsePackSize('2 x 6')).toBe(12);
    expect(parsePackSize('3×4')).toBe(12);
  });
});
