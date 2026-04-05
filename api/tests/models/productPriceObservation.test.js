jest.mock('../../src/db', () => ({
  query: jest.fn(),
}));

const db = require('../../src/db');
const ProductPriceObservation = require('../../src/models/productPriceObservation');

beforeEach(() => {
  db.query.mockReset();
});

describe('ProductPriceObservation.normalize', () => {
  it('normalizes camelCase input into database-shaped fields', () => {
    const row = ProductPriceObservation.normalize({
      productId: 'product-1',
      merchant: 'Target',
      observedPrice: 36.99,
      observedUnitPrice: 0.4511,
      normalizedTotalSizeValue: 82,
      normalizedTotalSizeUnit: 'count',
      sourceType: 'manual',
      sourceKey: 'target:82',
      observedAt: '2026-04-04T10:00:00Z',
    });

    expect(row).toEqual(expect.objectContaining({
      product_id: 'product-1',
      merchant: 'Target',
      observed_price: 36.99,
      observed_unit_price: 0.4511,
      normalized_total_size_value: 82,
      normalized_total_size_unit: 'count',
      source_type: 'manual',
      source_key: 'target:82',
      observed_at: '2026-04-04T10:00:00Z',
    }));
  });
});

describe('ProductPriceObservation.create', () => {
  it('inserts one observation and returns the row', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'obs-1', merchant: 'Target' }] });

    const result = await ProductPriceObservation.create({
      productId: 'product-1',
      merchant: 'Target',
      observedPrice: 36.99,
      sourceType: 'manual',
      observedAt: '2026-04-04T10:00:00Z',
    });

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'obs-1', merchant: 'Target' });
  });

  it('returns null when the insert dedupes on conflict', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const result = await ProductPriceObservation.create({
      comparableKey: 'comparable:diapers',
      merchant: 'Target',
      observedPrice: 36.99,
      sourceType: 'manual',
      observedAt: '2026-04-04T10:00:00Z',
    });

    expect(result).toBeNull();
  });
});

describe('ProductPriceObservation.createBatch', () => {
  it('filters invalid rows and inserts valid observations', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'obs-1' }, { id: 'obs-2' }] });

    const result = await ProductPriceObservation.createBatch([
      {
        productId: 'product-1',
        merchant: 'Target',
        observedPrice: 36.99,
        sourceType: 'manual',
        observedAt: '2026-04-04T10:00:00Z',
      },
      {
        merchant: '',
        observedPrice: 0,
      },
      {
        comparableKey: 'comparable:wipes',
        merchant: 'Walmart',
        observedPrice: 12.49,
        sourceType: 'manual',
        observedAt: '2026-04-04T10:05:00Z',
      },
    ]);

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
  });
});

describe('ProductPriceObservation.findRecentByIdentity', () => {
  it('queries by product id and since timestamp when provided', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'obs-1' }] });

    const result = await ProductPriceObservation.findRecentByIdentity({
      productId: 'product-1',
      since: '2026-04-01T00:00:00Z',
      limit: 5,
    });

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][1]).toEqual(['product-1', '2026-04-01T00:00:00Z', 5]);
    expect(result).toEqual([{ id: 'obs-1' }]);
  });
});

describe('ProductPriceObservation.findBestRecentByIdentity', () => {
  it('returns the lowest comparable observed price', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 'obs-1', observed_price: '39.99', observed_unit_price: null },
        { id: 'obs-2', observed_price: '36.99', observed_unit_price: null },
        { id: 'obs-3', observed_price: '38.49', observed_unit_price: null },
      ],
    });

    const result = await ProductPriceObservation.findBestRecentByIdentity({
      comparableKey: 'comparable:diapers',
    });

    expect(result.id).toBe('obs-2');
  });
});
