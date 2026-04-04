const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = 'auth0|test-recurring-user';
    next();
  },
}));

let householdId;
let categoryId;
let userId;

beforeAll(async () => {
  await db.query(
    `CREATE TABLE IF NOT EXISTS recurring_preferences (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      household_id UUID REFERENCES households(id) ON DELETE CASCADE,
      expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      product_id UUID REFERENCES products(id) ON DELETE SET NULL,
      comparable_key TEXT,
      merchant TEXT,
      item_name TEXT,
      brand TEXT,
      expected_frequency_days INTEGER CHECK (expected_frequency_days IS NULL OR expected_frequency_days > 0),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, expense_id)
    )`
  );

  const hhResult = await db.query(
    `INSERT INTO households (name) VALUES ('Recurring Route Test Household') RETURNING id`
  );
  householdId = hhResult.rows[0].id;

  const catResult = await db.query(
    `INSERT INTO categories (name, household_id) VALUES ('Test Category', $1) RETURNING id`,
    [householdId]
  );
  categoryId = catResult.rows[0].id;

  const userResult = await db.query(
    `INSERT INTO users (provider_uid, name, email, household_id)
     VALUES ('auth0|test-recurring-user', 'Recurring User', 'recurring@test.com', $1)
     ON CONFLICT (provider_uid) DO UPDATE SET household_id = $1
     RETURNING id`,
    [householdId]
  );
  userId = userResult.rows[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM recurring_preferences WHERE household_id = $1`, [householdId]);
  await db.query(`DELETE FROM recurring_expenses WHERE household_id = $1`, [householdId]);
  await db.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
  await db.query(`UPDATE users SET household_id = NULL WHERE provider_uid = 'auth0|test-recurring-user'`);
  await db.query(`DELETE FROM households WHERE id = $1`, [householdId]);
});

afterEach(async () => {
  await db.query(`DELETE FROM recurring_preferences WHERE household_id = $1`, [householdId]);
  await db.query(`DELETE FROM recurring_expenses WHERE household_id = $1`, [householdId]);
  await db.query(
    `DELETE FROM expense_items
     WHERE expense_id IN (SELECT id FROM expenses WHERE household_id = $1)`,
    [householdId]
  );
  await db.query(
    `DELETE FROM expense_items
     WHERE product_id IN (SELECT id FROM products WHERE merchant = 'Target' OR name = 'Pampers Pure')`
  );
  await db.query(`DELETE FROM expenses WHERE household_id = $1`, [householdId]);
  await db.query(`DELETE FROM products WHERE merchant = 'Target' OR name = 'Pampers Pure'`);
});

describe('GET /recurring', () => {
  it('returns [] when no recurring expenses', async () => {
    const res = await request(app).get('/recurring');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /recurring', () => {
  it('creates a recurring expense (201)', async () => {
    const res = await request(app)
      .post('/recurring')
      .send({
        merchant: 'Netflix',
        expected_amount: 15.99,
        category_id: categoryId,
        frequency: 'monthly',
        next_expected_date: '2026-04-01',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.merchant).toBe('Netflix');
    expect(parseFloat(res.body.expected_amount)).toBe(15.99);
    expect(res.body.frequency).toBe('monthly');
    expect(res.body.household_id).toBe(householdId);
  });

  it('returns 400 on missing fields', async () => {
    const res = await request(app)
      .post('/recurring')
      .send({ merchant: 'Netflix' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });
});

describe('DELETE /recurring/:id', () => {
  it('removes and returns the deleted row', async () => {
    // Create one first
    const createRes = await request(app)
      .post('/recurring')
      .send({
        merchant: 'Hulu',
        expected_amount: 12.99,
        category_id: categoryId,
        frequency: 'monthly',
        next_expected_date: '2026-04-15',
      });

    const id = createRes.body.id;

    const res = await request(app).delete(`/recurring/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.merchant).toBe('Hulu');
  });

  it('returns 404 when not found', async () => {
    const res = await request(app).delete('/recurring/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

describe('POST /recurring/detect', () => {
  it('returns array (may be empty)', async () => {
    const res = await request(app).post('/recurring/detect');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /recurring/detect-items', () => {
  it('returns array (may be empty)', async () => {
    const res = await request(app).post('/recurring/detect-items');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /recurring/detect-item-signals', () => {
  it('returns array (may be empty)', async () => {
    const res = await request(app).post('/recurring/detect-item-signals');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /recurring/item-history', () => {
  it('returns a recurring item purchase history by group key', async () => {
    const dates = [42, 28, 14].map((daysAgo) => {
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      return date.toISOString().split('T')[0];
    });

    const expenseIds = [];
    for (const [index, date] of dates.entries()) {
      const result = await db.query(
        `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
         VALUES ($1, $2, $3, $4, $5, 'manual', 'confirmed')
         RETURNING id`,
        [userId, householdId, index === 1 ? 'Trader Joes' : 'Whole Foods', 6.99 + (index * 0.1), date]
      );
      expenseIds.push(result.rows[0].id);
    }

    for (const [index, expenseId] of expenseIds.entries()) {
      await db.query(
        `INSERT INTO expense_items (
          expense_id, description, amount, brand, product_size, unit,
          normalized_name, normalized_brand, normalized_size_value, normalized_size_unit,
          normalized_total_size_value, normalized_total_size_unit, comparable_key
        ) VALUES ($1, 'Greek Yogurt', $2, 'Fage', '32', 'oz', 'greek yogurt', 'fage', 32, 'oz', 32, 'oz', 'fage|greek yogurt|32|oz|1')`,
        [expenseId, 6.99 + (index * 0.1)]
      );
    }

    const detectRes = await request(app).post('/recurring/detect-items');
    expect(detectRes.status).toBe(200);
    expect(detectRes.body).toHaveLength(1);

    const historyRes = await request(app)
      .get('/recurring/item-history')
      .query({ group_key: detectRes.body[0].group_key });

    expect(historyRes.status).toBe(200);
    expect(historyRes.body).toMatchObject({
      kind: 'item_history',
      item_name: 'Greek Yogurt',
      occurrence_count: 3,
    });
    expect(historyRes.body.purchases).toHaveLength(3);
  });

  it('returns 400 when group_key is missing', async () => {
    const res = await request(app).get('/recurring/item-history');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/group_key/i);
  });
});

describe('GET /recurring/watch-candidates', () => {
  it('returns recurring product candidates within the watch window', async () => {
    const product = await db.query(
      `INSERT INTO products (name, brand, merchant, product_size, pack_size, unit)
       VALUES ('Pampers Pure', 'Pampers', 'Target', '82', '1', 'count')
       RETURNING id`
    );

    const dates = [50, 32, 14].map((daysAgo) => {
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      return date.toISOString().split('T')[0];
    });

    const expenseIds = [];
    for (const date of dates) {
      const result = await db.query(
        `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
         VALUES ($1, $2, 'Target', 39.23, $3, 'manual', 'confirmed')
         RETURNING id`,
        [userId, householdId, date]
      );
      expenseIds.push(result.rows[0].id);
    }

    for (const expenseId of expenseIds) {
      await db.query(
        `INSERT INTO expense_items (expense_id, description, amount, brand, product_size, unit, product_id)
         VALUES ($1, 'Pampers Pure', 39.23, 'Pampers', '82', 'count', $2)`,
        [expenseId, product.rows[0].id]
      );
    }

    const res = await request(app).get('/recurring/watch-candidates');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      kind: 'watch_candidate',
      item_name: 'Pampers Pure',
      brand: 'Pampers',
      status: 'watching',
    });
  });
});

describe('Recurring preferences', () => {
  it('creates, loads, and removes a manual recurring preference for an expense', async () => {
    const expense = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'Costco', 42.50, CURRENT_DATE, 'manual', 'confirmed')
       RETURNING id`,
      [userId, householdId]
    );

    await db.query(
      `INSERT INTO expense_items (expense_id, description, amount, brand, comparable_key)
       VALUES ($1, 'Paper Towels', 42.50, 'Bounty', 'paper towels|brand:bounty')`,
      [expense.rows[0].id]
    );

    const createRes = await request(app)
      .post('/recurring/preferences')
      .send({
        expense_id: expense.rows[0].id,
        expected_frequency_days: 21,
        notes: 'Usually buy when we are down to one pack',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.expected_frequency_days).toBe(21);

    const getRes = await request(app)
      .get('/recurring/preferences')
      .query({ expense_id: expense.rows[0].id });

    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      expense_id: expense.rows[0].id,
      comparable_key: 'paper towels|brand:bounty',
      expected_frequency_days: 21,
    });

    const deleteRes = await request(app).delete(`/recurring/preferences/${createRes.body.id}`);
    expect(deleteRes.status).toBe(204);
  });

  it('uses a manual recurring preference to create a watch candidate without long history', async () => {
    const expenseDate = new Date();
    expenseDate.setDate(expenseDate.getDate() - 10);
    const expense = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'Target', 39.23, $3, 'manual', 'confirmed')
       RETURNING id`,
      [userId, householdId, expenseDate.toISOString().split('T')[0]]
    );
    const product = await db.query(
      `INSERT INTO products (name, brand, merchant, product_size, pack_size, unit)
       VALUES ('Pampers Pure', 'Pampers', 'Target', '82', '1', 'count')
       RETURNING id`
    );
    await db.query(
      `INSERT INTO expense_items (expense_id, description, amount, brand, product_size, unit, product_id)
       VALUES ($1, 'Pampers Pure', 39.23, 'Pampers', '82', 'count', $2)`,
      [expense.rows[0].id, product.rows[0].id]
    );

    const prefRes = await request(app)
      .post('/recurring/preferences')
      .send({
        expense_id: expense.rows[0].id,
        expected_frequency_days: 14,
      });

    expect(prefRes.status).toBe(201);

    const watchRes = await request(app).get('/recurring/watch-candidates');
    expect(watchRes.status).toBe(200);
    expect(watchRes.body[0]).toMatchObject({
      item_name: 'Pampers Pure',
      source: 'manual',
      average_gap_days: 14,
    });
  });
});

describe('GET /recurring (no household)', () => {
  it('returns 403 when user has no household_id', async () => {
    await db.query(
      `UPDATE users SET household_id = NULL WHERE provider_uid = 'auth0|test-recurring-user'`
    );

    const res = await request(app).get('/recurring');

    await db.query(
      `UPDATE users SET household_id = $1 WHERE provider_uid = 'auth0|test-recurring-user'`,
      [householdId]
    );

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/household/i);
  });
});
