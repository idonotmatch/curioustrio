jest.mock('../../src/models/product', () => ({
  findByUpc: jest.fn(),
  findBySkuAndMerchant: jest.fn(),
  findByNormalizedDetails: jest.fn(),
  findNameCandidates: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
}));
jest.mock('../../src/models/itemMatchDecision', () => ({
  findConfirmedAlias: jest.fn(),
  findForCandidate: jest.fn(),
}));

const Product = require('../../src/models/product');
const ItemMatchDecision = require('../../src/models/itemMatchDecision');
const { resolveProduct, resolveProductMatch } = require('../../src/services/productResolver');

describe('productResolver', () => {
  beforeEach(() => {
    Object.values(Product).forEach(fn => fn.mockReset && fn.mockReset());
    Product.findNameCandidates.mockResolvedValue([]);
    ItemMatchDecision.findConfirmedAlias.mockReset().mockResolvedValue(null);
    ItemMatchDecision.findForCandidate.mockReset().mockResolvedValue(null);
  });

  it('uses a household-confirmed alias before making a new normalized guess', async () => {
    Product.findByUpc.mockResolvedValue(null);
    Product.findBySkuAndMerchant.mockResolvedValue(null);
    Product.findByNormalizedDetails.mockResolvedValue(null);
    ItemMatchDecision.findConfirmedAlias.mockResolvedValue({ candidate_product_id: 'product-known' });

    const resolution = await resolveProductMatch({ description: 'Organic Bananas' }, 'Whole Foods', {
      householdId: 'household-1',
    });

    expect(resolution).toEqual({
      product_id: 'product-known',
      confidence: 'high',
      reason: 'household_confirmed_alias',
    });
    expect(ItemMatchDecision.findConfirmedAlias).toHaveBeenCalledWith(expect.objectContaining({
      householdId: 'household-1',
    }));
    expect(Product.findByNormalizedDetails).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a confirmed alias when current brand evidence conflicts', async () => {
    Product.findByUpc.mockResolvedValue(null);
    Product.findBySkuAndMerchant.mockResolvedValue(null);
    Product.findByNormalizedDetails.mockResolvedValue(null);
    Product.create.mockResolvedValue({ id: 'product-new' });
    ItemMatchDecision.findConfirmedAlias.mockResolvedValue({
      candidate_product_id: 'product-old',
      candidate_product_name: 'Laundry Pods',
      candidate_product_brand: 'Gain',
      candidate_product_merchant: 'Target',
    });

    const resolution = await resolveProductMatch({
      description: 'Laundry Pods',
      brand: 'Tide',
    }, 'Target', { householdId: 'household-1' });

    expect(resolution).toEqual({
      product_id: 'product-new',
      confidence: 'high',
      reason: 'created',
    });
  });

  it('creates a separate canonical product for an unmatched barcode instead of guessing by name', async () => {
    Product.findByUpc.mockResolvedValue(null);
    Product.findByNormalizedDetails.mockResolvedValue({
      id: 'name-only-candidate',
      name: 'Sparkling Water',
      merchant: 'Target',
    });
    Product.create.mockResolvedValue({ id: 'barcode-product' });

    const resolution = await resolveProductMatch({
      description: 'Sparkling Water',
      upc: '012345678901',
    }, 'Target', { householdId: 'household-1' });

    expect(Product.findByNormalizedDetails).not.toHaveBeenCalled();
    expect(Product.findNameCandidates).not.toHaveBeenCalled();
    expect(resolution).toEqual({
      product_id: 'barcode-product',
      confidence: 'high',
      reason: 'created',
    });
  });

  it('does not relink a household-rejected normalized candidate', async () => {
    Product.findByUpc.mockResolvedValue(null);
    Product.findBySkuAndMerchant.mockResolvedValue(null);
    Product.findByNormalizedDetails.mockResolvedValue({ id: 'product-rejected' });
    ItemMatchDecision.findForCandidate.mockResolvedValue({ decision: 'different' });

    const resolution = await resolveProductMatch({ description: 'Organic Bananas' }, 'Whole Foods', {
      householdId: 'household-1',
    });

    expect(resolution).toBeNull();
    expect(ItemMatchDecision.findForCandidate).toHaveBeenCalledWith(expect.objectContaining({
      candidateProductId: 'product-rejected',
      householdId: 'household-1',
    }));
    expect(Product.update).not.toHaveBeenCalled();
  });

  it('matches an existing product by normalized description and size metadata', async () => {
    Product.findByUpc.mockResolvedValue(null);
    Product.findBySkuAndMerchant.mockResolvedValue(null);
    Product.findByNormalizedDetails.mockResolvedValue({
      id: 'product-123',
      name: 'Sparkling Water',
      brand: 'Water Co',
      merchant: 'Target',
      product_size: '12',
      pack_size: '8',
      unit: 'oz',
    });
    Product.update.mockResolvedValue({});

    const productId = await resolveProduct({
      description: 'Sparkling Water',
      amount: 5.99,
      brand: 'Water Co',
      product_size: '12',
      pack_size: '8',
      unit: 'oz',
    }, 'Target');

    expect(Product.findByNormalizedDetails).toHaveBeenCalledWith({
      name: 'Sparkling Water',
      merchant: 'Target',
      brand: 'Water Co',
      productSize: '12',
      packSize: '8',
      unit: 'oz',
      allowCrossMerchant: true,
    });
    expect(productId).toBe('product-123');
  });

  it('finds a medium-confidence product candidate by normalized description when merchant context is strong', async () => {
    Product.findByUpc.mockResolvedValue(null);
    Product.findBySkuAndMerchant.mockResolvedValue(null);
    Product.findByNormalizedDetails.mockResolvedValue({
      id: 'product-456',
      name: 'Organic Bananas',
      merchant: 'Whole Foods',
    });
    Product.update.mockResolvedValue({});

    const resolution = await resolveProductMatch({
      description: 'Organic Bananas',
      amount: 2.99,
    }, 'Whole Foods');
    const productId = await resolveProduct({
      description: 'Organic Bananas',
      amount: 2.99,
    }, 'Whole Foods');

    expect(Product.findByNormalizedDetails).toHaveBeenCalledWith({
      name: 'Organic Bananas',
      merchant: 'Whole Foods',
      brand: undefined,
      productSize: undefined,
      packSize: undefined,
      unit: undefined,
      allowCrossMerchant: false,
    });
    expect(resolution).toEqual({
      product_id: 'product-456',
      confidence: 'medium',
      reason: 'normalized_match',
    });
    expect(productId).toBe('product-456');
  });

  it('keeps medium confidence while linking an exact merchant-backed normalized match', async () => {
    Product.findByUpc.mockResolvedValue(null);
    Product.findBySkuAndMerchant.mockResolvedValue(null);
    Product.findByNormalizedDetails.mockResolvedValue({
      id: 'product-789',
      name: 'Organic Extra Large Brown Eggs',
      merchant: 'Whole Foods',
    });
    Product.update.mockResolvedValue({});

    const resolution = await resolveProductMatch({
      description: 'Organic Extra Large Brown Eggs',
      amount: 6.49,
    }, 'Whole Foods');
    const productId = await resolveProduct({
      description: 'Organic Extra Large Brown Eggs',
      amount: 6.49,
    }, 'Whole Foods');

    expect(resolution).toEqual({
      product_id: 'product-789',
      confidence: 'medium',
      reason: 'normalized_match',
    });
    expect(productId).toBe('product-789');
  });

  it('matches merchant-backed variants when the description includes trailing merchant text', async () => {
    Product.findByUpc.mockResolvedValue(null);
    Product.findBySkuAndMerchant.mockResolvedValue(null);
    Product.findByNormalizedDetails.mockResolvedValue({
      id: 'product-900',
      name: 'Nike Running Shoes',
      merchant: 'Dicks Sporting Goods',
    });
    Product.update.mockResolvedValue({});

    const resolution = await resolveProductMatch({
      description: 'Nike Running Shoes from Dicks Sporting Goods',
      amount: 122.24,
    }, 'Dicks Sporting Goods');

    expect(Product.findByNormalizedDetails).toHaveBeenCalledWith({
      name: 'Nike Running Shoes from Dicks Sporting Goods',
      merchant: 'Dicks Sporting Goods',
      brand: undefined,
      productSize: undefined,
      packSize: undefined,
      unit: undefined,
      allowCrossMerchant: false,
    });
    expect(resolution).toEqual({
      product_id: 'product-900',
      confidence: 'medium',
      reason: 'normalized_match',
    });
  });

  it('does not create a canonical product from an unmatched name-only description', async () => {
    Product.findByUpc.mockResolvedValue(null);
    Product.findBySkuAndMerchant.mockResolvedValue(null);
    Product.findByNormalizedDetails.mockResolvedValue(null);

    const resolution = await resolveProductMatch({
      description: 'Organic Bananas',
      amount: 2.99,
    }, 'Whole Foods');

    expect(resolution).toBeNull();
    expect(Product.create).not.toHaveBeenCalled();
  });

  it('offers one strong same-merchant name variant for review', async () => {
    Product.findByUpc.mockResolvedValue(null);
    Product.findBySkuAndMerchant.mockResolvedValue(null);
    Product.findByNormalizedDetails.mockResolvedValue(null);
    Product.findNameCandidates.mockResolvedValue([{
      id: 'product-pampers',
      name: 'Pampers Pure',
      normalized_name: 'pampers pure',
      merchant: 'Target',
      brand: 'Pampers',
    }]);

    const resolution = await resolveProductMatch({
      description: 'Pampers Pure Diapers',
      amount: 42.99,
      brand: 'Pampers',
    }, 'Target', { householdId: 'household-1' });

    expect(Product.findNameCandidates).toHaveBeenCalledWith(expect.objectContaining({
      merchant: 'Target',
      searchToken: 'pure',
    }));
    expect(resolution).toEqual({
      product_id: 'product-pampers',
      confidence: 'medium',
      reason: 'name_variant_match',
    });
  });

  it('does not offer a name variant when equally strong candidates are ambiguous', async () => {
    Product.findByUpc.mockResolvedValue(null);
    Product.findBySkuAndMerchant.mockResolvedValue(null);
    Product.findByNormalizedDetails.mockResolvedValue(null);
    Product.findNameCandidates.mockResolvedValue([
      { id: 'product-a', name: 'Pampers Pure', normalized_name: 'pampers pure', merchant: 'Target' },
      { id: 'product-b', name: 'Pampers Pure', normalized_name: 'pampers pure', merchant: 'Target' },
    ]);

    const resolution = await resolveProductMatch({
      description: 'Pampers Pure Diapers',
      amount: 42.99,
    }, 'Target', { householdId: 'household-1' });

    expect(resolution).toBeNull();
    expect(ItemMatchDecision.findForCandidate).not.toHaveBeenCalled();
  });

  it('does not match low-confidence extracted item labels', async () => {
    const resolution = await resolveProductMatch({
      description: 'Pampers Pure Diapers',
      extraction_confidence: 'low',
    }, 'Target', { householdId: 'household-1' });

    expect(resolution).toBeNull();
    expect(Product.findByNormalizedDetails).not.toHaveBeenCalled();
    expect(Product.findNameCandidates).not.toHaveBeenCalled();
  });

  it('does not treat a merchant-free SKU as a stable global identity', async () => {
    Product.findByUpc.mockResolvedValue(null);
    Product.findByNormalizedDetails.mockResolvedValue(null);

    const resolution = await resolveProductMatch({
      description: 'Store Brand Crackers',
      sku: 'SKU-1042',
    }, null);

    expect(resolution).toBeNull();
    expect(Product.findBySkuAndMerchant).not.toHaveBeenCalled();
    expect(Product.create).not.toHaveBeenCalled();
  });

  it('skips product resolution for fee-like imported rows', async () => {
    const resolution = await resolveProductMatch({
      description: 'Delivery Fee',
      amount: 4.99,
    }, 'Instacart');
    const productId = await resolveProduct({
      description: 'Delivery Fee',
      amount: 4.99,
    }, 'Instacart');

    expect(resolution).toBeNull();
    expect(productId).toBeNull();
    expect(Product.findByUpc).not.toHaveBeenCalled();
    expect(Product.findBySkuAndMerchant).not.toHaveBeenCalled();
    expect(Product.findByNormalizedDetails).not.toHaveBeenCalled();
    expect(Product.create).not.toHaveBeenCalled();
  });
});
