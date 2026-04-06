const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');
const ExpenseItem = require('../../src/models/expenseItem');
const { currentPeriod, shiftPeriod } = require('../../src/services/spendingTrendAnalyzer');

jest.mock('../../src/services/pushService', () => ({
  sendNotifications: jest.fn().mockResolvedValue([]),
}));

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
    `CREATE TABLE IF NOT EXISTS insight_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      insight_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('shown', 'tapped', 'dismissed', 'acted', 'helpful', 'not_helpful')),
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  await db.query(
    `ALTER TABLE insight_events
     DROP CONSTRAINT IF EXISTS insight_events_event_type_check`
  );

  await db.query(
    `ALTER TABLE insight_events
     ADD CONSTRAINT insight_events_event_type_check
     CHECK (event_type IN ('shown', 'tapped', 'dismissed', 'acted', 'helpful', 'not_helpful'))`
  );

  await db.query(
    `CREATE TABLE IF NOT EXISTS insight_notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      insight_id TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'push',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, insight_id, channel)
    )`
  );

  await db.query(
    `CREATE TABLE IF NOT EXISTS insight_state (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      insight_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('seen', 'dismissed')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, insight_id)
    )`
  );

  await db.query(
    `CREATE TABLE IF NOT EXISTS product_price_observations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID REFERENCES products(id) ON DELETE SET NULL,
      comparable_key TEXT,
      merchant TEXT NOT NULL,
      observed_price NUMERIC(10,2) NOT NULL CHECK (observed_price > 0),
      observed_unit_price NUMERIC(10,4),
      normalized_total_size_value NUMERIC(10,3),
      normalized_total_size_unit TEXT,
      url TEXT,
      source_type TEXT NOT NULL,
      source_key TEXT,
      metadata JSONB,
      observed_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (product_id IS NOT NULL OR comparable_key IS NOT NULL)
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
  await db.query(`DELETE FROM push_tokens WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM insight_notifications WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM insight_events WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM insight_state WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM budget_settings WHERE user_id = $1`, [userId]);
  await db.query(
    `DELETE FROM expense_items
     WHERE expense_id IN (SELECT id FROM expenses WHERE household_id = $1)`,
    [householdId]
  );
  await db.query(`DELETE FROM expenses WHERE household_id = $1`, [householdId]);
  await db.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
});

afterAll(async () => {
  await db.query(`DELETE FROM push_tokens WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM insight_notifications WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM insight_events WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM budget_settings WHERE user_id = $1`, [userId]);
  await db.query(`UPDATE users SET household_id = NULL WHERE provider_uid = 'auth0|test-insights-user'`);
  await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await db.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
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

  it('returns recurring repurchase due insights for items entering the watch window', async () => {
    const today = new Date();
    const d1 = new Date(today); d1.setDate(d1.getDate() - 52);
    const d2 = new Date(today); d2.setDate(d2.getDate() - 34);
    const d3 = new Date(today); d3.setDate(d3.getDate() - 16);

    const e1 = await insertExpense('Target', 38.99, d1.toISOString().split('T')[0]);
    const e2 = await insertExpense('Target', 39.49, d2.toISOString().split('T')[0]);
    const e3 = await insertExpense('Target', 39.29, d3.toISOString().split('T')[0]);

    await ExpenseItem.createBulk(e1, [{ description: 'Pampers Pure Size 6', amount: 38.99, brand: 'Pampers', pack_size: '82', unit: 'count' }]);
    await ExpenseItem.createBulk(e2, [{ description: 'Pampers Pure Size 6', amount: 39.49, brand: 'Pampers', pack_size: '82', unit: 'count' }]);
    await ExpenseItem.createBulk(e3, [{ description: 'Pampers Pure Size 6', amount: 39.29, brand: 'Pampers', pack_size: '82', unit: 'count' }]);

    const res = await request(app).get('/insights?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.map((insight) => insight.type)).toContain('recurring_repurchase_due');
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
    expect(first.body.length).toBeGreaterThanOrEqual(1);

    for (const insight of first.body) {
      const dismissRes = await request(app).post(`/insights/${encodeURIComponent(insight.id)}/dismiss`);
      expect(dismissRes.status).toBe(204);
    }

    const second = await request(app).get('/insights?limit=5');
    expect(second.status).toBe(200);
    expect(second.body).toEqual([]);

    const dismissEvents = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM insight_events
       WHERE user_id = $1 AND event_type = 'dismissed'`,
      [userId]
    );
    expect(dismissEvents.rows[0].count).toBe(first.body.length);
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
       ($1, $2, 'Trader Joe''s', 120, ($3 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 70, ($3 || '-03')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 50, ($3 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 50, ($4 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 40, ($4 || '-03')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 30, ($4 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 40, ($5 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 35, ($5 || '-03')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 25, ($5 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 35, ($6 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 30, ($6 || '-03')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 25, ($6 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 260, ($7 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 220, ($7 || '-09')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 140, ($7 || '-14')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 240, ($8 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 200, ($8 || '-09')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 120, ($8 || '-14')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 230, ($9 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 190, ($9 || '-09')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 120, ($9 || '-14')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 220, ($10 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 190, ($10 || '-09')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 120, ($10 || '-14')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 220, ($11 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 180, ($11 || '-09')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 120, ($11 || '-14')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 210, ($12 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 180, ($12 || '-09')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 120, ($12 || '-14')::date, 'manual', 'confirmed')`,
      [userId, householdId, month, prior1, prior2, prior3, prior6, prior5, prior4, prior3, prior2, prior1]
    );

    const res = await request(app).get('/insights?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.map((insight) => insight.type)).toEqual(
      expect.arrayContaining(['spend_pace_behind', 'budget_too_low'])
    );
  });

  it('returns projection insights for projected over-budget, one-off skew, and category surge', async () => {
    const month = currentPeriod(1);
    const prior1 = shiftPeriod(month, -1);
    const prior2 = shiftPeriod(month, -2);
    const prior3 = shiftPeriod(month, -3);

    const groceriesCategory = await db.query(
      `INSERT INTO categories (household_id, name, icon, color)
       VALUES ($1, 'Groceries', 'cart', '#4ade80')
       RETURNING id`,
      [householdId]
    );
    const travelCategory = await db.query(
      `INSERT INTO categories (household_id, name, icon, color)
       VALUES ($1, 'Travel', 'plane', '#60a5fa')
       RETURNING id`,
      [householdId]
    );

    await db.query(
      `INSERT INTO budget_settings (user_id, category_id, monthly_limit) VALUES ($1, NULL, 250)`,
      [userId]
    );

    await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status, category_id)
       VALUES
       ($1, $2, 'Grocer', 90, ($3 || '-01')::date, 'manual', 'confirmed', $4),
       ($1, $2, 'Airline', 300, ($3 || '-02')::date, 'manual', 'confirmed', $5),
       ($1, $2, 'Grocer', 30, ($6 || '-01')::date, 'manual', 'confirmed', $4),
       ($1, $2, 'Grocer', 35, ($6 || '-04')::date, 'manual', 'confirmed', $4),
       ($1, $2, 'Cafe', 30, ($6 || '-02')::date, 'manual', 'confirmed', NULL),
       ($1, $2, 'Gas', 40, ($6 || '-03')::date, 'manual', 'confirmed', NULL),
       ($1, $2, 'Grocer', 20, ($7 || '-01')::date, 'manual', 'confirmed', $4),
       ($1, $2, 'Grocer', 25, ($7 || '-04')::date, 'manual', 'confirmed', $4),
       ($1, $2, 'Cafe', 30, ($7 || '-02')::date, 'manual', 'confirmed', NULL),
       ($1, $2, 'Gas', 50, ($7 || '-03')::date, 'manual', 'confirmed', NULL),
       ($1, $2, 'Grocer', 10, ($8 || '-01')::date, 'manual', 'confirmed', $4),
       ($1, $2, 'Grocer', 20, ($8 || '-04')::date, 'manual', 'confirmed', $4),
       ($1, $2, 'Cafe', 30, ($8 || '-02')::date, 'manual', 'confirmed', NULL),
       ($1, $2, 'Gas', 60, ($8 || '-03')::date, 'manual', 'confirmed', NULL)`,
      [
        userId,
        householdId,
        month,
        groceriesCategory.rows[0].id,
        travelCategory.rows[0].id,
        prior1,
        prior2,
        prior3,
      ]
    );

    const res = await request(app).get('/insights?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.map((insight) => insight.type)).toEqual(
      expect.arrayContaining(['projected_month_end_over_budget', 'one_off_expense_skewing_projection', 'projected_category_surge'])
    );
  });

  it('returns an under-budget projection insight with projected headroom', async () => {
    const month = currentPeriod(1);
    const prior1 = shiftPeriod(month, -1);
    const prior2 = shiftPeriod(month, -2);
    const prior3 = shiftPeriod(month, -3);

    await db.query(
      `INSERT INTO budget_settings (user_id, category_id, monthly_limit) VALUES ($1, NULL, 700)`,
      [userId]
    );

    await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES
       ($1, $2, 'Grocer', 40, ($3 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Cafe', 20, ($3 || '-02')::date, 'manual', 'confirmed'),
       ($1, $2, 'Grocer', 60, ($4 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Cafe', 40, ($4 || '-03')::date, 'manual', 'confirmed'),
       ($1, $2, 'Gas', 30, ($4 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Grocer', 55, ($5 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Cafe', 35, ($5 || '-03')::date, 'manual', 'confirmed'),
       ($1, $2, 'Gas', 25, ($5 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Grocer', 50, ($6 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Cafe', 30, ($6 || '-03')::date, 'manual', 'confirmed'),
       ($1, $2, 'Gas', 20, ($6 || '-05')::date, 'manual', 'confirmed')`,
      [userId, householdId, month, prior1, prior2, prior3]
    );

    const res = await request(app).get('/insights?limit=10');
    expect(res.status).toBe(200);
    const underBudget = res.body.find((insight) => insight.type === 'projected_month_end_under_budget');
    expect(underBudget).toBeTruthy();
    expect(underBudget.metadata.projected_headroom_amount).toBeGreaterThan(0);
  });

  it('deduplicates repeated trend cards across personal and household scopes', async () => {
    const month = currentPeriod(1);
    const prior1 = shiftPeriod(month, -1);
    const prior2 = shiftPeriod(month, -2);
    const prior3 = shiftPeriod(month, -3);

    await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES
       ($1, $2, 'Trader Joe''s', 100, ($3 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 60, ($3 || '-03')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 40, ($3 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 30, ($4 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 25, ($4 || '-03')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 25, ($4 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 35, ($5 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 30, ($5 || '-03')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 25, ($5 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 35, ($6 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 30, ($6 || '-03')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 30, ($6 || '-05')::date, 'manual', 'confirmed')`,
      [userId, householdId, month, prior1, prior2, prior3]
    );

    const res = await request(app).get('/insights?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.filter((insight) => insight.type === 'spend_pace_ahead')).toHaveLength(1);
  });

  it('uses the real historical period count in budget insight copy', async () => {
    const month = currentPeriod(1);
    const prior1 = shiftPeriod(month, -1);
    const prior2 = shiftPeriod(month, -2);
    const prior3 = shiftPeriod(month, -3);
    const prior4 = shiftPeriod(month, -4);
    const prior5 = shiftPeriod(month, -5);

    await db.query(
      `INSERT INTO budget_settings (user_id, category_id, monthly_limit) VALUES ($1, NULL, 500)`,
      [userId]
    );

    await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES
       ($1, $2, 'Trader Joe''s', 260, ($3 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 220, ($3 || '-09')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 140, ($3 || '-14')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 240, ($4 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 200, ($4 || '-09')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 120, ($4 || '-14')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 230, ($5 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 190, ($5 || '-09')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 120, ($5 || '-14')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 220, ($6 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 190, ($6 || '-09')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 120, ($6 || '-14')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 220, ($7 || '-05')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 180, ($7 || '-09')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 120, ($7 || '-14')::date, 'manual', 'confirmed')`,
      [userId, householdId, prior1, prior2, prior3, prior4, prior5]
    );

    const res = await request(app).get('/insights?limit=10');
    expect(res.status).toBe(200);
    const budgetInsight = res.body.find((insight) => insight.type === 'budget_too_low');
    expect(budgetInsight).toBeTruthy();
    expect(budgetInsight.body).toContain('last 4 periods');
  });

  it('returns explanatory driver insights for category variance and recurring cost pressure', async () => {
    const month = currentPeriod(1);
    const prior1 = shiftPeriod(month, -1);
    const prior2 = shiftPeriod(month, -2);
    const prior3 = shiftPeriod(month, -3);
    const groceriesCategory = await db.query(
      `INSERT INTO categories (household_id, name, icon, color)
       VALUES ($1, 'Groceries', 'cart', '#4ade80')
       RETURNING id`,
      [householdId]
    );
    const categoryId = groceriesCategory.rows[0].id;

    await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, category_id, source, status)
       VALUES
       ($1, $2, 'Whole Foods', 140, ($3 || '-01')::date, $4, 'manual', 'confirmed'),
       ($1, $2, 'Whole Foods', 80, ($3 || '-03')::date, $4, 'manual', 'confirmed'),
       ($1, $2, 'Whole Foods', 60, ($3 || '-05')::date, $4, 'manual', 'confirmed'),
       ($1, $2, 'Whole Foods', 40, ($5 || '-01')::date, $4, 'manual', 'confirmed'),
       ($1, $2, 'Whole Foods', 35, ($5 || '-03')::date, $4, 'manual', 'confirmed'),
       ($1, $2, 'Whole Foods', 25, ($5 || '-05')::date, $4, 'manual', 'confirmed'),
       ($1, $2, 'Whole Foods', 35, ($6 || '-01')::date, $4, 'manual', 'confirmed'),
       ($1, $2, 'Whole Foods', 30, ($6 || '-03')::date, $4, 'manual', 'confirmed'),
       ($1, $2, 'Whole Foods', 25, ($6 || '-05')::date, $4, 'manual', 'confirmed'),
       ($1, $2, 'Whole Foods', 30, ($7 || '-01')::date, $4, 'manual', 'confirmed'),
       ($1, $2, 'Whole Foods', 30, ($7 || '-03')::date, $4, 'manual', 'confirmed'),
       ($1, $2, 'Whole Foods', 20, ($7 || '-05')::date, $4, 'manual', 'confirmed')`,
      [userId, householdId, month, categoryId, prior1, prior2, prior3]
    );

    const e1 = await insertExpense('Whole Foods', 14.98, new Date(`${prior2}-14T12:00:00`).toISOString().split('T')[0]);
    const e2 = await insertExpense('Whole Foods', 15.18, new Date(`${prior1}-14T12:00:00`).toISOString().split('T')[0]);
    const e3 = await insertExpense('Whole Foods', 19.48, new Date(`${month}-14T12:00:00`).toISOString().split('T')[0]);

    await ExpenseItem.createBulk(e1, [
      { description: 'Greek Yogurt', amount: 6.99, brand: 'Fage', product_size: '32', unit: 'oz' },
      { description: 'Organic Bananas', amount: 7.99, brand: 'Whole Foods', product_size: '7', unit: 'count' },
    ]);
    await ExpenseItem.createBulk(e2, [
      { description: 'Greek Yogurt', amount: 7.09, brand: 'Fage', product_size: '32', unit: 'oz' },
      { description: 'Organic Bananas', amount: 8.09, brand: 'Whole Foods', product_size: '7', unit: 'count' },
    ]);
    await ExpenseItem.createBulk(e3, [
      { description: 'Greek Yogurt', amount: 9.49, brand: 'Fage', product_size: '32', unit: 'oz' },
      { description: 'Organic Bananas', amount: 9.99, brand: 'Whole Foods', product_size: '7', unit: 'count' },
    ]);

    const res = await request(app).get('/insights?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.map((insight) => insight.type)).toEqual(
      expect.arrayContaining(['top_category_driver', 'recurring_cost_pressure'])
    );
  });

  it('returns one-off variance insights when unusual merchants dominate the month', async () => {
    const month = currentPeriod(1);
    const prior1 = shiftPeriod(month, -1);
    const prior2 = shiftPeriod(month, -2);
    const prior3 = shiftPeriod(month, -3);

    await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES
       ($1, $2, 'Trader Joe''s', 60, ($3 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 50, ($3 || '-03')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 30, ($3 || '-06')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 50, ($4 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 40, ($4 || '-03')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 30, ($4 || '-06')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 45, ($5 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 40, ($5 || '-03')::date, 'manual', 'confirmed'),
       ($1, $2, 'Trader Joe''s', 25, ($5 || '-06')::date, 'manual', 'confirmed'),
       ($1, $2, 'Apple', 299, ($6 || '-01')::date, 'manual', 'confirmed'),
       ($1, $2, 'REI', 189, ($6 || '-03')::date, 'manual', 'confirmed')`,
      [userId, householdId, prior1, prior2, prior3, month]
    );

    const res = await request(app).get('/insights?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.map((insight) => insight.type)).toContain('one_offs_driving_variance');
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

describe('POST /insights/events', () => {
  it('records batched insight events', async () => {
    const res = await request(app)
      .post('/insights/events')
      .send({
        events: [
          { insight_id: 'demo-insight-1', event_type: 'shown' },
          { insight_id: 'demo-insight-1', event_type: 'tapped', metadata: { source: 'summary' } },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);

    const events = await db.query(
      `SELECT insight_id, event_type
       FROM insight_events
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );
    expect(events.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ insight_id: 'demo-insight-1', event_type: 'shown' }),
        expect.objectContaining({ insight_id: 'demo-insight-1', event_type: 'tapped' }),
      ])
    );
  });

  it('accepts structured feedback events for future ranking signals', async () => {
    const res = await request(app)
      .post('/insights/events')
      .send({
        events: [
          { insight_id: 'demo-insight-1', event_type: 'helpful', metadata: { surface: 'trend_detail' } },
          { insight_id: 'demo-insight-2', event_type: 'not_helpful', metadata: { surface: 'recurring_item_detail' } },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);

    const events = await db.query(
      `SELECT insight_id, event_type
       FROM insight_events
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );
    expect(events.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ insight_id: 'demo-insight-1', event_type: 'helpful' }),
        expect.objectContaining({ insight_id: 'demo-insight-2', event_type: 'not_helpful' }),
      ])
    );
  });

  it('returns 400 when events are missing', async () => {
    const res = await request(app).post('/insights/events').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /insights/dispatch-push', () => {
  it('sends push notifications for eligible unsent insight types and dedupes them', async () => {
    await db.query(
      `INSERT INTO push_tokens (user_id, token, platform)
       VALUES ($1, 'ExponentPushToken[test-insight-token]', 'ios')`,
      [userId]
    );

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

    const first = await request(app).post('/insights/dispatch-push').send();
    expect(first.status).toBe(200);
    expect(first.body.sent).toBeGreaterThan(0);

    const second = await request(app).post('/insights/dispatch-push').send();
    expect(second.status).toBe(200);
    expect(second.body.sent).toBe(0);
  });
});
