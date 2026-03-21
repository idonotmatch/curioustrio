const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.auth0Id = 'auth0|test-budget-user';
    next();
  },
}));

let householdId;
let categoryId;
let userId;

beforeAll(async () => {
  // Create a household
  const hhResult = await db.query(
    `INSERT INTO households (name) VALUES ('Budget Test Household') RETURNING id`
  );
  householdId = hhResult.rows[0].id;

  // Create a category
  const catResult = await db.query(
    `INSERT INTO categories (name, household_id) VALUES ('Groceries', $1) RETURNING id`,
    [householdId]
  );
  categoryId = catResult.rows[0].id;

  // Create test user with household_id
  const userResult = await db.query(
    `INSERT INTO users (auth0_id, name, email, household_id)
     VALUES ('auth0|test-budget-user', 'Budget User', 'budget@test.com', $1)
     ON CONFLICT (auth0_id) DO UPDATE SET household_id = $1
     RETURNING id`,
    [householdId]
  );
  userId = userResult.rows[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM budget_settings WHERE household_id = $1`, [householdId]);
  await db.query(`DELETE FROM expenses WHERE household_id = $1`, [householdId]);
  await db.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
  await db.query(`UPDATE users SET household_id = NULL WHERE auth0_id = 'auth0|test-budget-user'`);
  await db.query(`DELETE FROM households WHERE id = $1`, [householdId]);
});

afterEach(async () => {
  // Clean up budget settings between tests
  await db.query(`DELETE FROM budget_settings WHERE household_id = $1`, [householdId]);
  await db.query(`DELETE FROM expenses WHERE household_id = $1`, [householdId]);
});

describe('GET /budgets', () => {
  it('returns { total: null, categories: [] } when no budget settings', async () => {
    const res = await request(app).get('/budgets');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeNull();
    expect(res.body.categories).toEqual([]);
  });

  it('returns total budget with correct spent/remaining from current-month confirmed expenses', async () => {
    // Set a total budget
    await db.query(
      `INSERT INTO budget_settings (household_id, category_id, monthly_limit)
       VALUES ($1, NULL, 500.00)`,
      [householdId]
    );

    // Insert a confirmed expense for this month
    const thisMonth = new Date().toISOString().slice(0, 7);
    const expenseDate = `${thisMonth}-15`;
    await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'TestMerchant', 75.00, $3, 'manual', 'confirmed')`,
      [userId, householdId, expenseDate]
    );

    // Insert a pending expense that should NOT count
    await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'PendingMerchant', 25.00, $3, 'manual', 'pending')`,
      [userId, householdId, expenseDate]
    );

    const res = await request(app).get('/budgets');
    expect(res.status).toBe(200);
    expect(res.body.total).not.toBeNull();
    expect(res.body.total.limit).toBe(500);
    expect(res.body.total.spent).toBe(75);
    expect(res.body.total.remaining).toBe(425);
  });
});

describe('PUT /budgets/total', () => {
  it('creates total budget and returns the setting row', async () => {
    const res = await request(app)
      .put('/budgets/total')
      .send({ monthly_limit: 1000 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('household_id', householdId);
    expect(parseFloat(res.body.monthly_limit)).toBe(1000);
    expect(res.body.category_id).toBeNull();
  });

  it('returns 400 when monthly_limit is missing', async () => {
    const res = await request(app)
      .put('/budgets/total')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/monthly_limit/i);
  });

  it('returns 400 when monthly_limit is negative', async () => {
    const res = await request(app)
      .put('/budgets/total')
      .send({ monthly_limit: -100 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/monthly_limit/i);
  });

  it('returns 400 when monthly_limit is zero', async () => {
    const res = await request(app)
      .put('/budgets/total')
      .send({ monthly_limit: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/monthly_limit/i);
  });

  it('returns 400 when monthly_limit is non-numeric', async () => {
    const res = await request(app)
      .put('/budgets/total')
      .send({ monthly_limit: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/monthly_limit/i);
  });
});

describe('PUT /budgets/category/:id', () => {
  it('creates/updates category budget and returns the setting row', async () => {
    const res = await request(app)
      .put(`/budgets/category/${categoryId}`)
      .send({ monthly_limit: 200 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('household_id', householdId);
    expect(res.body).toHaveProperty('category_id', categoryId);
    expect(parseFloat(res.body.monthly_limit)).toBe(200);
  });

  it('updates an existing category budget', async () => {
    // Create initial
    await request(app)
      .put(`/budgets/category/${categoryId}`)
      .send({ monthly_limit: 200 });

    // Update
    const res = await request(app)
      .put(`/budgets/category/${categoryId}`)
      .send({ monthly_limit: 300 });

    expect(res.status).toBe(200);
    expect(parseFloat(res.body.monthly_limit)).toBe(300);
  });
});

describe('DELETE /budgets/category/:id', () => {
  it('removes category budget and returns the row', async () => {
    // First create it
    await db.query(
      `INSERT INTO budget_settings (household_id, category_id, monthly_limit)
       VALUES ($1, $2, 150.00)`,
      [householdId, categoryId]
    );

    const res = await request(app).delete(`/budgets/category/${categoryId}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('category_id', categoryId);
    expect(res.body).toHaveProperty('household_id', householdId);
  });

  it('returns 404 when category budget not found', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app).delete(`/budgets/category/${fakeId}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/budget not found/i);
  });
});

describe('GET /budgets (no household)', () => {
  it('returns 403 when user has no household_id', async () => {
    // Temporarily remove household from user
    await db.query(
      `UPDATE users SET household_id = NULL WHERE auth0_id = 'auth0|test-budget-user'`
    );

    const res = await request(app).get('/budgets');

    // Restore household
    await db.query(
      `UPDATE users SET household_id = $1 WHERE auth0_id = 'auth0|test-budget-user'`,
      [householdId]
    );

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/household/i);
  });
});

describe('GET /budgets by_parent', () => {
  it('includes a by_parent array in response', async () => {
    const res = await request(app).get('/budgets');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('by_parent');
    expect(Array.isArray(res.body.by_parent)).toBe(true);
  });
});
