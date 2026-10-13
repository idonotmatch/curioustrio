const {
  deriveItemFamilyIdentity,
  derivePriceVariant,
  enrichWithItemFamily,
  normalizeVariantPair,
} = require('../../src/services/itemFamilyService');

describe('itemFamilyService', () => {
  it.each([
    ['AVOCADOS', 'produce:avocado', 'Avocados'],
    ['4-Avocado Bag Org Hass 4', 'produce:avocado', 'Avocados'],
    ['ORG STRAWBRY', 'produce:strawberry', 'Strawberries'],
    ['R-Strawberry Org Bag 1 B', 'produce:strawberry', 'Strawberries'],
  ])('recognizes produce family for %s', (description, familyKey, familyName) => {
    expect(deriveItemFamilyIdentity({ description })).toEqual({
      family_key: familyKey,
      family_name: familyName,
    });
  });

  it.each([
    'Freeze Dried Strawberrie',
    'Avocado Lime Ranch Dressing',
    'AVO OIL CHIP',
    'Strawberry Marshmallows',
    'Strawberry Yogurt',
    'Avocado Toast',
  ])('does not collapse processed products into produce families: %s', (description) => {
    expect(deriveItemFamilyIdentity({ description })).toBeNull();
  });

  it('uses normalized package size as the safest price variant', () => {
    expect(derivePriceVariant({
      description: 'Hass Avocados 4 ct',
      normalized_total_size_value: 4,
      normalized_total_size_unit: 'ct',
      comparable_key: 'hass avocado|size:4ct',
    })).toEqual({
      price_variant_key: 'produce:avocado|size:4ct',
      price_variant_label: '4 count',
      price_comparison_confidence: 'high',
    });
  });

  it('keeps unknown packages in exact normalized variants', () => {
    expect(enrichWithItemFamily({ description: 'ORG STRAWBRY', comparable_key: 'org strawbry' })).toMatchObject({
      family_key: 'produce:strawberry',
      family_name: 'Strawberries',
      price_variant_key: 'produce:strawberry|identity:comparable:organic strawberry',
      price_comparison_confidence: 'unknown_package',
    });
  });

  it('normalizes comparison pairs deterministically', () => {
    expect(normalizeVariantPair('variant:b', 'variant:a')).toEqual(['variant:a', 'variant:b']);
  });
});
