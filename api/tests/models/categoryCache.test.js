jest.mock('../../src/db', () => ({ query: jest.fn() }));

const db = require('../../src/db');
const Category = require('../../src/models/category');

describe('Category read cache', () => {
  beforeEach(() => {
    db.query.mockReset();
    Category.clearCategoryCache();
  });

  it('coalesces repeated household category reads and returns defensive copies', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'cat-1', name: 'Dining' }] });

    const first = await Category.findByHousehold('household-1');
    first[0].name = 'Changed locally';
    const second = await Category.findByHousehold('household-1');

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(second).toEqual([{ id: 'cat-1', name: 'Dining' }]);
  });

  it('reads again after explicit invalidation', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'cat-1', name: 'Dining' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'cat-1', name: 'Food' }] });

    await Category.findByHousehold('household-1');
    Category.clearCategoryCache();
    await expect(Category.findByHousehold('household-1')).resolves.toEqual([
      { id: 'cat-1', name: 'Food' },
    ]);
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('bounds retained household entries as new households are read', async () => {
    db.query.mockResolvedValue({ rows: [] });

    for (let index = 0; index < 275; index += 1) {
      await Category.findByHousehold(`household-${index}`);
    }

    expect(Category.categoryCacheSize()).toBeLessThanOrEqual(250);
    await Category.findByHousehold('household-0');
    expect(db.query).toHaveBeenCalledTimes(276);
  });
});
