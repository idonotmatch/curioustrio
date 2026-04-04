const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');
const ExpenseItem = require('../../src/models/expenseItem');
const { currentPeriod, shiftPeriod } = require('../../src/services/spendingTrendAnalyzer');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = 'auth0|test-insights-user';
    next();
  },
}));

let householdId;
let userId;

beforeAll(async () => {
  await db.query(
    `CREATE TABLE IF NOT EXISTS insight_state (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      insight_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('seen', 'dismissed')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, insight_id)
    )`
  );

  const hhResult = await db.query(
    `INSERT INTO households (name) VALUES ('Insights Route Test Household') RETURNING id`
  );
  householdId = hhResult.rows[0].id;

  const userResult = await db.query(
    `INSERT INTO users (provider_uid, name, email, household_id, budget_start_day)
     VALUES ('auth0|test-insights-user', 'Insights User', 'insights@test.com', $1, 1)
     ON CONFLICT (provider_uid) DO UPDATE SET household_id = $1, budget_start_day = 1
     RETURNING id`,
    [householdId]
  );
  userId = userResult.rows[0].id;
});

afterEach(async () => {
  await db.query(`DELETE FROM insight_state WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM budget_settings WHERE user_id = $1`, [userId]);
  await db.query(
    `DELETE FROM expense_items
     WHERE expense_id IN (SELECT id FROM expenses WHERE household_id = $1)`,
    [householdId]
  );
  await db.query(`DELETE FROM expenses WHERE household_id = $1`, [householdId]);
});

afterAll(async () => {
  await db.query(`DELETE FROM budget_settings WHERE user_id = $1`, [userId]);
  await db.query(`UPDATE users SET household_id = NULL WHERE provider_uid = 'auth0|test-insights-user'`);
  await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await db.query(`DELETE FROM households WHERE id = $1`, [householdId]);
});

async function insertExpense(merchant, amount, date) {
  const result = await db.query(
    `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
     VALUES ($1, $2, $3, $4, $5, 'manual', 'confirmed')
     RETURNING id`,
    [userId, householdId, merchant, amount, date]
  );
  return result.rows[0].id;
}

describe('GET /insights', () => {
  it('returns recurring item price insights', async () => {
    const today = new Date();
    const d1 = new Date(today); d1.setDate(d1.getDate() - 42);
    const d2 = new Date(today); d2.setDate(d2.getDate() - 28);
    const d3 = new Date(today); d3.setDate(d3.getDate() - 14);

    const e1 = await insertExpense('Whole Foods', 6.99, d1.toISOString().split('T')[0]);
    const e2 = await insertExpense('Whole Foods', 7.09, d2.toISOString().split('T')[0]);
    const e3 = await insertExpense('Whole Foods', 9.49, d3.toISOString().split('T')[0]);

    await ExpenseItem.createBulk(e1, [{ description: 'Greek Yogurt', amount: 6.99, brand: 'Fage', product_size: '32', unit: 'oz' }]);
    await ExpenseItem.createBulk(e2, [{ description: 'Greek Yogurt', amount: 7.09, brand: 'Fage', product_size: '32', unit: 'oz' }]);
    await ExpenseItem.createBulk(e3, [{ description: 'Greek Yogurt', amount: 9.49, brand: 'Fage', product_size: '32', unit: 'oz' }]);

    const res = await request(app).get('/insights?limit=5');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({
      type: 'recurring_price_spike',
      entity_type: 'item',
      title: 'Greek Yogurt cost more than usual',
    });
  });

  it('hides dismissed insights for the user', async () => {
    const today = new Date();
    const d1 = new Date(today); d1.setDate(d1.getDate() - 42);
    const d2 = new Date(today); d2.setDate(d2.getDate() - 28);
    const d3 = new Date(today); d3.setDate(d3.getDate() - 14);

    const e1 = await insertExpense('Whole Foods', 6.99, d1.toISOString().split('T')[0]);
    const e2 = await insertExpense('Whole Foods', 7.09, d2.toISOString().split('T')[0]);
    const e3 = await insertExpense('Whole Foods', 9.49, d3.toISOString().split('T')[0]);

    await ExpenseItem.createBulk(e1, [{ description: 'Greek Yogurt', amount: 6.99, brand: 'Fage', product_size: '32', unit: 'oz' }]);
    await ExpenseItem.createBulk(e2, [{ description: 'Greek Yogurt', amount: 7.09, brand: 'Fage', product_size: '32', unit: 'oz' }]);
    await ExpenseItem.createBulk(e3, [{ description: 'Greek Yogurt', amount: 9.49, brand: 'Fage', product_size: '32', unit: 'oz' }]);

    const first = await request(app).get('/insights?limit=5');
    expect(first.status).toBe(200);
    expect(first.body).toHaveLength(1);

    const dismissRes = await request(app).post(`/insights/${encodeURIComponent(first.body[0].id)}/dismiss`);
    expect(dismissRes.status).toBe(204);

    const second = await request(app).get('/insights?limit=5');
    expect(second.status).toBe(200);
    expect(second.body).toEqual([]);
  });

  it('returns pace and budget-fit trend insights', async () => {
    const month = currentPeriod(1);
    const prior1 = shiftPeriod(month, -1);
    const prior2 = shiftPeriod(month, -2);
    const prior3 = shiftPeriod(month, -3);
    const prior4 = shiftPeriod(month, -4);
    const prior5 = shiftPeriod(month, -5);
    const prior6 = shiftPeriod(month, -6);

    await db.query(
      `INSERT INTO budget_settings (user_id, category_id, monthly_limit) VALUES ($1, NULL, 500)`,
      [userId]
    );

    await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES
       ($1, $2, 'Trader Joe''s', 240, ($3 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 120, ($4 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 100, ($5 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 90, ($6 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 620, ($7 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 560, ($8 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 540, ($9 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 530, ($10 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 520, ($11 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 510, ($12 || '-05')::date, 'manual', 'confirmed')`,
      [userId, householdId, month, prior1, prior2, prior3, prior6, prior5, prior4, prior3, prior2, prior1]
    );

    const res = await request(app).get('/insights?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.map((insight) => insight.type)).toEqual(
      expect.arrayContaining(['spend_pace_ahead', 'budget_too_low'])
    );
  });

  it('does not emit trend insights when there is not enough historical data yet', async () => {
    const month = currentPeriod(1);

    await db.query(
      `INSERT INTO budget_settings (user_id, category_id, monthly_limit) VALUES ($1, NULL, 500)`,
      [userId]
    );
    await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'Corner Store', 85, ($3 || '-01')::date, 'manual', 'confirmed')`,
      [userId, householdId, month]
    );

    const res = await request(app).get('/insights?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.map((insight) => insight.type)).not.toEqual(
      expect.arrayContaining(['spend_pace_ahead', 'spend_pace_behind', 'budget_too_low', 'budget_too_high'])
    );
  });
});

describe('POST /insights/seen', () => {
  it('marks insight ids as seen', async () => {
    const res = await request(app)
      .post('/insights/seen')
      .send({ ids: ['demo-insight-1'] });

    expect(res.status).toBe(204);

    const state = await db.query(
      `SELECT status FROM insight_state WHERE user_id = $1 AND insight_id = 'demo-insight-1'`,
      [userId]
    );
    expect(state.rows[0].status).toBe('seen');
  });

  it('returns 400 without ids', async () => {
    const res = await request(app).post('/insights/seen').send({});
    expect(res.status).toBe(400);
  });
});
