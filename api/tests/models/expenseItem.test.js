const db = require('../../src/db');
const ExpenseItem = require('../../src/models/expenseItem');

let householdId, userId, expenseId;

beforeAll(async () => {
  const hh = await db.query(`INSERT INTO households (name) VALUES ('Items Test HH') RETURNING id`);
  householdId = hh.rows[0].id;
  const u = await db.query(
    `INSERT INTO users (provider_uid, name, email, household_id)
     VALUES ('auth0|items-test', 'Items Tester', 'items@test.com', $1) RETURNING id`,
    [householdId]
  );
  userId = u.rows[0].id;
  const e = await db.query(
    `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
     VALUES ($1, $2, 'Test Merchant', 52.40, '2026-03-21', 'camera', 'confirmed') RETURNING id`,
    [userId, householdId]
  );
  expenseId = e.rows[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM expense_items WHERE expense_id = $1`, [expenseId]);
  await db.query(`DELETE FROM expenses WHERE id = $1`, [expenseId]);
  await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await db.query(`DELETE FROM households WHERE id = $1`, [householdId]);
});

describe('ExpenseItem.createBulk', () => {
  afterEach(async () => {
    await db.query(`DELETE FROM expense_items WHERE expense_id = $1`, [expenseId]);
  });

  it('inserts multiple items and returns them', async () => {
    const rows = await ExpenseItem.createBulk(expenseId, [
      { description: 'Milk 2%', amount: 3.49 },
      { description: 'Dozen Eggs', amount: 4.99 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].description).toBe('Milk 2%');
    expect(Number(rows[0].amount)).toBe(3.49);
    expect(rows[0].expense_id).toBe(expenseId);
  });

  it('returns [] when items array is empty', async () => {
    expect(await ExpenseItem.createBulk(expenseId, [])).toEqual([]);
  });

  it('returns [] when items is null', async () => {
    expect(await ExpenseItem.createBulk(expenseId, null)).toEqual([]);
  });

  it('allows null amount', async () => {
    const rows = await ExpenseItem.createBulk(expenseId, [{ description: 'Unknown price', amount: null }]);
    expect(rows[0].amount).toBeNull();
  });

  it('persists parsed metadata fields on items', async () => {
    const rows = await ExpenseItem.createBulk(expenseId, [{
      description: 'Sparkling Water',
      amount: 5.99,
      upc: '123456789012',
      sku: 'SW-12',
      brand: 'Water Co',
      product_size: '12',
      pack_size: '8',
      unit: 'oz',
    }]);
    expect(rows[0].upc).toBe('123456789012');
    expect(rows[0].sku).toBe('SW-12');
    expect(rows[0].brand).toBe('Water Co');
    expect(rows[0].product_size).toBe('12');
    expect(rows[0].pack_size).toBe('8');
    expect(rows[0].unit).toBe('oz');
    expect(rows[0].normalized_name).toBe('sparkling water');
    expect(rows[0].normalized_brand).toBe('water co');
    expect(Number(rows[0].normalized_size_value)).toBe(12);
    expect(rows[0].normalized_size_unit).toBe('oz');
    expect(Number(rows[0].normalized_pack_size)).toBe(8);
    expect(Number(rows[0].normalized_quantity)).toBe(8);
    expect(Number(rows[0].normalized_total_size_value)).toBe(96);
    expect(rows[0].normalized_total_size_unit).toBe('oz');
    expect(Number(rows[0].estimated_unit_price)).toBeCloseTo(0.0624, 4);
    expect(rows[0].comparable_key).toBe('sparkling water|brand:water co|size:12oz|pack:8');
  });
});

describe('ExpenseItem.findByExpenseId', () => {
  afterEach(async () => {
    await db.query(`DELETE FROM expense_items WHERE expense_id = $1`, [expenseId]);
  });

  it('returns items in sort_order ASC', async () => {
    await ExpenseItem.createBulk(expenseId, [
      { description: 'B item', amount: 2.00, sort_order: 1 },
      { description: 'A item', amount: 1.00, sort_order: 0 },
    ]);
    const rows = await ExpenseItem.findByExpenseId(expenseId);
    expect(rows[0].description).toBe('A item');
    expect(rows[1].description).toBe('B item');
  });

  it('returns [] when expense has no items', async () => {
    expect(await ExpenseItem.findByExpenseId(expenseId)).toEqual([]);
  });
});

describe('ExpenseItem.replaceItems', () => {
  afterEach(async () => {
    await db.query(`DELETE FROM expense_items WHERE expense_id = $1`, [expenseId]);
  });

  it('replaces all items atomically', async () => {
    await ExpenseItem.createBulk(expenseId, [{ description: 'Old item', amount: 1.00 }]);
    await ExpenseItem.replaceItems(expenseId, [
      { description: 'New A', amount: 5.00 },
      { description: 'New B', amount: 6.00 },
    ]);
    const rows = await ExpenseItem.findByExpenseId(expenseId);
    expect(rows).toHaveLength(2);
    expect(rows[0].description).toBe('New A');
  });

  it('clears all items when called with empty array', async () => {
    await ExpenseItem.createBulk(expenseId, [{ description: 'To be cleared', amount: 1.00 }]);
    await ExpenseItem.replaceItems(expenseId, []);
    expect(await ExpenseItem.findByExpenseId(expenseId)).toEqual([]);
  });
});

describe('Expense.findById includes item_count', () => {
  const Expense = require('../../src/models/expense');

  afterEach(async () => {
    await db.query(`DELETE FROM expense_items WHERE expense_id = $1`, [expenseId]);
  });

  it('returns item_count = 0 when no items', async () => {
    const exp = await Expense.findById(expenseId);
    expect(exp.item_count).toBe(0);
  });

  it('returns correct item_count after createBulk', async () => {
    await ExpenseItem.createBulk(expenseId, [
      { description: 'Item A', amount: 1.00 },
      { description: 'Item B', amount: 2.00 },
    ]);
    const exp = await Expense.findById(expenseId);
    expect(exp.item_count).toBe(2);
  });
});
