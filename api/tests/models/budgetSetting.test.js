const db = require('../../src/db');
const BudgetSetting = require('../../src/models/budgetSetting');

let testUserId;
let testCategoryId;

beforeAll(async () => {
  const uResult = await db.query(
    `INSERT INTO users (provider_uid, name, email)
     VALUES ('test|budget-model-user', 'Budget Model User', 'bmodel@test.com')
     ON CONFLICT (provider_uid) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  testUserId = uResult.rows[0].id;

  const cResult = await db.query(
    `INSERT INTO categories (name) VALUES ('Budget Test Cat') RETURNING id`
  );
  testCategoryId = cResult.rows[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM budget_settings WHERE user_id = $1`, [testUserId]);
  await db.query(`DELETE FROM categories WHERE id = $1`, [testCategoryId]);
  await db.query(`DELETE FROM users WHERE provider_uid = 'test|budget-model-user'`);
});

afterEach(async () => {
  await db.query(`DELETE FROM budget_settings WHERE user_id = $1`, [testUserId]);
});

describe('BudgetSetting.upsert', () => {
  it('creates a total budget (categoryId null)', async () => {
    const result = await BudgetSetting.upsert({ userId: testUserId, categoryId: null, monthlyLimit: 1000 });
    expect(result).toBeDefined();
    expect(result.user_id).toBe(testUserId);
    expect(result.category_id).toBeNull();
    expect(parseFloat(result.monthly_limit)).toBe(1000);
  });

  it('creates a category budget', async () => {
    const result = await BudgetSetting.upsert({ userId: testUserId, categoryId: testCategoryId, monthlyLimit: 300 });
    expect(result).toBeDefined();
    expect(result.category_id).toBe(testCategoryId);
    expect(parseFloat(result.monthly_limit)).toBe(300);
  });

  it('updates on conflict', async () => {
    await BudgetSetting.upsert({ userId: testUserId, categoryId: null, monthlyLimit: 500 });
    const updated = await BudgetSetting.upsert({ userId: testUserId, categoryId: null, monthlyLimit: 750 });
    expect(parseFloat(updated.monthly_limit)).toBe(750);
    const rows = await db.query(`SELECT * FROM budget_settings WHERE user_id = $1 AND category_id IS NULL`, [testUserId]);
    expect(rows.rows.length).toBe(1);
  });
});

describe('BudgetSetting.findByUser', () => {
  it('returns all settings for user', async () => {
    await BudgetSetting.upsert({ userId: testUserId, categoryId: null, monthlyLimit: 800 });
    await BudgetSetting.upsert({ userId: testUserId, categoryId: testCategoryId, monthlyLimit: 200 });
    const settings = await BudgetSetting.findByUser(testUserId);
    expect(settings.length).toBe(2);
    expect(settings[0].category_id).toBeNull(); // total first
  });
});

describe('BudgetSetting.remove', () => {
  it('deletes the row and returns it', async () => {
    await BudgetSetting.upsert({ userId: testUserId, categoryId: testCategoryId, monthlyLimit: 200 });
    const removed = await BudgetSetting.remove({ userId: testUserId, categoryId: testCategoryId });
    expect(removed).toBeDefined();
    expect(removed.user_id).toBe(testUserId);
    const check = await db.query(`SELECT * FROM budget_settings WHERE user_id = $1 AND category_id = $2`, [testUserId, testCategoryId]);
    expect(check.rows.length).toBe(0);
  });

  it('returns null when not found', async () => {
    const result = await BudgetSetting.remove({ userId: '00000000-0000-0000-0000-000000000000', categoryId: null });
    expect(result).toBeNull();
  });
});
