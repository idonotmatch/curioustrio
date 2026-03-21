const db = require('../../src/db');
const BudgetSetting = require('../../src/models/budgetSetting');

let testHouseholdId;
let testCategoryId;
let testUserId;

beforeAll(async () => {
  // Create a test household
  const hResult = await db.query(
    `INSERT INTO households (name) VALUES ('Budget Test Household') RETURNING id`
  );
  testHouseholdId = hResult.rows[0].id;

  // Create a test category linked to the household
  const cResult = await db.query(
    `INSERT INTO categories (household_id, name) VALUES ($1, 'Budget Test Category') RETURNING id`,
    [testHouseholdId]
  );
  testCategoryId = cResult.rows[0].id;

  // Create a test user linked to the household
  const uResult = await db.query(
    `INSERT INTO users (auth0_id, name, email, household_id)
     VALUES ('auth0|budget-test-user', 'Budget Test User', 'budgettest@test.com', $1)
     ON CONFLICT (auth0_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, household_id = $1
     RETURNING id`,
    [testHouseholdId]
  );
  testUserId = uResult.rows[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM budget_settings WHERE household_id = $1`, [testHouseholdId]);
  await db.query(`DELETE FROM categories WHERE id = $1`, [testCategoryId]);
  await db.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
  await db.query(`DELETE FROM households WHERE id = $1`, [testHouseholdId]);
  await db.pool.end();
});

describe('BudgetSetting.upsert', () => {
  it('creates a total budget (categoryId null) and confirms row in DB', async () => {
    const result = await BudgetSetting.upsert({
      householdId: testHouseholdId,
      categoryId: null,
      monthlyLimit: 1000,
    });

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.household_id).toBe(testHouseholdId);
    expect(result.category_id).toBeNull();
    expect(parseFloat(result.monthly_limit)).toBe(1000);

    // Confirm in DB
    const dbCheck = await db.query(
      `SELECT * FROM budget_settings WHERE household_id = $1 AND category_id IS NULL`,
      [testHouseholdId]
    );
    expect(dbCheck.rows.length).toBe(1);
    expect(parseFloat(dbCheck.rows[0].monthly_limit)).toBe(1000);
  });

  it('creates a category budget and confirms row in DB', async () => {
    const result = await BudgetSetting.upsert({
      householdId: testHouseholdId,
      categoryId: testCategoryId,
      monthlyLimit: 300,
    });

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.household_id).toBe(testHouseholdId);
    expect(result.category_id).toBe(testCategoryId);
    expect(parseFloat(result.monthly_limit)).toBe(300);

    // Confirm in DB
    const dbCheck = await db.query(
      `SELECT * FROM budget_settings WHERE household_id = $1 AND category_id = $2`,
      [testHouseholdId, testCategoryId]
    );
    expect(dbCheck.rows.length).toBe(1);
    expect(parseFloat(dbCheck.rows[0].monthly_limit)).toBe(300);
  });

  it('updates on conflict — calling twice with different monthlyLimit returns updated value', async () => {
    // First upsert (already done above for total budget, but use a fresh call here)
    await BudgetSetting.upsert({
      householdId: testHouseholdId,
      categoryId: null,
      monthlyLimit: 500,
    });

    // Second upsert with different limit
    const updated = await BudgetSetting.upsert({
      householdId: testHouseholdId,
      categoryId: null,
      monthlyLimit: 750,
    });

    expect(updated).toBeDefined();
    expect(parseFloat(updated.monthly_limit)).toBe(750);

    // Confirm only one row and updated value in DB
    const dbCheck = await db.query(
      `SELECT * FROM budget_settings WHERE household_id = $1 AND category_id IS NULL`,
      [testHouseholdId]
    );
    expect(dbCheck.rows.length).toBe(1);
    expect(parseFloat(dbCheck.rows[0].monthly_limit)).toBe(750);
  });
});

describe('BudgetSetting.findByHousehold', () => {
  it('returns all settings for household with null category_id first', async () => {
    const settings = await BudgetSetting.findByHousehold(testHouseholdId);

    expect(Array.isArray(settings)).toBe(true);
    expect(settings.length).toBeGreaterThanOrEqual(2);

    // Null category_id should be first
    expect(settings[0].category_id).toBeNull();

    // Category budget should follow
    const catSetting = settings.find(s => s.category_id === testCategoryId);
    expect(catSetting).toBeDefined();
    expect(parseFloat(catSetting.monthly_limit)).toBe(300);
  });
});

describe('BudgetSetting.remove', () => {
  it('deletes the row and returns the deleted row', async () => {
    // Insert a fresh category budget to delete
    const inserted = await BudgetSetting.upsert({
      householdId: testHouseholdId,
      categoryId: testCategoryId,
      monthlyLimit: 200,
    });

    const removed = await BudgetSetting.remove({
      householdId: testHouseholdId,
      categoryId: testCategoryId,
    });

    expect(removed).toBeDefined();
    expect(removed.household_id).toBe(testHouseholdId);
    expect(removed.category_id).toBe(testCategoryId);

    // Confirm deleted from DB
    const dbCheck = await db.query(
      `SELECT * FROM budget_settings WHERE household_id = $1 AND category_id = $2`,
      [testHouseholdId, testCategoryId]
    );
    expect(dbCheck.rows.length).toBe(0);
  });

  it('returns null when row not found', async () => {
    const result = await BudgetSetting.remove({
      householdId: '00000000-0000-0000-0000-000000000000',
      categoryId: null,
    });

    expect(result).toBeNull();
  });
});
