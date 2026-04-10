jest.mock('../../src/db', () => ({
  query: jest.fn(),
}));

const db = require('../../src/db');
const MerchantMapping = require('../../src/models/merchantMapping');

describe('MerchantMapping', () => {
  beforeEach(() => {
    db.query.mockReset();
  });

  it('does not query merchant mappings without a merchant name', async () => {
    await expect(MerchantMapping.findByMerchant('household-1', null)).resolves.toBeNull();
    await expect(MerchantMapping.findByMerchant('household-1', '   ')).resolves.toBeNull();

    expect(db.query).not.toHaveBeenCalled();
  });

  it('does not upsert merchant mappings without a merchant name', async () => {
    await expect(MerchantMapping.upsert({
      householdId: 'household-1',
      merchantName: null,
      categoryId: 'category-1',
    })).resolves.toBeNull();

    expect(db.query).not.toHaveBeenCalled();
  });

  it('trims merchant names before lookup and upsert', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await MerchantMapping.findByMerchant('household-1', '  Amazon  ');

    expect(db.query.mock.calls[0][1]).toEqual(['household-1', 'Amazon']);

    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(MerchantMapping.upsert({
      householdId: 'household-1',
      merchantName: '  Target  ',
      categoryId: 'category-1',
    })).resolves.toBe(true);

    expect(db.query.mock.calls[1][1]).toEqual(['household-1', 'Target', 'category-1']);
  });
});
