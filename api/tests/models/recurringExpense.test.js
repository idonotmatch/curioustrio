const db = require('../../src/db');
const RecurringExpense = require('../../src/models/recurringExpense');

let testHouseholdId;
let testCategoryId;
let testUserId;

beforeAll(async () => {
  const hResult = await db.query(
    `INSERT INTO households (name) VALUES ('Recurring Test Household') RETURNING id`
  );
  testHouseholdId = hResult.rows[0].id;

  const cResult = await db.query(
    `INSERT INTO categories (household_id, name) VALUES ($1, 'Recurring Test Category') RETURNING id`,
    [testHouseholdId]
  );
  testCategoryId = cResult.rows[0].id;

  const uResult = await db.query(
    `INSERT INTO users (auth0_id, name, email, household_id)
     VALUES ('auth0|recurring-model-test', 'Recurring Model User', 'recurringmodel@test.com', $1)
     ON CONFLICT (auth0_id) DO UPDATE SET household_id = $1
     RETURNING id`,
    [testHouseholdId]
  );
  testUserId = uResult.rows[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM recurring_expenses WHERE household_id = $1`, [testHouseholdId]);
  await db.query(`DELETE FROM categories WHERE id = $1`, [testCategoryId]);
  await db.query(`UPDATE users SET household_id = NULL WHERE id = $1`, [testUserId]);
  await db.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
  await db.query(`DELETE FROM households WHERE id = $1`, [testHouseholdId]);
  await db.pool.end();
});

afterEach(async () => {
  await db.query(`DELETE FROM recurring_expenses WHERE household_id = $1`, [testHouseholdId]);
});

describe('RecurringExpense.create', () => {
  it('inserts a row and returns it', async () => {
    const result = await RecurringExpense.create({
      householdId: testHouseholdId,
      ownedBy: 'household',
      userId: testUserId,
      merchant: 'Netflix',
      expectedAmount: 15.99,
      categoryId: testCategoryId,
      frequency: 'monthly',
      nextExpectedDate: '2026-04-01',
    });

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.household_id).toBe(testHouseholdId);
    expect(result.merchant).toBe('Netflix');
    expect(parseFloat(result.expected_amount)).toBe(15.99);
    expect(result.frequency).toBe('monthly');
    expect(result.owned_by).toBe('household');
  });
});

describe('RecurringExpense.findByHousehold', () => {
  it('returns rows ordered by next_expected_date and includes category_name', async () => {
    await RecurringExpense.create({
      householdId: testHouseholdId,
      ownedBy: 'household',
      userId: testUserId,
      merchant: 'Spotify',
      expectedAmount: 9.99,
      categoryId: testCategoryId,
      frequency: 'monthly',
      nextExpectedDate: '2026-05-01',
    });

    await RecurringExpense.create({
      householdId: testHouseholdId,
      ownedBy: 'household',
      userId: testUserId,
      merchant: 'Netflix',
      expectedAmount: 15.99,
      categoryId: testCategoryId,
      frequency: 'monthly',
      nextExpectedDate: '2026-04-01',
    });

    const rows = await RecurringExpense.findByHousehold(testHouseholdId);
    expect(rows.length).toBe(2);
    // Should be ordered by next_expected_date ASC
    expect(rows[0].merchant).toBe('Netflix');
    expect(rows[1].merchant).toBe('Spotify');
    // Should include category_name
    expect(rows[0].category_name).toBe('Recurring Test Category');
  });
});

describe('RecurringExpense.remove', () => {
  it('deletes and returns the row', async () => {
    const created = await RecurringExpense.create({
      householdId: testHouseholdId,
      ownedBy: 'household',
      userId: testUserId,
      merchant: 'Hulu',
      expectedAmount: 12.99,
      categoryId: testCategoryId,
      frequency: 'monthly',
      nextExpectedDate: '2026-04-15',
    });

    const removed = await RecurringExpense.remove(created.id, testHouseholdId);
    expect(removed).toBeDefined();
    expect(removed.id).toBe(created.id);
    expect(removed.merchant).toBe('Hulu');

    // Confirm deleted
    const dbCheck = await db.query(
      `SELECT * FROM recurring_expenses WHERE id = $1`,
      [created.id]
    );
    expect(dbCheck.rows.length).toBe(0);
  });

  it('returns null when not found', async () => {
    const result = await RecurringExpense.remove(
      '00000000-0000-0000-0000-000000000000',
      testHouseholdId
    );
    expect(result).toBeNull();
  });
});

describe('RecurringExpense.findDue', () => {
  it('returns items due within N days', async () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const farFuture = new Date(today);
    farFuture.setDate(farFuture.getDate() + 30);
    const farFutureStr = farFuture.toISOString().split('T')[0];

    await RecurringExpense.create({
      householdId: testHouseholdId,
      ownedBy: 'household',
      userId: testUserId,
      merchant: 'DueSoon',
      expectedAmount: 10.00,
      categoryId: testCategoryId,
      frequency: 'monthly',
      nextExpectedDate: tomorrowStr,
    });

    await RecurringExpense.create({
      householdId: testHouseholdId,
      ownedBy: 'household',
      userId: testUserId,
      merchant: 'FarAway',
      expectedAmount: 20.00,
      categoryId: testCategoryId,
      frequency: 'monthly',
      nextExpectedDate: farFutureStr,
    });

    const due = await RecurringExpense.findDue(testHouseholdId, 3);
    expect(due.length).toBe(1);
    expect(due[0].merchant).toBe('DueSoon');
  });
});
