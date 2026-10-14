const {
  deriveItemFamilyIdentity,
  derivePriceVariant,
  enrichWithItemFamily,
  isSupportedItemFamilyKey,
  normalizeVariantPair,
} = require('../../src/services/itemFamilyService');

describe('itemFamilyService', () => {
  it.each([
    ['AVOCADOS', 'produce:avocado', 'Avocados'],
    ['4-Avocado Bag Org Hass 4', 'produce:avocado', 'Avocados'],
    ['ORG STRAWBRY', 'produce:strawberry', 'Strawberries'],
    ['Mandarin Oranges 3 lb', 'produce:mandarin', 'Mandarins'],
    ['Banana Org Each', 'produce:banana', 'Bananas'],
    ['A-Tomatoes Grape Org', 'produce:tomato', 'Tomatoes'],
    ['R-Greens Kale Organic Sh', 'produce:kale', 'Kale'],
    ['Large Brown Eggs 12 ct', 'dairy:eggs', 'Eggs'],
    ['Organic Whole Milk 1 gal', 'dairy:milk', 'Dairy Milk'],
    ['Greek Strawberry Yogurt', 'dairy:yogurt', 'Yogurt'],
    ['365 White Artisan Bread 16 oz', 'bakery:bread', 'Bread'],
    ['Cocoa Cereal', 'pantry:cereal', 'Cereal'],
    ['Sparkling Water Lime 8 pack', 'beverage:sparkling-water', 'Sparkling Water'],
    ['Organic Ground Coffee 2 lb', 'beverage:coffee', 'Coffee'],
    ['English Breakfast Tea Bags 40 ct', 'beverage:tea', 'Tea'],
    ['Ultra Soft Toilet Paper 12 ct', 'household:toilet-paper', 'Toilet Paper'],
    ['Size 4 Diapers 120 ct', 'baby:diapers', 'Diapers'],
    ['Chicken Recipe Dog Food', 'pet:dog-food', 'Dog Food'],
  ])('recognizes a reusable family for %s', (description, familyKey, familyName) => {
    expect(deriveItemFamilyIdentity({ description })).toEqual({
      family_key: familyKey,
      family_name: familyName,
    });
    expect(isSupportedItemFamilyKey(familyKey)).toBe(true);
  });

  it.each([
    'Freeze Dried Strawberrie',
    'Avocado Lime Ranch Dressing',
    'AVO OIL CHIP',
    'Strawberry Marshmallows',
    'Avocado Toast',
    'Banana Bread',
    'Apple Watch Case',
    'OLIPOP Crisp Apple Prebiotic Soda',
    'Coffee Cake',
    'Mini Cheddar Sandwich Crackers',
    'Tomato Feta Soup',
    'MUTTI Tomato Paste',
    'Blueberry Waffles',
    'Veggie Sticks Potato Snack',
    'Homestyle Flour Tortilla',
    'Butter Croissant',
    'Whole Milk Ricotta',
    'Beef and Broccoli Entree',
    'Corn and Chile Tomato-Less Salsa',
    'Iced Coffee',
    'Drip Coffee',
    'Loaf Slice',
  ])('does not collapse derivatives or unrelated products into a staple family: %s', (description) => {
    expect(deriveItemFamilyIdentity({ description })).toBeNull();
  });

  it('allows a processed product to match its own family instead of its ingredient', () => {
    expect(deriveItemFamilyIdentity({ description: 'Strawberry Yogurt' })).toEqual({
      family_key: 'dairy:yogurt',
      family_name: 'Yogurt',
    });
  });

  it('does not build food families from restaurant line items', () => {
    expect(deriveItemFamilyIdentity({
      description: 'Coffee',
      category_group_name: 'Dining Out',
    })).toBeNull();
  });

  it('uses both variant descriptors and normalized size for automatic price comparisons', () => {
    expect(derivePriceVariant({
      description: 'Organic Hass Avocados 4 ct',
      normalized_total_size_value: 4,
      normalized_total_size_unit: 'ct',
    })).toEqual({
      price_variant_key: 'produce:avocado|variant:organic hass|size:4ct',
      price_variant_label: 'Organic Hass, 4 count',
      price_comparison_confidence: 'high',
    });
  });

  it('normalizes equivalent labels while keeping meaningful variants distinct', () => {
    const first = derivePriceVariant({
      description: 'ORG STRAWBRY 16 oz',
      normalized_total_size_value: 16,
      normalized_total_size_unit: 'oz',
    });
    const second = derivePriceVariant({
      description: 'Organic Strawberries 1 lb',
      normalized_total_size_value: 16,
      normalized_total_size_unit: 'oz',
    });
    const conventional = derivePriceVariant({
      description: 'Strawberries 1 lb',
      normalized_total_size_value: 16,
      normalized_total_size_unit: 'oz',
    });

    expect(first.price_variant_key).toBe(second.price_variant_key);
    expect(conventional.price_variant_key).not.toBe(first.price_variant_key);
  });

  it('does not collapse different milk types with the same package size', () => {
    const dairy = enrichWithItemFamily({
      description: 'Whole Milk 1 gal',
      normalized_total_size_value: 128,
      normalized_total_size_unit: 'fl_oz',
    });
    const oat = enrichWithItemFamily({
      description: 'Oat Milk 1 gal',
      normalized_total_size_value: 128,
      normalized_total_size_unit: 'fl_oz',
    });

    expect(dairy.family_key).toBe('dairy:milk');
    expect(oat.family_key).toBe('beverage:oat-milk');
    expect(dairy.price_variant_key).not.toBe(oat.price_variant_key);
  });

  it('keeps unknown packages in exact normalized variants', () => {
    expect(enrichWithItemFamily({ description: 'ORG STRAWBRY', comparable_key: 'org strawbry' })).toMatchObject({
      family_key: 'produce:strawberry',
      family_name: 'Strawberries',
      price_variant_key: 'produce:strawberry|variant:organic|identity:comparable:organic strawberry',
      price_comparison_confidence: 'unknown_package',
    });
  });

  it('rejects arbitrary family keys', () => {
    expect(isSupportedItemFamilyKey('produce:dragonfruit')).toBe(false);
    expect(isSupportedItemFamilyKey('anything:else')).toBe(false);
  });

  it('normalizes comparison pairs deterministically', () => {
    expect(normalizeVariantPair('variant:b', 'variant:a')).toEqual(['variant:a', 'variant:b']);
  });
});
