const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');
const ExpenseItem = require('../../src/models/expenseItem');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = 'auth0|test-insights-user';
    next();
  },
}));

let householdId;
let userId;

beforeAll(async () => {
  const hhResult = await db.query(
    `INSERT INTO households (name) VALUES ('Insights Route Test Household') RETURNING id`
  );
  householdId = hhResult.rows[0].id;

  const userResult = await db.query(
    `INSERT INTO users (provider_uid, name, email, household_id)
     VALUES ('auth0|test-insights-user', 'Insights User', 'insights@test.com', $1)
     ON CONFLICT (provider_uid) DO UPDATE SET household_id = $1
     RETURNING id`,
    [householdId]
  );
  userId = userResult.rows[0].id;
});

afterEach(async () => {
  await db.query(
    `DELETE FROM expense_items
     WHERE expense_id IN (SELECT id FROM expenses WHERE household_id = $1)`,
    [householdId]
  );
  await db.query(`DELETE FROM expenses WHERE household_id = $1`, [householdId]);
});

afterAll(async () => {
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
});
