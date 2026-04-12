const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = 'auth0|test-user-123';
    next();
  },
}));
jest.mock('../../src/services/nlParser');
jest.mock('../../src/services/categoryAssigner');
jest.mock('../../src/services/receiptParser', () => ({
  parseReceiptDetailed: jest.fn(),
}));
jest.mock('../../src/services/mapkitService', () => ({
  searchPlace: jest.fn(),
}));

const { parseExpenseDetailed } = require('../../src/services/nlParser');
const { assignCategory } = require('../../src/services/categoryAssigner');
const { parseReceiptDetailed } = require('../../src/services/receiptParser');
const { searchPlace } = require('../../src/services/mapkitService');
const DuplicateFlag = require('../../src/models/duplicateFlag');
const EmailImportLog = require('../../src/models/emailImportLog');

let householdId;
let userId;

beforeEach(() => {
  parseReceiptDetailed.mockReset();
  parseExpenseDetailed.mockReset();
  assignCategory.mockReset();
  searchPlace.mockReset();
  searchPlace.mockResolvedValue(null);
});

beforeAll(async () => {
  await db.query(
    `CREATE TABLE IF NOT EXISTS email_import_feedback (
       expense_id UUID PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE,
       review_action TEXT CHECK (review_action IN ('approved', 'dismissed', 'edited')),
       review_changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
       review_edit_count INT NOT NULL DEFAULT 0,
       reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS ingest_attempt_log (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id UUID REFERENCES users(id) ON DELETE CASCADE,
       source TEXT NOT NULL,
       status TEXT NOT NULL,
       failure_reason TEXT,
       input_preview TEXT,
       parse_status TEXT,
       review_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
       metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );

  // Create a household and associate the test user with it
  const hhResult = await db.query(
    `INSERT INTO households (name) VALUES ('Test Household') RETURNING id`
  );
  householdId = hhResult.rows[0].id;

  await db.query(
    `INSERT INTO users (provider_uid, name, email, household_id)
     VALUES ('auth0|test-user-123', 'Test User', 'test@test.com', $1)
     ON CONFLICT (provider_uid) DO UPDATE SET household_id = $1`,
    [householdId]
  );

  const userRow = await db.query(
    `SELECT id FROM users WHERE provider_uid = 'auth0|test-user-123'`
  );
  userId = userRow.rows[0].id;
});

afterAll(async () => {
  // Clean up test data (do NOT call db.pool.end())
  await db.query(
    `DELETE FROM email_import_feedback
     WHERE expense_id IN (SELECT id FROM expenses WHERE household_id = $1)`,
    [householdId]
  );
  await db.query(`DELETE FROM ingest_attempt_log WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM email_import_log WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM duplicate_flags WHERE expense_id_a IN (
    SELECT id FROM expenses WHERE household_id = $1
  )`, [householdId]);
  await db.query(`DELETE FROM expenses WHERE household_id = $1`, [householdId]);
  await db.query(`UPDATE users SET household_id = NULL WHERE provider_uid = 'auth0|test-user-123'`);
  await db.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
  await db.query(`DELETE FROM households WHERE id = $1`, [householdId]);
});

describe('POST /expenses/parse', () => {
  it('returns parsed expense with category suggestion', async () => {
    parseExpenseDetailed.mockResolvedValueOnce({ parsed: {
      merchant: "Trader Joe's",
      amount: 84.17,
      date: '2026-03-20',
      notes: null,
      parse_status: 'partial',
      review_fields: ['items'],
      field_confidence: { merchant: 'high', amount: 'high', date: 'high', items: 'low' },
    }});
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
    expect(res.body.parse_status).toBe('partial');
  });

  it('returns partial parse data when amount and description are usable', async () => {
    parseExpenseDetailed.mockResolvedValueOnce({ parsed: {
      merchant: null,
      description: 'coffee',
      amount: 5,
      date: '2026-03-20',
      notes: null,
      parse_status: 'partial',
      review_fields: ['items'],
      field_confidence: { merchant: 'medium', description: 'high', amount: 'high', date: 'high', items: 'low' },
    }});
    assignCategory.mockResolvedValueOnce({
      category_id: null, source: 'claude', confidence: 0,
    });

    const res = await request(app)
      .post('/expenses/parse')
      .send({ input: 'coffee 5', today: '2026-03-20' });

    expect(res.status).toBe(200);
    expect(res.body.parse_status).toBe('partial');
    expect(res.body.description).toBe('coffee');
    expect(res.body.review_fields).toContain('items');
  });

  it('passes through person-payment counterparty metadata in parse responses', async () => {
    parseExpenseDetailed.mockResolvedValueOnce({ parsed: {
      merchant: 'Heather',
      description: 'kids',
      amount: 112,
      date: '2026-04-10',
      notes: 'payment to Heather for kids',
      counterparty_type: 'person',
      merchant_source: 'person_payment_promotion',
      parse_status: 'complete',
      review_fields: [],
      field_confidence: {
        merchant: 'high',
        description: 'high',
        amount: 'high',
        date: 'high',
      },
    }});
    assignCategory.mockResolvedValueOnce({
      category_id: null, source: 'heuristic', confidence: 2,
    });

    const res = await request(app)
      .post('/expenses/parse')
      .send({ input: 'payment to Heather for kids 112', today: '2026-04-10' });

    expect(res.status).toBe(200);
    expect(res.body.merchant).toBe('Heather');
    expect(res.body.counterparty_type).toBe('person');
    expect(res.body.merchant_source).toBe('person_payment_promotion');
  });

  it('returns 422 when input cannot be parsed', async () => {
    parseExpenseDetailed.mockResolvedValueOnce({ parsed: null, failureReason: 'missing_amount' });

    const res = await request(app)
      .post('/expenses/parse')
      .send({ input: 'asdfjkl', today: '2026-03-20' });

    expect(res.status).toBe(422);
    expect(res.body.reason_code).toBe('missing_amount');
    expect(Array.isArray(res.body.suggested_actions)).toBe(true);
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

  it('persists items when items payload is provided', async () => {
    const res = await request(app)
      .post('/expenses/confirm')
      .send({
        merchant: 'ItemMerchant',
        amount: 30.00,
        date: '2026-03-20',
        source: 'manual',
        items: [
          { description: 'Widget A', amount: 10.00, sku: 'WIDGET-A', brand: 'Widgets Inc', product_size: '12', unit: 'oz' },
          { description: 'Widget B', amount: 20.00, upc: '123456789012' },
        ],
      });

    expect(res.status).toBe(201);
    const expenseId = res.body.expense.id;

    // Verify items are persisted via GET /:id
    const getRes = await request(app).get(`/expenses/${expenseId}`);
    expect(getRes.status).toBe(200);
    expect(Array.isArray(getRes.body.items)).toBe(true);
    expect(getRes.body.items.length).toBe(2);
    const descriptions = getRes.body.items.map(i => i.description);
    expect(descriptions).toContain('Widget A');
    expect(descriptions).toContain('Widget B');
    const widgetA = getRes.body.items.find(i => i.description === 'Widget A');
    expect(widgetA.sku).toBe('WIDGET-A');
    expect(widgetA.brand).toBe('Widgets Inc');
    expect(widgetA.product_size).toBe('12');
    expect(widgetA.unit).toBe('oz');
  });

  it('persists place_name and address when location data is provided', async () => {
    const res = await request(app)
      .post('/expenses/confirm')
      .send({
        merchant: 'Trader Joe\'s',
        amount: 42.00,
        date: '2026-03-20',
        source: 'manual',
        place_name: 'Trader Joe\'s',
        address: '123 Main St, SF, CA',
        mapkit_stable_id: '37.7749,-122.4194',
      });

    expect(res.status).toBe(201);
    expect(res.body.expense.place_name).toBe("Trader Joe's");
    expect(res.body.expense.address).toBe('123 Main St, SF, CA');
    expect(res.body.expense.mapkit_stable_id).toBe('37.7749,-122.4194');
  });

  it('returns 400 when an item has an empty description', async () => {
    const res = await request(app)
      .post('/expenses/confirm')
      .send({
        merchant: 'BadItemMerchant',
        amount: 10.00,
        date: '2026-03-20',
        source: 'manual',
        items: [
          { description: '', amount: 10.00 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('creates duplicate_flags when exact duplicate exists in same household', async () => {
    const merchant = 'DupeMerchant';
    const amount = 42.00;
    const date = '2026-03-19';

    // Insert an existing confirmed expense directly
    const userResult = await db.query(
      `SELECT id FROM users WHERE provider_uid = 'auth0|test-user-123'`
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

describe('POST /expenses/scan', () => {
  it('returns receipt-derived location fields when a store address is available', async () => {
    parseReceiptDetailed.mockResolvedValueOnce({ parsed: {
      merchant: 'Trader Joe\'s',
      amount: 28.5,
      date: '2026-03-21',
      notes: null,
      store_address: '123 Main St, Brooklyn, NY 11201',
      store_number: '104',
      parse_status: 'partial',
      review_fields: ['items'],
      field_confidence: { merchant: 'high', amount: 'high', date: 'high', items: 'low' },
    }});
    assignCategory.mockResolvedValueOnce({
      category_id: null, source: 'claude', confidence: 0,
    });
    searchPlace.mockResolvedValueOnce({
      place_name: 'Trader Joe\'s',
      address: '123 Main St, Brooklyn, NY 11201',
      mapkit_stable_id: '40.0000,-73.0000',
    });

    const res = await request(app)
      .post('/expenses/scan')
      .send({ image_base64: 'fakebase64data', today: '2026-03-21' });

    expect(res.status).toBe(200);
    expect(res.body.place_name).toBe('Trader Joe\'s');
    expect(res.body.address).toBe('123 Main St, Brooklyn, NY 11201');
    expect(res.body.mapkit_stable_id).toBe('40.0000,-73.0000');
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
      `SELECT id FROM users WHERE provider_uid = 'auth0|test-user-123'`
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

  it('includes gmail_review_hint for email-sourced pending imports', async () => {
    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status, notes)
       VALUES ($1, $2, 'Hint Merchant', 10.00, '2026-03-18', 'email', 'pending', 'Imported from Gmail — needs review')
       RETURNING id`,
      [userId, householdId]
    );
    await db.query(
      `INSERT INTO email_import_log (user_id, message_id, expense_id, status, subject, from_address)
       VALUES ($1, 'hint-msg', $2, 'imported', 'Order Confirmation', 'orders@amazon.com')`,
      [userId, expResult.rows[0].id]
    );

    const historicalOne = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'Amazon', 12.00, '2026-03-01', 'email', 'confirmed')
       RETURNING id`,
      [userId, householdId]
    );
    const historicalTwo = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'Amazon', 18.00, '2026-03-02', 'email', 'confirmed')
       RETURNING id`,
      [userId, householdId]
    );
    const historicalThree = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'Amazon', 22.00, '2026-03-03', 'email', 'confirmed')
       RETURNING id`,
      [userId, householdId]
    );
    await db.query(
      `INSERT INTO email_import_log (user_id, message_id, expense_id, status, from_address)
       VALUES
         ($1, 'hint-h1', $2, 'imported', 'orders@amazon.com'),
         ($1, 'hint-h2', $3, 'imported', 'orders@amazon.com'),
         ($1, 'hint-h3', $4, 'imported', 'orders@amazon.com')`,
      [userId, historicalOne.rows[0].id, historicalTwo.rows[0].id, historicalThree.rows[0].id]
    );
    await db.query(
      `INSERT INTO email_import_feedback (expense_id, review_action, review_changed_fields, review_edit_count)
       VALUES
         ($1, 'approved', '[]'::jsonb, 0),
         ($2, 'approved', '[]'::jsonb, 0),
         ($3, 'approved', '["merchant","items_fee_rows_removed"]'::jsonb, 1)`,
      [historicalOne.rows[0].id, historicalTwo.rows[0].id, historicalThree.rows[0].id]
    );

    const res = await request(app).get('/expenses/pending');
    expect(res.status).toBe(200);
    const hinted = res.body.find((expense) => expense.id === expResult.rows[0].id);
    expect(hinted.gmail_review_hint).toMatchObject({
      sender_domain: 'amazon.com',
      sender_quality_level: 'trusted',
      headline: 'Trusted sender',
      item_reliability_level: 'unknown',
      review_mode: 'full_review',
    });
    expect(Array.isArray(hinted.gmail_review_hint.likely_changed_fields)).toBe(true);
  });

  it('still returns pending expenses when duplicate flag lookup fails', async () => {
    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'Duplicate Failure Merchant', 13.00, '2026-03-18', 'manual', 'pending')
       RETURNING id`,
      [userId, householdId]
    );

    const duplicateSpy = jest
      .spyOn(DuplicateFlag, 'findByExpenseId')
      .mockRejectedValue(new Error('duplicate lookup exploded'));

    try {
      const res = await request(app).get('/expenses/pending');
      expect(res.status).toBe(200);
      const pendingExpense = res.body.find((expense) => expense.id === expResult.rows[0].id);
      expect(pendingExpense).toBeDefined();
      expect(pendingExpense.duplicate_flags).toEqual([]);
    } finally {
      duplicateSpy.mockRestore();
    }
  });

  it('still returns pending email expenses when Gmail hint enrichment fails', async () => {
    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status, review_source)
       VALUES ($1, $2, 'Hint Failure Merchant', 14.00, '2026-03-18', 'email', 'pending', 'gmail')
       RETURNING id`,
      [userId, householdId]
    );

    const emailLogSpy = jest
      .spyOn(EmailImportLog, 'findByExpenseId')
      .mockRejectedValue(new Error('gmail hint exploded'));

    try {
      const res = await request(app).get('/expenses/pending');
      expect(res.status).toBe(200);
      const pendingExpense = res.body.find((expense) => expense.id === expResult.rows[0].id);
      expect(pendingExpense).toBeDefined();
      expect(pendingExpense.gmail_review_hint).toBeNull();
    } finally {
      emailLogSpy.mockRestore();
    }
  });
});

describe('POST /expenses/:id/dismiss', () => {
  it('marks expense as dismissed', async () => {
    const userResult = await db.query(
      `SELECT id FROM users WHERE provider_uid = 'auth0|test-user-123'`
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

  it('records Gmail import dismissal feedback for email-sourced pending expenses', async () => {
    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'EmailDismiss', 7.00, '2026-03-17', 'email', 'pending') RETURNING id`,
      [userId, householdId]
    );
    const expenseId = expResult.rows[0].id;
    await db.query(
      `INSERT INTO email_import_log (user_id, message_id, expense_id, status)
       VALUES ($1, 'dismiss-feedback-msg', $2, 'imported')`,
      [userId, expenseId]
    );

    const res = await request(app).post(`/expenses/${expenseId}/dismiss`);
    expect(res.status).toBe(200);

    const log = await db.query(
      `SELECT review_action, reviewed_at
       FROM email_import_feedback
       WHERE expense_id = $1`,
      [expenseId]
    );
    expect(log.rows[0].review_action).toBe('dismissed');
    expect(log.rows[0].reviewed_at).toBeTruthy();
  });

  it('returns 404 for non-owned expense', async () => {
    // Insert expense owned by a different user
    const otherUserResult = await db.query(
      `INSERT INTO users (provider_uid, name, email)
       VALUES ('auth0|other-user-999', 'Other User', 'other@test.com')
       ON CONFLICT (provider_uid) DO UPDATE SET name = 'Other User'
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
    await db.query(`DELETE FROM users WHERE provider_uid = 'auth0|other-user-999'`);
  });
});

describe('GET /expenses/:id', () => {
  it('returns expense with duplicate_flags', async () => {
    const userResult = await db.query(
      `SELECT id FROM users WHERE provider_uid = 'auth0|test-user-123'`
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

  it('response includes an items array', async () => {
    const userResult = await db.query(
      `SELECT id FROM users WHERE provider_uid = 'auth0|test-user-123'`
    );
    const userId = userResult.rows[0].id;

    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'ItemsArrayMerchant', 5.00, '2026-03-15', 'manual', 'confirmed') RETURNING id`,
      [userId, householdId]
    );
    const expenseId = expResult.rows[0].id;

    const res = await request(app).get(`/expenses/${expenseId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('includes gmail_review_hint for email imports', async () => {
    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status, notes)
       VALUES ($1, $2, 'Detail Hint', 9.99, '2026-03-16', 'email', 'pending', 'Imported from Gmail — needs review')
       RETURNING id`,
      [userId, householdId]
    );
    await db.query(
      `INSERT INTO email_import_log (user_id, message_id, expense_id, status, subject, from_address)
       VALUES ($1, 'detail-hint-msg', $2, 'imported', 'Order Confirmation', 'alerts@messy.com')`,
      [userId, expResult.rows[0].id]
    );

    const noisyOne = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'Messy Shop', 11.00, '2026-03-01', 'email', 'dismissed')
       RETURNING id`,
      [userId, householdId]
    );
    const noisyTwo = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'Messy Shop', 17.00, '2026-03-02', 'email', 'confirmed')
       RETURNING id`,
      [userId, householdId]
    );
    const noisyThree = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'Messy Shop', 21.00, '2026-03-03', 'email', 'confirmed')
       RETURNING id`,
      [userId, householdId]
    );
    await db.query(
      `INSERT INTO email_import_log (user_id, message_id, expense_id, status, from_address)
       VALUES
         ($1, 'detail-h1', $2, 'imported', 'alerts@messy.com'),
         ($1, 'detail-h2', $3, 'imported', 'alerts@messy.com'),
         ($1, 'detail-h3', $4, 'imported', 'alerts@messy.com')`,
      [userId, noisyOne.rows[0].id, noisyTwo.rows[0].id, noisyThree.rows[0].id]
    );
    await db.query(
      `INSERT INTO email_import_feedback (expense_id, review_action, review_changed_fields, review_edit_count)
       VALUES
         ($1, 'dismissed', '[]'::jsonb, 0),
         ($2, 'approved', '["merchant"]'::jsonb, 1),
         ($3, 'approved', '["amount"]'::jsonb, 1)`,
      [noisyOne.rows[0].id, noisyTwo.rows[0].id, noisyThree.rows[0].id]
    );

    const res = await request(app).get(`/expenses/${expResult.rows[0].id}`);
    expect(res.status).toBe(200);
    expect(res.body.gmail_review_hint).toMatchObject({
      sender_domain: 'messy.com',
      sender_quality_level: 'noisy',
      headline: 'Low-confidence sender',
    });
  });
});

describe('PATCH /expenses/:id', () => {
  it('updates merchant, amount, and notes', async () => {
    const userResult = await db.query(
      `SELECT id FROM users WHERE provider_uid = 'auth0|test-user-123'`
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

  it('records Gmail import edit feedback and changed fields for email-sourced expenses', async () => {
    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status, notes)
       VALUES ($1, $2, 'OriginalEmailMerchant', 20.00, '2026-03-15', 'email', 'pending', 'Imported from Gmail')
       RETURNING id`,
      [userId, householdId]
    );
    const expenseId = expResult.rows[0].id;
    await db.query(
      `INSERT INTO email_import_log (user_id, message_id, expense_id, status)
       VALUES ($1, 'edit-feedback-msg', $2, 'imported')`,
      [userId, expenseId]
    );

    const res = await request(app)
      .patch(`/expenses/${expenseId}`)
      .send({ merchant: 'UpdatedEmailMerchant', amount: 25.00, notes: 'updated note' });

    expect(res.status).toBe(200);

    const log = await db.query(
      `SELECT review_action, review_edit_count, review_changed_fields
       FROM email_import_feedback
       WHERE expense_id = $1`,
      [expenseId]
    );
    expect(log.rows[0].review_action).toBe('edited');
    expect(Number(log.rows[0].review_edit_count)).toBe(1);
    expect(log.rows[0].review_changed_fields).toEqual(
      expect.arrayContaining(['merchant', 'amount', 'notes'])
    );
  });

  it('records item-level Gmail import correction signals when imported items are edited', async () => {
    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status, notes)
       VALUES ($1, $2, 'Imported Grocer', 20.00, '2026-03-15', 'email', 'pending', 'Imported from Gmail')
       RETURNING id`,
      [userId, householdId]
    );
    const expenseId = expResult.rows[0].id;
    await db.query(
      `INSERT INTO email_import_log (user_id, message_id, expense_id, status)
       VALUES ($1, 'edit-item-feedback-msg', $2, 'imported')`,
      [userId, expenseId]
    );
    await db.query(
      `INSERT INTO expense_items (expense_id, description, amount, sort_order, item_type)
       VALUES
         ($1, 'Greek Yogurt', 6.99, 0, 'product'),
         ($1, 'Delivery Fee', 3.99, 1, 'fee'),
         ($1, 'Order Total', 10.98, 2, 'summary')`,
      [expenseId]
    );

    const res = await request(app)
      .patch(`/expenses/${expenseId}`)
      .send({
        items: [
          { description: 'Greek Yogurt 32oz', amount: 7.29 },
        ],
      });

    expect(res.status).toBe(200);

    const log = await db.query(
      `SELECT review_action, review_edit_count, review_changed_fields
       FROM email_import_feedback
       WHERE expense_id = $1`,
      [expenseId]
    );
    expect(log.rows[0].review_action).toBe('edited');
    expect(Number(log.rows[0].review_edit_count)).toBe(1);
    expect(log.rows[0].review_changed_fields).toEqual(
      expect.arrayContaining([
        'items',
        'items_count',
        'items_description',
        'items_amount',
        'items_rows_removed',
        'items_fee_rows_removed',
        'items_summary_rows_removed',
      ])
    );
  });

  it('replaces items when items payload is provided', async () => {
    const userResult = await db.query(
      `SELECT id FROM users WHERE provider_uid = 'auth0|test-user-123'`
    );
    const userId = userResult.rows[0].id;

    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'PatchItemsMerchant', 50.00, '2026-03-13', 'manual', 'confirmed') RETURNING id`,
      [userId, householdId]
    );
    const expenseId = expResult.rows[0].id;

    // First, add initial items
    await db.query(
      `INSERT INTO expense_items (expense_id, description, amount, sort_order)
       VALUES ($1, 'OldItem', 50.00, 0)`,
      [expenseId]
    );

    // Now patch with new items
    const res = await request(app)
      .patch(`/expenses/${expenseId}`)
      .send({
        items: [
          { description: 'NewItem1', amount: 20.00 },
          { description: 'NewItem2', amount: 30.00 },
        ],
      });

    expect(res.status).toBe(200);

    // Verify the items were replaced via GET /:id
    const getRes = await request(app).get(`/expenses/${expenseId}`);
    expect(getRes.status).toBe(200);
    expect(Array.isArray(getRes.body.items)).toBe(true);
    expect(getRes.body.items.length).toBe(2);
    const descriptions = getRes.body.items.map(i => i.description);
    expect(descriptions).toContain('NewItem1');
    expect(descriptions).toContain('NewItem2');
    expect(descriptions).not.toContain('OldItem');
  });

  it('returns 400 when an item has an empty description', async () => {
    const userResult = await db.query(
      `SELECT id FROM users WHERE provider_uid = 'auth0|test-user-123'`
    );
    const userId = userResult.rows[0].id;

    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'PatchBadItemMerchant', 10.00, '2026-03-12', 'manual', 'confirmed') RETURNING id`,
      [userId, householdId]
    );
    const expenseId = expResult.rows[0].id;

    const res = await request(app)
      .patch(`/expenses/${expenseId}`)
      .send({
        items: [{ description: '   ', amount: 10.00 }],
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for invalid category_id UUID', async () => {
    const userResult = await db.query(
      `SELECT id FROM users WHERE provider_uid = 'auth0|test-user-123'`
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

describe('POST /expenses/:id/approve', () => {
  it('records Gmail import approval feedback for email-sourced pending expenses', async () => {
    const expResult = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'EmailApprove', 9.00, '2026-03-17', 'email', 'pending') RETURNING id`,
      [userId, householdId]
    );
    const expenseId = expResult.rows[0].id;
    await db.query(
      `INSERT INTO email_import_log (user_id, message_id, expense_id, status)
       VALUES ($1, 'approve-feedback-msg', $2, 'imported')`,
      [userId, expenseId]
    );

    const res = await request(app).post(`/expenses/${expenseId}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');

    const log = await db.query(
      `SELECT review_action, reviewed_at
       FROM email_import_feedback
       WHERE expense_id = $1`,
      [expenseId]
    );
    expect(log.rows[0].review_action).toBe('approved');
    expect(log.rows[0].reviewed_at).toBeTruthy();
  });
});

describe('DELETE /expenses/:id', () => {
  it('owner can delete their expense (204)', async () => {
    const userResult = await db.query(
      `SELECT id FROM users WHERE provider_uid = 'auth0|test-user-123'`
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
      `INSERT INTO users (provider_uid, name, email)
       VALUES ('auth0|other-delete-user', 'Other Delete User', 'otherdelete@test.com')
       ON CONFLICT (provider_uid) DO UPDATE SET name = 'Other Delete User'
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
    await db.query(`DELETE FROM users WHERE provider_uid = 'auth0|other-delete-user'`);
  });
});

describe('POST /expenses/scan', () => {
  it('returns parsed expense with source camera', async () => {
    parseReceiptDetailed.mockResolvedValue({ parsed: {
      merchant: 'Whole Foods',
      amount: 87.32,
      date: '2026-03-21',
      notes: null,
      parse_status: 'complete',
      review_fields: [],
      field_confidence: { merchant: 'high', amount: 'high', date: 'high', items: 'low' },
    }});
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

  it('returns partial receipt data when merchant and amount are usable', async () => {
    parseReceiptDetailed.mockResolvedValue({ parsed: {
      merchant: null,
      amount: 18.25,
      date: '2026-03-21',
      notes: null,
      parse_status: 'partial',
      review_fields: ['merchant', 'items'],
      field_confidence: { merchant: 'low', amount: 'high', date: 'high', items: 'low' },
    }});
    assignCategory.mockResolvedValueOnce({
      category_id: null, source: 'default', confidence: 0,
    });

    const res = await request(app)
      .post('/expenses/scan')
      .set('Authorization', 'Bearer test')
      .send({ image_base64: 'base64data' });
    expect(res.status).toBe(200);
    expect(res.body.parse_status).toBe('partial');
    expect(res.body.review_fields).toEqual(expect.arrayContaining(['merchant', 'items']));
    expect(res.body.amount).toBe(18.25);
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
    parseReceiptDetailed.mockResolvedValue({ parsed: null, failureReason: 'missing_total' });
    const res = await request(app)
      .post('/expenses/scan')
      .set('Authorization', 'Bearer test')
      .send({ image_base64: 'base64data' });
    expect(res.status).toBe(422);
    expect(res.body.reason_code).toBe('missing_total');
    expect(Array.isArray(res.body.suggested_actions)).toBe(true);
  });
});

describe('POST /expenses/confirm — location fields stored when provided', () => {
  it('stores and returns place_name and address', async () => {
    const res = await request(app)
      .post('/expenses/confirm')
      .send({
        merchant: 'Test Cafe', amount: 12.50, date: '2026-03-29', source: 'manual',
        place_name: 'Test Cafe Downtown', address: '123 Main St',
      });
    expect(res.status).toBe(201);
    expect(res.body.expense.place_name).toBe('Test Cafe Downtown');
    expect(res.body.expense.address).toBe('123 Main St');
  });
});

describe('POST /expenses/parse — input length limit', () => {
  it('returns 400 when input exceeds 500 chars', async () => {
    const res = await request(app)
      .post('/expenses/parse')
      .send({ input: 'a'.repeat(501), today: '2026-03-29' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/i);
  });
});

describe('POST /expenses/scan — image size limit', () => {
  it('returns 400 when image_base64 exceeds the route limit', async () => {
    const res = await request(app)
      .post('/expenses/scan')
      .send({ image_base64: 'a'.repeat(3_000_001), today: '2026-03-29' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large/i);
  });
});

describe('expense response includes category_parent_name', () => {
  it('GET /expenses returns category_parent_name field on each expense', async () => {
    const res = await request(app).get('/expenses');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('category_parent_name');
    }
  });
});

describe('POST /expenses/parse — category_name in response', () => {
  it('returns category_name alongside category_id', async () => {
    parseExpenseDetailed.mockResolvedValueOnce({ parsed: {
      merchant: "Trader Joe's",
      amount: 84.17,
      date: '2026-03-20',
      notes: null,
      parse_status: 'partial',
      review_fields: ['items'],
      field_confidence: { merchant: 'high', amount: 'high', date: 'high', items: 'low' },
    }});
    const catRes = await db.query(
      `INSERT INTO categories (name, household_id) VALUES ('Groceries', $1) RETURNING id, name`,
      [householdId]
    );
    const catId = catRes.rows[0].id;
    assignCategory.mockResolvedValueOnce({ category_id: catId, source: 'memory', confidence: 4 });

    const res = await request(app)
      .post('/expenses/parse')
      .send({ input: '84.17 trader joes', today: '2026-03-20' });

    expect(res.status).toBe(200);
    expect(res.body.category_id).toBe(catId);
    expect(res.body.category_name).toBe('Groceries');
    expect(res.body.category_source).toBe('memory');

    await db.query('DELETE FROM categories WHERE id = $1', [catId]);
  });

  it('returns category_name: null when no category matched', async () => {
    parseExpenseDetailed.mockResolvedValueOnce({ parsed: {
      merchant: 'Unknown Shop',
      amount: 10,
      date: '2026-03-20',
      notes: null,
      parse_status: 'partial',
      review_fields: ['items'],
      field_confidence: { merchant: 'high', amount: 'high', date: 'high', items: 'low' },
    }});
    assignCategory.mockResolvedValueOnce({ category_id: null, source: 'claude', confidence: 0 });

    const res = await request(app)
      .post('/expenses/parse')
      .send({ input: '10 unknown shop', today: '2026-03-20' });

    expect(res.status).toBe(200);
    expect(res.body.category_id).toBeNull();
    expect(res.body.category_name).toBeNull();
  });
});

describe('GET /expenses with ?month filter', () => {
  afterEach(async () => {
    await db.query(`DELETE FROM expenses WHERE merchant IN ('Jan Merchant', 'Feb Merchant', 'Cross Period Merchant')`);
  });

  it('returns only expenses from the specified month', async () => {
    await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'Jan Merchant', 10.00, '2026-01-15', 'manual', 'confirmed'),
              ($1, $2, 'Feb Merchant', 20.00, '2026-02-15', 'manual', 'confirmed')`,
      [userId, householdId]
    );

    const res = await request(app).get('/expenses?month=2026-01');
    expect(res.status).toBe(200);
    expect(res.body.every(e => String(e.date).startsWith('2026-01'))).toBe(true);
    expect(res.body.some(e => e.merchant === 'Jan Merchant')).toBe(true);
    expect(res.body.some(e => e.merchant === 'Feb Merchant')).toBe(false);
  });

  it('uses start_day override when filtering a period', async () => {
    await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'Cross Period Merchant', 15.00, '2026-02-10', 'manual', 'confirmed')`,
      [userId, householdId]
    );

    const res = await request(app).get('/expenses?month=2026-01&start_day=15');
    expect(res.status).toBe(200);
    expect(res.body.some(e => e.merchant === 'Cross Period Merchant')).toBe(true);
  });
});

describe('POST /expenses/scan — category_name in response', () => {
  it('returns category_name alongside category_id', async () => {
    const catRes = await db.query(
      `INSERT INTO categories (name, household_id) VALUES ('Groceries Scan', $1) RETURNING id, name`,
      [householdId]
    );
    const catId = catRes.rows[0].id;
    parseReceiptDetailed.mockResolvedValueOnce({ parsed: {
      merchant: 'Whole Foods',
      amount: 87.32,
      date: '2026-03-21',
      notes: null,
      parse_status: 'complete',
      review_fields: [],
      field_confidence: { merchant: 'high', amount: 'high', date: 'high', items: 'low' },
    }});
    assignCategory.mockResolvedValueOnce({ category_id: catId, source: 'memory', confidence: 4 });

    const res = await request(app)
      .post('/expenses/scan')
      .send({ image_base64: 'base64data' });

    expect(res.status).toBe(200);
    expect(res.body.category_id).toBe(catId);
    expect(res.body.category_name).toBe('Groceries Scan');
    expect(res.body.category_source).toBe('memory');

    await db.query('DELETE FROM categories WHERE id = $1', [catId]);
  });
});
