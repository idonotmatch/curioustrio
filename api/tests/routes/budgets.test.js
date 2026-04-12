const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = 'test|budget-user-solo';
    next();
  },
}));

let soloUserId;
let householdId;
let member1Id;
let categoryId;

beforeAll(async () => {
  // Solo user (no household)
  const u1 = await db.query(
    `INSERT INTO users (provider_uid, name) VALUES ('test|budget-user-solo', 'Solo User')
     ON CONFLICT (provider_uid) DO UPDATE SET name = 'Solo User' RETURNING id`
  );
  soloUserId = u1.rows[0].id;

  // Household with a member (same user for simplicity)
  const hh = await db.query(`INSERT INTO households (name) VALUES ('Budget HH') RETURNING id`);
  householdId = hh.rows[0].id;
  const u2 = await db.query(
    `INSERT INTO users (provider_uid, name, household_id)
     VALUES ('test|budget-member-1', 'Member 1', $1) RETURNING id`,
    [householdId]
  );
  member1Id = u2.rows[0].id;

  const cat = await db.query(
    `INSERT INTO categories (name, household_id) VALUES ('Groceries', $1) RETURNING id`,
    [householdId]
  );
  categoryId = cat.rows[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM budget_settings WHERE user_id IN ($1, $2)`, [soloUserId, member1Id]);
  await db.query(`DELETE FROM expenses WHERE user_id IN ($1, $2)`, [soloUserId, member1Id]);
  await db.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
  await db.query(`DELETE FROM users WHERE provider_uid IN ('test|budget-user-solo', 'test|budget-member-1')`);
  await db.query(`DELETE FROM households WHERE id = $1`, [householdId]);
});

afterEach(async () => {
  await db.query(`DELETE FROM budget_settings WHERE user_id IN ($1, $2)`, [soloUserId, member1Id]);
  await db.query(`DELETE FROM expenses WHERE user_id IN ($1, $2)`, [soloUserId, member1Id]);
});

describe('GET /budgets — solo user', () => {
  it('returns null total and empty categories when no settings', async () => {
    const res = await request(app).get('/budgets');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeNull();
    expect(res.body.categories).toEqual([]);
  });

  it('returns total budget with solo user spending', async () => {
    await db.query(
      `INSERT INTO budget_settings (user_id, category_id, monthly_limit) VALUES ($1, NULL, 500)`,
      [soloUserId]
    );
    const thisMonth = new Date().toISOString().slice(0, 7);
    await db.query(
      `INSERT INTO expenses (user_id, amount, date, source, status) VALUES ($1, 75, $2, 'manual', 'confirmed')`,
      [soloUserId, `${thisMonth}-15`]
    );

    const res = await request(app).get('/budgets');
    expect(res.status).toBe(200);
    expect(res.body.total.limit).toBe(500);
    expect(res.body.total.spent).toBe(75);
    expect(res.body.total.remaining).toBe(425);
  });

  it('excludes track-only expenses from budget totals', async () => {
    await db.query(
      `INSERT INTO budget_settings (user_id, category_id, monthly_limit) VALUES ($1, NULL, 500)`,
      [soloUserId]
    );
    const thisMonth = new Date().toISOString().slice(0, 7);
    await db.query(
      `INSERT INTO expenses (user_id, amount, date, source, status, exclude_from_budget)
       VALUES ($1, 75, $2, 'manual', 'confirmed', FALSE),
              ($1, 20, $2, 'manual', 'confirmed', TRUE)`,
      [soloUserId, `${thisMonth}-15`]
    );

    const res = await request(app).get('/budgets');
    expect(res.status).toBe(200);
    expect(res.body.total.spent).toBe(75);
    expect(res.body.total.remaining).toBe(425);
  });

  it('uses start_day override when provided', async () => {
    await db.query(
      `INSERT INTO budget_settings (user_id, category_id, monthly_limit) VALUES ($1, NULL, 500)`,
      [soloUserId]
    );
    await db.query(
      `INSERT INTO expenses (user_id, amount, date, source, status)
       VALUES ($1, 75, '2026-02-10', 'manual', 'confirmed')`,
      [soloUserId]
    );

    const res = await request(app).get('/budgets?month=2026-01&start_day=15');
    expect(res.status).toBe(200);
    expect(res.body.total.limit).toBe(500);
    expect(res.body.total.spent).toBe(75);
  });
});

describe('PUT /budgets/total', () => {
  it('saves a budget for the solo user', async () => {
    const res = await request(app).put('/budgets/total').send({ monthly_limit: 1000 });
    expect(res.status).toBe(200);
    expect(Number(res.body.monthly_limit)).toBe(1000);
  });

  it('returns 400 when monthly_limit is missing', async () => {
    const res = await request(app).put('/budgets/total').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/monthly_limit/i);
  });

  it('returns 400 when monthly_limit is negative', async () => {
    const res = await request(app).put('/budgets/total').send({ monthly_limit: -100 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when monthly_limit is zero', async () => {
    const res = await request(app).put('/budgets/total').send({ monthly_limit: 0 });
    expect(res.status).toBe(400);
  });
});

describe('PUT /budgets/category/:id', () => {
  it('creates/updates a category budget for the user', async () => {
    const res = await request(app)
      .put(`/budgets/category/${categoryId}`)
      .send({ monthly_limit: 200 });
    expect(res.status).toBe(200);
    expect(Number(res.body.monthly_limit)).toBe(200);
  });
});

describe('DELETE /budgets/category/:id', () => {
  it('deletes a category budget for the user', async () => {
    await db.query(
      `INSERT INTO budget_settings (user_id, category_id, monthly_limit) VALUES ($1, $2, 200)`,
      [soloUserId, categoryId]
    );
    const res = await request(app).delete(`/budgets/category/${categoryId}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 when budget not found', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app).delete(`/budgets/category/${fakeId}`);
    expect(res.status).toBe(404);
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
