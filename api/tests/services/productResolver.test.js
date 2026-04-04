jest.mock('../../src/models/product', () => ({
  findByUpc: jest.fn(),
  findBySkuAndMerchant: jest.fn(),
  findByNormalizedDetails: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
}));

const Product = require('../../src/models/product');
const { resolveProduct, resolveProductMatch } = require('../../src/services/productResolver');

describe('productResolver', () => {
  beforeEach(() => {
    Object.values(Product).forEach(fn => fn.mockReset && fn.mockReset());
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
    });
    expect(resolution).toEqual({
      product_id: 'product-456',
      confidence: 'medium',
      reason: 'normalized_match',
    });
    expect(productId).toBeNull();
  });

  it('returns medium confidence for merchant-backed name-only matches without auto-linking', async () => {
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
    expect(productId).toBeNull();
  });
});
