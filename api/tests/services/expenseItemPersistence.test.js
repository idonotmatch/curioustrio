jest.mock('../../src/db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

const db = require('../../src/db');
const ExpenseItem = require('../../src/models/expenseItem');

describe('expense item persistence contract', () => {
  beforeEach(() => {
    db.query.mockReset();
    db.query.mockResolvedValue({ rows: [] });
  });

  it('writes observation provenance with aligned SQL parameters', async () => {
    await ExpenseItem.createBulk('expense-1', [{
      description: 'Sparkling Water',
      amount: 5.99,
      source_type: 'camera',
      raw_description: 'SPRK WTR',
      extraction_confidence: 'medium',
    }]);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('observation_key, source_type, raw_description, extraction_confidence');
    expect(sql).toContain('$30');
    expect(params).toHaveLength(30);
    expect(params[26]).toEqual(expect.any(String));
    expect(params.slice(27)).toEqual(['camera', 'SPRK WTR', 'medium']);
  });

  it('keeps placeholders aligned for multiple observations', async () => {
    await ExpenseItem.createBulk('expense-1', [
      { description: 'Milk', amount: 4.25 },
      { description: 'Eggs', amount: 5.5 },
    ]);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('$59');
    expect(params).toHaveLength(59);
    expect(params[26]).toEqual(expect.any(String));
    expect(params[55]).toEqual(expect.any(String));
  });

  it('drops parsed numeric values that cannot fit database columns', async () => {
    await ExpenseItem.createBulk('expense-1', [{
      description: 'Malformed item',
      amount: 7047982594,
      quantity: 7047982594,
      unit_price: 7047982594,
      product_size: '7047982594',
      pack_size: '7047982594',
      unit: 'oz',
    }]);

    const [, params] = db.query.mock.calls[0];
    expect(params[2]).toBeNull();
    expect(params[3]).toBeNull();
    expect(params[4]).toBeNull();
    expect(params[16]).toBeNull();
    expect(params[18]).toBeNull();
    expect(params[19]).toBeNull();
    expect(params[20]).toBeNull();
    expect(params[22]).toBeNull();
  });
});
