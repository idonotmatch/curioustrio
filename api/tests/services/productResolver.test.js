jest.mock('../../src/models/product', () => ({
  findByUpc: jest.fn(),
  findBySkuAndMerchant: jest.fn(),
  findByNormalizedDetails: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
}));

const Product = require('../../src/models/product');
const { resolveProduct } = require('../../src/services/productResolver');

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
});
