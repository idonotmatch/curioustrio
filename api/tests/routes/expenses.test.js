const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.auth0Id = 'auth0|test-user-123';
    next();
  },
}));
jest.mock('../../src/services/nlParser');
jest.mock('../../src/services/categoryAssigner');
jest.mock('../../src/services/receiptParser', () => ({
  parseReceipt: jest.fn(),
}));

const { parseExpense } = require('../../src/services/nlParser');
const { assignCategory } = require('../../src/services/categoryAssigner');
const { parseReceipt } = require('../../src/services/receiptParser');

let householdId;

beforeEach(() => {
  parseReceipt.mockReset();
});

beforeAll(async () => {
  // Create a household and associate the test user with it
  const hhResult = await db.query(
    `INSERT INTO households (name) VALUES ('Test Household') RETURNING id`
  );
  householdId = hhResult.rows[0].id;

  await db.query(
    `INSERT INTO users (auth0_id, name, email, household_id)
     VALUES ('auth0|test-user-123', 'Test User', 'test@test.com', $1)
     ON CONFLICT (auth0_id) DO UPDATE SET household_id = $1`,
    [householdId]
  );
});

afterAll(async () => {
  // Clean up test data (do NOT call db.pool.end())
  await db.query(`DELETE FROM duplicate_flags WHERE expense_id_a IN (
    SELECT id FROM expenses WHERE household_id = $1
  )`, [householdId]);
  await db.query(`DELETE FROM expenses WHERE household_id = $1`, [householdId]);
  await db.query(`UPDATE users SET household_id = NULL WHERE auth0_id = 'auth0|test-user-123'`);
  await db.query(`DELETE FROM households WHERE id = $1`, [householdId]);
});

describe('POST /expenses/parse', () => {
  it('returns parsed expense with category suggestion', async () => {
    parseExpense.mockResolvedValueOnce({
      merchant: "Trader Joe's", amount: 84.17, date: '2026-03-20', notes: null,
    });
    assignCategory.mockResolvedValueOnce({
      category_id: 'some-cat-id', source: 'memory', confidence: 4,
    });

    const res = await request(app)
      .post('/expenses/parse')
      .send({ input: '84.17 trader joes', today: '2026-03-20' });

    expect(res.status).toBe(200);
    expect(res.body.merchant).toBe("Trader Joe's");
    expect(res.body.amount).toBe(84.17);
    expect(res.body.category_id).toBe('some-cat-id');
  });

  it('returns 422 when input cannot be parsed', async () => {
    parseExpense.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/expenses/parse')
      .send({ input: 'asdfjkl', today: '2026-03-20' });

    expect(res.status).toBe(422);
  });
});

describe('POST /expenses/confirm', () => {
  it('creates a confirmed expense and returns { expense, duplicate_flags } shape', async () => {
    const res = await request(app)
      .post('/expenses/confirm')
      .send({
        merchant: "Trader Joe's",
        amount: 84.17,
        date: '2026-03-20',
        source: 'manual',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('expense');
    expect(res.body).toHaveProperty('duplicate_flags');
    expect(res.body.expense.status).toBe('confirmed');
    expect(Array.isArray(res.body.duplicate_flags)).toBe(true);
  });

  it('creates refund expense with negative amount and source=refund', async () => {
    const res = await request(app)
      .post('/expenses/confirm')
      .set('Authorization', 'Bearer test')
      .send({
        merchant: 'Amazon',
        amount: -24.99,
        date: '2026-03-21',
        source: 'refund',
        category_id: null,
      });
    expect(res.status).toBe(201);
    expect(Number(res.body.expense.amount)).toBe(-24.99);
    expect(res.body.expense.source).toBe('refund');
  });

  it('creates duplicate_flags when exact duplicate exists in same household', async () => {
    const merchant = 'DupeMerchant';
    const amount = 42.00;
    const date = '2026-03-19';

    // Insert an existing confirmed expense directly
    const userResult = await db.query(
      `SELECT id FROM users WHERE auth0_id = 'auth0|test-user-123'`
    );
    const userId = userResult.rows[0].id;

    await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, $3, $4, $5, 'manual', 'confirmed')`,
      [userId, householdId, merchant, amount, date]
    );

    // Now confirm a duplicate
    const res = await request(app)
      .post('/expenses/confirm')
      .send({ merchant, amount, date, source: 'manual' });

    expect(res.status).toBe(201);
    expect(res.body.duplicate_flags.length).toBeGreaterThan(0);
    expect(res.body.duplicate_flags[0].confidence).toBe('exact');
  });
});

describe('GET /expenses', () => {
  it('returns expenses for the authenticated user', async () => {
    const res = await request(app).get('/expenses');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /expenses/pending', () => {
  it('returns pending expenses for the user', async () => {
    // Seed a pending expense
    const userResult = await db.query(
      `SELECT id FROM users WHERE auth0_id = 'auth0|test-user-123'`
    );
    const userId = userResult.rows[0].id;

    await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'PendingMerchant', 10.00, '2026-03-18', 'manual', 'pending')`,
      [userId, householdId]
    );

    const res = await request(app).get('/expenses/pending');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const pendingMerchant = res.body.find(e => e.merchant === 'PendingMerchant');
    expect(pendingMerchant).toBeDefined();
    expect(pendingMerchant.status).toBe('pending');
  });

  it('includes duplicate_flags array per expense', async () => {
    const res = await request(app).get('/expenses/pending');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const expense of res.body) {
      expect(expense).toHaveProperty('duplicate_flags');
      expect(Array.isArray(expense.duplicate_flags)).toBe(true);
    }
  });
});

describe('POST /expenses/:id/dismiss', () => {
  it('marks expense as dismissed', async () => {
    const userResult = await db.query(
      `SELECT id FROM users WHERE auth0_id = 'auth0|test-user-123'`
    );
    const userId = userResult.rows[0].id;

    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'ToDismiss', 5.00, '2026-03-17', 'manual', 'pending') RETURNING id`,
      [userId, householdId]
    );
    const expenseId = expResult.rows[0].id;

    const res = await request(app).post(`/expenses/${expenseId}/dismiss`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('dismissed');
    expect(res.body.id).toBe(expenseId);
  });

  it('returns 404 for non-owned expense', async () => {
    // Insert expense owned by a different user
    const otherUserResult = await db.query(
      `INSERT INTO users (auth0_id, name, email)
       VALUES ('auth0|other-user-999', 'Other User', 'other@test.com')
       ON CONFLICT (auth0_id) DO UPDATE SET name = 'Other User'
       RETURNING id`
    );
    const otherUserId = otherUserResult.rows[0].id;

    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, NULL, 'OtherDismiss', 5.00, '2026-03-17', 'manual', 'pending') RETURNING id`,
      [otherUserId]
    );
    const expenseId = expResult.rows[0].id;

    const res = await request(app).post(`/expenses/${expenseId}/dismiss`);
    expect(res.status).toBe(404);

    // Cleanup
    await db.query(`DELETE FROM expenses WHERE id = $1`, [expenseId]);
    await db.query(`DELETE FROM users WHERE auth0_id = 'auth0|other-user-999'`);
  });
});

describe('GET /expenses/:id', () => {
  it('returns expense with duplicate_flags', async () => {
    const userResult = await db.query(
      `SELECT id FROM users WHERE auth0_id = 'auth0|test-user-123'`
    );
    const userId = userResult.rows[0].id;

    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'DetailMerchant', 9.99, '2026-03-16', 'manual', 'confirmed') RETURNING id`,
      [userId, householdId]
    );
    const expenseId = expResult.rows[0].id;

    const res = await request(app).get(`/expenses/${expenseId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(expenseId);
    expect(res.body).toHaveProperty('duplicate_flags');
    expect(Array.isArray(res.body.duplicate_flags)).toBe(true);
  });

  it('returns 404 for unknown id', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app).get(`/expenses/${fakeId}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /expenses/:id', () => {
  it('updates merchant, amount, and notes', async () => {
    const userResult = await db.query(
      `SELECT id FROM users WHERE auth0_id = 'auth0|test-user-123'`
    );
    const userId = userResult.rows[0].id;

    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'OriginalMerchant', 20.00, '2026-03-15', 'manual', 'confirmed') RETURNING id`,
      [userId, householdId]
    );
    const expenseId = expResult.rows[0].id;

    const res = await request(app)
      .patch(`/expenses/${expenseId}`)
      .send({ merchant: 'UpdatedMerchant', amount: 25.00, notes: 'updated note' });

    expect(res.status).toBe(200);
    expect(res.body.merchant).toBe('UpdatedMerchant');
    expect(parseFloat(res.body.amount)).toBe(25.00);
    expect(res.body.notes).toBe('updated note');
  });

  it('returns 400 for invalid category_id UUID', async () => {
    const userResult = await db.query(
      `SELECT id FROM users WHERE auth0_id = 'auth0|test-user-123'`
    );
    const userId = userResult.rows[0].id;

    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'PatchValidate', 5.00, '2026-03-14', 'manual', 'confirmed') RETURNING id`,
      [userId, householdId]
    );
    const expenseId = expResult.rows[0].id;

    const res = await request(app)
      .patch(`/expenses/${expenseId}`)
      .send({ category_id: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uuid/i);
  });
});

describe('DELETE /expenses/:id', () => {
  it('owner can delete their expense (204)', async () => {
    const userResult = await db.query(
      `SELECT id FROM users WHERE auth0_id = 'auth0|test-user-123'`
    );
    const userId = userResult.rows[0].id;

    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'ToDelete', 15.00, '2026-03-10', 'manual', 'confirmed') RETURNING id`,
      [userId, householdId]
    );
    const expenseId = expResult.rows[0].id;

    const res = await request(app).delete(`/expenses/${expenseId}`);
    expect(res.status).toBe(204);

    // Confirm it's gone
    const check = await db.query(`SELECT id FROM expenses WHERE id = $1`, [expenseId]);
    expect(check.rows.length).toBe(0);
  });

  it('returns 404 for non-existent expense', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000001';
    const res = await request(app).delete(`/expenses/${fakeId}`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for another user's expense", async () => {
    const otherUserResult = await db.query(
      `INSERT INTO users (auth0_id, name, email)
       VALUES ('auth0|other-delete-user', 'Other Delete User', 'otherdelete@test.com')
       ON CONFLICT (auth0_id) DO UPDATE SET name = 'Other Delete User'
       RETURNING id`
    );
    const otherUserId = otherUserResult.rows[0].id;

    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, NULL, 'OtherDelete', 5.00, '2026-03-09', 'manual', 'confirmed') RETURNING id`,
      [otherUserId]
    );
    const expenseId = expResult.rows[0].id;

    const res = await request(app).delete(`/expenses/${expenseId}`);
    expect(res.status).toBe(404);

    // Cleanup
    await db.query(`DELETE FROM expenses WHERE id = $1`, [expenseId]);
    await db.query(`DELETE FROM users WHERE auth0_id = 'auth0|other-delete-user'`);
  });
});

describe('POST /expenses/scan', () => {
  it('returns parsed expense with source camera', async () => {
    parseReceipt.mockResolvedValue({
      merchant: 'Whole Foods', amount: 87.32, date: '2026-03-21', notes: null
    });
    assignCategory.mockResolvedValueOnce({
      category_id: null, source: 'default', confidence: 0,
    });
    const res = await request(app)
      .post('/expenses/scan')
      .set('Authorization', 'Bearer test')
      .send({ image_base64: 'base64data' });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('camera');
    expect(res.body.merchant).toBe('Whole Foods');
    expect(res.body.amount).toBe(87.32);
  });

  it('returns 400 when image_base64 missing', async () => {
    const res = await request(app)
      .post('/expenses/scan')
      .set('Authorization', 'Bearer test')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('image_base64 required');
  });

  it('returns 422 when receipt cannot be parsed', async () => {
    parseReceipt.mockResolvedValue(null);
    const res = await request(app)
      .post('/expenses/scan')
      .set('Authorization', 'Bearer test')
      .send({ image_base64: 'base64data' });
    expect(res.status).toBe(422);
  });
});
