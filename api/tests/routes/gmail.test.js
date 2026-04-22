process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes as hex
const { encrypt } = require('../../src/services/tokenCrypto');
const request = require('supertest');
const db = require('../../src/db');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => { req.userId = 'test-auth0-gmail'; next(); }
}));
jest.mock('../../src/services/gmailClient', () => ({
  getAuthUrl: jest.fn().mockResolvedValue('https://accounts.google.com/o/oauth2/auth?state=test-csrf-token'),
  exchangeCode: jest.fn(),
  listRecentMessages: jest.fn(),
  getMessage: jest.fn(),
}));
jest.mock('../../src/services/mapkitService', () => ({
  searchPlace: jest.fn(),
}));
jest.mock('../../src/services/productResolver', () => ({
  resolveProductMatch: jest.fn(),
}));
jest.mock('../../src/services/itemHistoryService', () => ({
  getItemHistoryByGroupKey: jest.fn(),
}));
jest.mock('../../src/services/emailParser', () => ({
  classifyEmailExpense: jest.fn(),
  parseEmailExpense: jest.fn(),
  extractFallbackItemsFromEmailBody: jest.fn(),
  analyzeEmailSignals: jest.fn(),
  classifyEmailModality: jest.fn(),
  extractEmailLocationCandidate: jest.fn(),
  clampExpenseDate: jest.fn((candidateDate, maxDate) => {
    if (!candidateDate) return maxDate;
    return candidateDate > maxDate ? maxDate : candidateDate;
  }),
}));
jest.mock('../../src/services/categoryAssigner', () => ({
  assignCategory: jest.fn(),
}));

const app = require('../../src/index');
const { exchangeCode, listRecentMessages, getMessage } = require('../../src/services/gmailClient');
const { classifyEmailExpense, parseEmailExpense, extractFallbackItemsFromEmailBody, analyzeEmailSignals, classifyEmailModality, extractEmailLocationCandidate } = require('../../src/services/emailParser');
const { assignCategory } = require('../../src/services/categoryAssigner');
const { searchPlace } = require('../../src/services/mapkitService');
const { resolveProductMatch } = require('../../src/services/productResolver');
const { getItemHistoryByGroupKey } = require('../../src/services/itemHistoryService');

let householdId;
let userId;

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

  const hhResult = await db.query(
    `INSERT INTO households (name) VALUES ('Gmail Test Household') RETURNING id`
  );
  householdId = hhResult.rows[0].id;

  const userResult = await db.query(
    `INSERT INTO users (provider_uid, name, email, household_id)
     VALUES ('test-auth0-gmail', 'Gmail Test User', 'gmail-test@test.com', $1)
     ON CONFLICT (provider_uid) DO UPDATE SET household_id = $1 RETURNING id`,
    [householdId]
  );
  userId = userResult.rows[0].id;
});

afterAll(async () => {
  await db.query(
    `DELETE FROM email_import_feedback
     WHERE expense_id IN (SELECT id FROM expenses WHERE user_id = $1)`,
    [userId]
  );
  await db.query(`DELETE FROM email_import_log WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM oauth_tokens WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM expenses WHERE user_id = $1`, [userId]);
  await db.query(`UPDATE users SET household_id = NULL WHERE provider_uid = 'test-auth0-gmail'`);
  await db.query(`DELETE FROM households WHERE id = $1`, [householdId]);
});

beforeEach(async () => {
  exchangeCode.mockReset();
  listRecentMessages.mockReset();
  getMessage.mockReset();
  parseEmailExpense.mockReset();
  extractFallbackItemsFromEmailBody.mockReset();
  classifyEmailExpense.mockReset();
  analyzeEmailSignals.mockReset();
  analyzeEmailSignals.mockReturnValue({ shouldSurfaceToReview: false });
  classifyEmailModality.mockReset();
  classifyEmailModality.mockReturnValue('online');
  extractEmailLocationCandidate.mockReset();
  extractEmailLocationCandidate.mockReturnValue(null);
  extractFallbackItemsFromEmailBody.mockReturnValue([]);
  searchPlace.mockReset();
  searchPlace.mockResolvedValue(null);
  resolveProductMatch.mockReset();
  resolveProductMatch.mockResolvedValue(null);
  getItemHistoryByGroupKey.mockReset();
  getItemHistoryByGroupKey.mockResolvedValue(null);
  assignCategory.mockReset();
  // Clean state between tests
  await db.query(`DELETE FROM gmail_oauth_states WHERE user_id = $1`, [userId]);
  await db.query(
    `DELETE FROM email_import_feedback
     WHERE expense_id IN (SELECT id FROM expenses WHERE user_id = $1)`,
    [userId]
  );
  await db.query(`DELETE FROM email_import_log WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM oauth_tokens WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM expenses WHERE user_id = $1`, [userId]);
});

describe('GET /gmail/status', () => {
  it('returns { connected: false } when no token', async () => {
    const res = await request(app).get('/gmail/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      connected: false,
      email: 'test@example.com',
      last_synced_at: null,
      last_sync_attempted_at: null,
      last_sync_error_at: null,
      last_sync_error: null,
      last_sync_source: null,
      last_sync_status: null,
    });
  });

  it('returns { connected: true } when token exists', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );
    const res = await request(app).get('/gmail/status');
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.email).toBe('test@example.com');
    expect(res.body.last_synced_at).toBeNull();
    expect(res.body.last_sync_attempted_at).toBeNull();
    expect(res.body.last_sync_error).toBeNull();
  });
});

describe('POST /gmail/message/:messageId/reprocess', () => {
  it('reprocesses an already-imported pending Gmail expense by replacing the old expense', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, refresh_token, token_expires_at)
       VALUES ($1, 'gmail', $2, NOW() + INTERVAL '30 days')`,
      [userId, encrypt('refresh-token')]
    );

    const originalExpense = await db.query(
      `INSERT INTO expenses (
         user_id, household_id, merchant, amount, date, source, status, notes,
         review_required, review_mode, review_source
       )
       VALUES ($1, $2, 'Old Merchant', 18.99, '2026-04-21', 'email', 'pending', 'Imported from Gmail',
         TRUE, 'items_first', 'gmail')
       RETURNING id`,
      [userId, householdId]
    );
    const originalExpenseId = originalExpense.rows[0].id;

    await db.query(
      `INSERT INTO expense_items (expense_id, description, amount, sort_order, item_type)
       VALUES ($1, 'Subtotal', 18.99, 0, 'summary')`,
      [originalExpenseId]
    );

    await db.query(
      `INSERT INTO email_import_log (user_id, message_id, expense_id, status, subject, from_address)
       VALUES ($1, '19db291791e9743e', $2, 'imported', 'Coffee order', 'orders@example.com')`,
      [userId, originalExpenseId]
    );

    getMessage.mockResolvedValue({
      subject: 'Coffee order',
      from: 'orders@example.com',
      snippet: 'Total $107.95',
      body: `ITEM DESCRIPTION
DAK - Plum Marmalade Espresso
DAK Coffee Roasters
COF-DA-0323
x 1
$19.99
Total
$107.95`,
      receivedAt: '2026-04-21',
    });
    classifyEmailExpense.mockResolvedValue({
      disposition: 'expense',
      merchant: 'Dak Coffee Roasters',
      reason: 'order receipt',
    });
    parseEmailExpense.mockResolvedValue({
      merchant: 'Dak Coffee Roasters',
      amount: 107.95,
      date: '2026-04-21',
      notes: 'Imported from Gmail',
      payment_method: null,
      card_label: null,
      card_last4: null,
      items: [
        { description: 'DAK - Plum Marmalade Espresso', amount: 19.99 },
      ],
    });
    assignCategory.mockResolvedValue({ category_id: null, source: null, confidence: null, reasoning: null });

    const res = await request(app)
      .post('/gmail/message/19db291791e9743e/reprocess');

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.expense).toBeTruthy();
    expect(res.body.expense.id).not.toBe(originalExpenseId);

    const oldExpenseCheck = await db.query(`SELECT id FROM expenses WHERE id = $1`, [originalExpenseId]);
    expect(oldExpenseCheck.rowCount).toBe(0);

    const logCheck = await db.query(
      `SELECT expense_id, status FROM email_import_log WHERE user_id = $1 AND message_id = $2`,
      [userId, '19db291791e9743e']
    );
    expect(logCheck.rows[0].status).toBe('imported');
    expect(logCheck.rows[0].expense_id).toBe(res.body.expense.id);

    const itemsCheck = await db.query(
      `SELECT description, amount FROM expense_items WHERE expense_id = $1 ORDER BY sort_order ASC`,
      [res.body.expense.id]
    );
    expect(itemsCheck.rows).toEqual([
      expect.objectContaining({ description: 'DAK - Plum Marmalade Espresso' }),
    ]);
  });
});

describe('GET /gmail/callback', () => {
  it('saves token, returns Gmail connected page', async () => {
    await db.query(
      `INSERT INTO gmail_oauth_states (token, user_id) VALUES ('valid-csrf-token', $1)`, [userId]
    );
    exchangeCode.mockResolvedValue({ accessToken: null, refreshToken: 'new_refresh', expiresAt: null, scope: 'gmail.readonly' });

    const res = await request(app).get('/gmail/callback?code=auth_code_123&state=valid-csrf-token');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Gmail connected');
    expect(exchangeCode).toHaveBeenCalledWith('auth_code_123');

    // State token should be consumed
    const stateRow = await db.query(`SELECT * FROM gmail_oauth_states WHERE token = 'valid-csrf-token'`);
    expect(stateRow.rows).toHaveLength(0);

    const token = await db.query(`SELECT * FROM oauth_tokens WHERE user_id = $1`, [userId]);
    expect(token.rows).toHaveLength(1);
    expect(token.rows[0].access_token).toBeNull();
  });

  it('returns 400 for unknown state token', async () => {
    exchangeCode.mockResolvedValue({ accessToken: null, refreshToken: 'r', expiresAt: null, scope: '' });
    const res = await request(app).get('/gmail/callback?code=code&state=not-a-real-token');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid|expired/i);
  });

  it('returns 400 when code is missing', async () => {
    const res = await request(app).get('/gmail/callback');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing code or state');
  });
});

describe('POST /gmail/import', () => {
  it('returns 403 when Gmail not connected', async () => {
    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Gmail not connected/);
  });

  it('returns { imported, skipped, failed } counts', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );

    listRecentMessages.mockResolvedValue([
      { id: 'msg1' },
      { id: 'msg2' },
    ]);
    getMessage.mockResolvedValue({ subject: 'Order Confirmation', from: 'orders@amazon.com', body: 'Total: $29.99', receivedAt: '2026-03-21' });
    classifyEmailExpense
      .mockResolvedValueOnce({ disposition: 'expense', merchant: 'Amazon', reason: 'receipt' })
      .mockResolvedValueOnce({ disposition: 'not_expense', merchant: null, reason: 'classifier_not_expense' });
    parseEmailExpense
      .mockResolvedValueOnce({ merchant: 'Amazon', amount: 29.99, date: '2026-03-21', notes: null })
      .mockResolvedValueOnce(null);
    assignCategory.mockResolvedValue({ category_id: null });

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(1);
    expect(res.body.failed).toBe(0);
    expect(res.body.outcomes).toMatchObject({
      imported_parsed: 0,
      imported_pending_review: 1,
      imported_auto_confirmed: 0,
      imported_fast_lane: 0,
      imported_items_first: 0,
      imported_full_review: 1,
      skipped_existing: 0,
      skipped_reasons: { classifier_not_expense: 1 },
    });
    const token = await db.query(
      `SELECT last_synced_at, last_sync_attempted_at, last_sync_status, last_sync_source, last_sync_error
       FROM oauth_tokens WHERE user_id = $1`,
      [userId]
    );
    expect(token.rows[0].last_synced_at).toBeTruthy();
    expect(token.rows[0].last_sync_attempted_at).toBeTruthy();
    expect(token.rows[0].last_sync_status).toBe('success');
    expect(token.rows[0].last_sync_source).toBe('manual');
    expect(token.rows[0].last_sync_error).toBeNull();
  });

  it('promotes a familiar item import to quick_check when parsed items match personal history', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );
    const historicalExpenseIds = [];
    for (const merchant of ['Amazon', 'Amazon', 'Amazon']) {
      const inserted = await db.query(
        `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
         VALUES ($1, $2, $3, 19.99, '2026-04-01', 'email', 'confirmed')
         RETURNING id`,
        [userId, householdId, merchant]
      );
      historicalExpenseIds.push(inserted.rows[0].id);
    }
    for (const [index, expenseId] of historicalExpenseIds.entries()) {
      await db.query(
        `INSERT INTO email_import_log (user_id, message_id, expense_id, status, from_address, subject)
         VALUES ($1, $2, $3, 'imported', 'orders@amazon.com', $4)`,
        [userId, `hist-msg-${index}`, expenseId, `ORDER: Hist ${index}`]
      );
      await db.query(
        `INSERT INTO email_import_feedback (expense_id, review_action, review_changed_fields, review_edit_count)
         VALUES ($1, 'approved', '["review_path_quick_check"]'::jsonb, 0)`,
        [expenseId]
      );
    }

    listRecentMessages.mockResolvedValue([{ id: 'msg-familiar-item' }]);
    getMessage.mockResolvedValue({
      subject: 'Your receipt from Target',
      from: 'orders@amazon.com',
      body: 'Total: $18.49',
      snippet: 'Total: $18.49',
      receivedAt: '2026-04-16',
    });
    classifyEmailExpense.mockResolvedValue({ disposition: 'expense', merchant: 'Target', reason: 'receipt' });
    parseEmailExpense.mockResolvedValue({
      merchant: 'Target',
      amount: 18.49,
      date: '2026-04-16',
      notes: null,
      items: [{ description: 'Sparkling Water', amount: 18.49, comparable_key: 'sparkling water|brand:water co' }],
    });
    assignCategory.mockResolvedValue({ category_id: null });
    resolveProductMatch.mockResolvedValue({ confidence: 'medium', reason: 'normalized_match', product_id: null });
    getItemHistoryByGroupKey.mockResolvedValue({
      group_key: 'comparable:sparkling water|brand:water co',
      item_name: 'Sparkling Water',
      occurrence_count: 3,
      median_amount: 17.99,
      latest_purchase: { merchant: 'Target', amount: 18.19 },
    });

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.outcomes).toMatchObject({
      imported_pending_review: 1,
      imported_fast_lane: 1,
      imported_items_first: 0,
      imported_full_review: 0,
    });

    const inserted = await db.query(
      `SELECT review_mode FROM expenses WHERE user_id = $1 AND merchant = 'Target' ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    expect(inserted.rows[0].review_mode).toBe('quick_check');
  });

  it('keeps item-heavy imports in items_first when parsed items conflict with personal history', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );
    const historicalExpenseIds = [];
    for (const merchant of ['Amazon', 'Amazon', 'Amazon']) {
      const inserted = await db.query(
        `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
         VALUES ($1, $2, $3, 19.99, '2026-04-01', 'email', 'confirmed')
         RETURNING id`,
        [userId, householdId, merchant]
      );
      historicalExpenseIds.push(inserted.rows[0].id);
    }
    for (const [index, expenseId] of historicalExpenseIds.entries()) {
      await db.query(
        `INSERT INTO email_import_log (user_id, message_id, expense_id, status, from_address, subject)
         VALUES ($1, $2, $3, 'imported', 'orders@amazon.com', $4)`,
        [userId, `hist-conflict-${index}`, expenseId, `ORDER: Hist ${index}`]
      );
      await db.query(
        `INSERT INTO email_import_feedback (expense_id, review_action, review_changed_fields, review_edit_count)
         VALUES ($1, 'approved', '["review_path_quick_check"]'::jsonb, 0)`,
        [expenseId]
      );
    }

    listRecentMessages.mockResolvedValue([{ id: 'msg-conflict-item' }]);
    getMessage.mockResolvedValue({
      subject: 'ORDER: conflicting item',
      from: 'orders@amazon.com',
      body: 'Total: $39.99',
      snippet: 'Total: $39.99',
      receivedAt: '2026-04-16',
    });
    classifyEmailExpense.mockResolvedValue({ disposition: 'expense', merchant: 'Whole Foods', reason: 'receipt' });
    parseEmailExpense.mockResolvedValue({
      merchant: 'Whole Foods',
      amount: 39.99,
      date: '2026-04-16',
      notes: null,
      items: [{ description: 'Sparkling Water', amount: 39.99, comparable_key: 'sparkling water|brand:water co' }],
    });
    assignCategory.mockResolvedValue({ category_id: null });
    resolveProductMatch.mockResolvedValue({ confidence: 'medium', reason: 'normalized_match', product_id: null });
    getItemHistoryByGroupKey.mockResolvedValue({
      group_key: 'comparable:sparkling water|brand:water co',
      item_name: 'Sparkling Water',
      occurrence_count: 3,
      median_amount: 17.99,
      latest_purchase: { merchant: 'Target', amount: 18.19 },
    });

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.outcomes).toMatchObject({
      imported_pending_review: 1,
      imported_fast_lane: 0,
      imported_items_first: 1,
    });

    const inserted = await db.query(
      `SELECT review_mode FROM expenses WHERE user_id = $1 AND merchant = 'Whole Foods' ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    expect(inserted.rows[0].review_mode).toBe('items_first');
  });

  it('treats amazon ORDER subjects as transaction-like even if the classifier says not_expense', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );

    listRecentMessages.mockResolvedValue([{ id: 'msg-order' }]);
    getMessage.mockResolvedValue({
      subject: 'ORDER: placed on April 10',
      from: 'orders@amazon.com',
      body: 'Thanks for your order. Order total: $29.99',
      snippet: 'Order total: $29.99',
      receivedAt: '2026-04-10',
    });
    analyzeEmailSignals.mockReturnValue({
      shouldSurfaceToReview: false,
      strongMoneySignal: false,
      mediumMoneySignal: false,
    });
    classifyEmailExpense.mockResolvedValue({ disposition: 'not_expense', merchant: null, reason: 'classifier_not_expense' });
    parseEmailExpense.mockResolvedValue({ merchant: 'Amazon', amount: 29.99, date: '2026-04-10', notes: null });
    assignCategory.mockResolvedValue({ category_id: null });

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(0);
  });

  it('recovers a stacked estimated total when the parser returns a partial object without amount', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );

    listRecentMessages.mockResolvedValue([{ id: 'msg-amazon-stack-total' }]);
    getMessage.mockResolvedValue({
      subject: 'Your Amazon order summary',
      from: 'orders@amazon.com',
      snippet: 'Estimated total $396.32',
      body: `Order summary
Subtotal (4 items)
Additional savings
Treats Rewards points applied
Estimated shipping
Estimated tax
Estimated total
$436.76
-$16.44
-$24.00
$0.00
$0.00
$396.32`,
      receivedAt: '2026-04-17',
    });
    classifyEmailExpense.mockResolvedValue({
      disposition: 'expense',
      merchant: 'Amazon',
      reason: 'receipt',
    });
    parseEmailExpense.mockResolvedValue({
      merchant: 'Amazon',
      amount: null,
      date: '2026-04-17',
      notes: 'Imported from Gmail',
      items: null,
    });
    assignCategory.mockResolvedValue({ category_id: null });

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(0);

    const expense = await db.query(
      `SELECT amount, status, notes
       FROM expenses
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    expect(Number(expense.rows[0].amount)).toBe(396.32);
    expect(expense.rows[0].status).toBe('pending');
    expect(expense.rows[0].notes).toMatch(/needs review/i);
  });

  it('pre-queue skips amazon shipping templates without transaction signals', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );

    listRecentMessages.mockResolvedValue([{ id: 'msg-ship' }]);
    getMessage.mockResolvedValue({
      subject: 'Your Amazon order has shipped',
      from: 'shipment-tracking@amazon.com',
      body: 'Track your package here.',
      snippet: 'Track your package here.',
      receivedAt: '2026-04-10',
    });
    analyzeEmailSignals.mockReturnValue({
      shouldSurfaceToReview: false,
      strongMoneySignal: false,
      mediumMoneySignal: false,
    });
    classifyEmailExpense.mockResolvedValue({ disposition: 'not_expense', merchant: null, reason: 'classifier_not_expense' });
    parseEmailExpense.mockResolvedValue(null);

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.skipped).toBe(1);
    expect(res.body.outcomes.skipped_reasons).toHaveProperty('template_skip_amazon_shipping', 1);
  });

  it('skips already-imported messages', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );
    await db.query(
      `INSERT INTO email_import_log (user_id, message_id, status) VALUES ($1, 'already-msg', 'imported')`,
      [userId]
    );

    listRecentMessages.mockResolvedValue([{ id: 'already-msg' }]);

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(1);
    expect(res.body.imported).toBe(0);
    expect(getMessage).not.toHaveBeenCalled();
    expect(res.body.outcomes.skipped_existing).toBe(1);
  });

  it('counts failed when getMessage throws', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );

    listRecentMessages.mockResolvedValue([{ id: 'fail-msg' }]);
    getMessage.mockRejectedValue(new Error('Network error'));

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.failed).toBe(1);
    expect(res.body.imported).toBe(0);
    expect(res.body.outcomes.failed_reasons['Network error']).toBe(1);

    const token = await db.query(
      `SELECT last_synced_at, last_sync_attempted_at, last_sync_status, last_sync_source, last_sync_error
       FROM oauth_tokens WHERE user_id = $1`,
      [userId]
    );
    expect(token.rows[0].last_sync_attempted_at).toBeTruthy();
    expect(token.rows[0].last_synced_at).toBeTruthy();
    expect(token.rows[0].last_sync_status).toBe('success');
    expect(token.rows[0].last_sync_source).toBe('manual');
    expect(token.rows[0].last_sync_error).toBeNull();
  });

  it('returns a reconnect message when Gmail credentials are expired before sync starts', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );

    listRecentMessages.mockRejectedValue(new Error('invalid_grant'));

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: 'Gmail connection expired. Reconnect Gmail and try again.',
    });

    const token = await db.query(
      `SELECT last_synced_at, last_sync_attempted_at, last_sync_status, last_sync_source, last_sync_error
       FROM oauth_tokens WHERE user_id = $1`,
      [userId]
    );
    expect(token.rows[0].last_sync_attempted_at).toBeTruthy();
    expect(token.rows[0].last_synced_at).toBeNull();
    expect(token.rows[0].last_sync_status).toBe('failed');
    expect(token.rows[0].last_sync_source).toBe('manual');
    expect(token.rows[0].last_sync_error).toMatch(/invalid_grant/i);
  });

  it('returns a configuration error when Gmail env is missing and records a failed sync attempt', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );

    listRecentMessages.mockRejectedValue(new Error('google_client_id missing'));

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: 'Gmail sync is not configured correctly.',
    });

    const token = await db.query(
      `SELECT last_synced_at, last_sync_attempted_at, last_sync_status, last_sync_source, last_sync_error
       FROM oauth_tokens WHERE user_id = $1`,
      [userId]
    );
    expect(token.rows[0].last_sync_attempted_at).toBeTruthy();
    expect(token.rows[0].last_synced_at).toBeNull();
    expect(token.rows[0].last_sync_status).toBe('failed');
    expect(token.rows[0].last_sync_source).toBe('manual');
    expect(token.rows[0].last_sync_error).toMatch(/google_client_id/i);
  });

  it('imports uncertain emails into pending when a likely amount can be recovered', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );

    listRecentMessages.mockResolvedValue([{ id: 'uncertain-msg' }]);
    getMessage.mockResolvedValue({
      subject: 'Your order details',
      from: 'orders@example.com',
      body: 'Thanks for your purchase. Grand total: $41.22. We will send tracking soon.',
      snippet: 'Grand total: $41.22',
      receivedAt: '2026-03-21',
    });
    classifyEmailExpense.mockResolvedValue({ disposition: 'uncertain', merchant: 'Example', reason: 'missing structured receipt' });
    parseEmailExpense.mockResolvedValue(null);
    assignCategory.mockResolvedValue({ category_id: null });

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(0);
    expect(res.body.outcomes.imported_pending_review).toBe(1);

    const expense = await db.query(`SELECT merchant, amount, notes FROM expenses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId]);
    expect(expense.rows[0].merchant).toBe('Example');
    expect(Number(expense.rows[0].amount)).toBe(41.22);
    expect(expense.rows[0].notes).toMatch(/imported from gmail/i);
    expect(expense.rows[0].notes).toMatch(/needs review/i);
  });

  it('persists deterministic fallback items when parseEmailExpense returns null', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );

    listRecentMessages.mockResolvedValue([{ id: 'fallback-items-msg' }]);
    getMessage.mockResolvedValue({
      subject: 'Order #RT-270233 confirmed',
      from: 'hello@eightouncecoffee.ca',
      body: 'Item Description\nDAK - Plum Marmalade Espresso\n$19.99\nTotal\n$107.95',
      snippet: 'Order #RT-270233 confirmed',
      receivedAt: '2026-04-21',
    });
    classifyEmailExpense.mockResolvedValue({ disposition: 'expense', merchant: 'Eight Ounce Coffee', reason: 'receipt' });
    parseEmailExpense.mockResolvedValue(null);
    extractFallbackItemsFromEmailBody.mockReturnValue([
      { description: 'DAK - Plum Marmalade Espresso', amount: 19.99, brand: 'DAK Coffee Roasters', sku: 'COF-DA-0323' },
      { description: 'DAK - House of Plum Espresso', amount: 21.99, brand: 'DAK Coffee Roasters', sku: 'COF-DA-0397' },
    ]);
    assignCategory.mockResolvedValue({ category_id: null });

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);

    const expense = await db.query(
      `SELECT id
       FROM expenses
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    const items = await db.query(
      `SELECT description, amount
       FROM expense_items
       WHERE expense_id = $1
       ORDER BY sort_order ASC, created_at ASC`,
      [expense.rows[0].id]
    );
    expect(items.rows).toEqual([
      expect.objectContaining({ description: 'DAK - Plum Marmalade Espresso', amount: '19.99' }),
      expect.objectContaining({ description: 'DAK - House of Plum Espresso', amount: '21.99' }),
    ]);
  });

  it('skips fallback imports from noisy senders with poor review history', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );

    const dismissedOne = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, status, source)
       VALUES ($1, $2, 'Messy Shop', 12.34, '2026-03-01', 'dismissed', 'email')
       RETURNING id`,
      [userId, householdId]
    );
    const editedOne = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, status, source)
       VALUES ($1, $2, 'Messy Shop', 18.99, '2026-03-02', 'confirmed', 'email')
       RETURNING id`,
      [userId, householdId]
    );
    const editedTwo = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, status, source)
       VALUES ($1, $2, 'Messy Shop', 21.50, '2026-03-03', 'confirmed', 'email')
       RETURNING id`,
      [userId, householdId]
    );
    await db.query(
      `INSERT INTO email_import_log (user_id, message_id, expense_id, status, from_address)
       VALUES
         ($1, 'messy-1', $2, 'imported', 'alerts@messy.com'),
         ($1, 'messy-2', $3, 'imported', 'alerts@messy.com'),
         ($1, 'messy-3', $4, 'imported', 'alerts@messy.com')`,
      [userId, dismissedOne.rows[0].id, editedOne.rows[0].id, editedTwo.rows[0].id]
    );
    await db.query(
      `INSERT INTO email_import_feedback (expense_id, review_action, review_changed_fields, review_edit_count)
       VALUES
         ($1, 'dismissed', '[]'::jsonb, 0),
         ($2, 'approved', '["merchant"]'::jsonb, 1),
         ($3, 'approved', '["amount"]'::jsonb, 1)`,
      [dismissedOne.rows[0].id, editedOne.rows[0].id, editedTwo.rows[0].id]
    );

    listRecentMessages.mockResolvedValue([{ id: 'uncertain-noisy-msg' }]);
    getMessage.mockResolvedValue({
      subject: 'Your order details',
      from: 'alerts@messy.com',
      body: 'Thanks for your purchase. Grand total: $41.22.',
      snippet: 'Grand total: $41.22',
      receivedAt: '2026-03-21',
    });
    classifyEmailExpense.mockResolvedValue({ disposition: 'uncertain', merchant: 'Messy Shop', reason: 'missing structured receipt' });
    parseEmailExpense.mockResolvedValue(null);

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.skipped).toBe(1);
    expect(res.body.outcomes.skipped_reasons.low_sender_quality).toBe(1);
  });

  it('softens noisy-sender fallback skips when the user said similar emails should have imported', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );

    const dismissedOne = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, status, source)
       VALUES ($1, $2, 'Messy Shop', 12.34, '2026-03-01', 'dismissed', 'email')
       RETURNING id`,
      [userId, householdId]
    );
    const editedOne = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, status, source)
       VALUES ($1, $2, 'Messy Shop', 18.99, '2026-03-02', 'confirmed', 'email')
       RETURNING id`,
      [userId, householdId]
    );
    const editedTwo = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, status, source)
       VALUES ($1, $2, 'Messy Shop', 21.50, '2026-03-03', 'confirmed', 'email')
       RETURNING id`,
      [userId, householdId]
    );
    const skippedLog = await db.query(
      `INSERT INTO email_import_log (user_id, message_id, status, from_address, skip_reason, user_feedback, user_feedback_at)
       VALUES ($1, 'messy-skipped', 'skipped', 'alerts@messy.com', 'classifier_not_expense', 'should_have_imported', NOW())
       RETURNING id`,
      [userId]
    );
    expect(skippedLog.rows[0].id).toBeTruthy();
    await db.query(
      `INSERT INTO email_import_log (user_id, message_id, expense_id, status, from_address)
       VALUES
         ($1, 'messy-1', $2, 'imported', 'alerts@messy.com'),
         ($1, 'messy-2', $3, 'imported', 'alerts@messy.com'),
         ($1, 'messy-3', $4, 'imported', 'alerts@messy.com')`,
      [userId, dismissedOne.rows[0].id, editedOne.rows[0].id, editedTwo.rows[0].id]
    );
    await db.query(
      `INSERT INTO email_import_feedback (expense_id, review_action, review_changed_fields, review_edit_count)
       VALUES
         ($1, 'dismissed', '[]'::jsonb, 0),
         ($2, 'approved', '["merchant"]'::jsonb, 1),
         ($3, 'approved', '["amount"]'::jsonb, 1)`,
      [dismissedOne.rows[0].id, editedOne.rows[0].id, editedTwo.rows[0].id]
    );

    listRecentMessages.mockResolvedValue([{ id: 'uncertain-noisy-should-import-msg' }]);
    getMessage.mockResolvedValue({
      subject: 'Your order details',
      from: 'alerts@messy.com',
      body: 'Thanks for your purchase. Grand total: $41.22.',
      snippet: 'Grand total: $41.22',
      receivedAt: '2026-03-21',
    });
    classifyEmailExpense.mockResolvedValue({ disposition: 'uncertain', merchant: 'Messy Shop', reason: 'missing structured receipt' });
    parseEmailExpense.mockResolvedValue(null);
    assignCategory.mockResolvedValue({ category_id: null });

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(0);
    expect(res.body.outcomes.imported_pending_review).toBe(1);
    expect(res.body.outcomes.skipped_reasons.low_sender_quality).toBeUndefined();
  });

  it('keeps parser-requested review notes pending for trusted senders', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );

    const cleanOne = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, status, source)
       VALUES ($1, $2, 'Amazon', 12.34, '2026-03-01', 'confirmed', 'email')
       RETURNING id`,
      [userId, householdId]
    );
    const cleanTwo = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, status, source)
       VALUES ($1, $2, 'Amazon', 18.99, '2026-03-02', 'confirmed', 'email')
       RETURNING id`,
      [userId, householdId]
    );
    const cleanThree = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, status, source)
       VALUES ($1, $2, 'Amazon', 21.50, '2026-03-03', 'confirmed', 'email')
       RETURNING id`,
      [userId, householdId]
    );
    await db.query(
      `INSERT INTO email_import_log (user_id, message_id, expense_id, status, from_address)
       VALUES
         ($1, 'trusted-1', $2, 'imported', 'orders@amazon.com'),
         ($1, 'trusted-2', $3, 'imported', 'orders@amazon.com'),
         ($1, 'trusted-3', $4, 'imported', 'orders@amazon.com')`,
      [userId, cleanOne.rows[0].id, cleanTwo.rows[0].id, cleanThree.rows[0].id]
    );
    await db.query(
      `INSERT INTO email_import_feedback (expense_id, review_action, review_changed_fields, review_edit_count)
       VALUES
         ($1, 'approved', '["review_path_quick_check"]'::jsonb, 0),
         ($2, 'approved', '["review_path_quick_check"]'::jsonb, 0),
         ($3, 'approved', '["merchant","review_path_full_review"]'::jsonb, 1)`,
      [cleanOne.rows[0].id, cleanTwo.rows[0].id, cleanThree.rows[0].id]
    );

    listRecentMessages.mockResolvedValue([{ id: 'trusted-msg' }]);
    getMessage.mockResolvedValue({
      subject: 'Order Confirmation',
      from: 'orders@amazon.com',
      body: 'Total: $29.99',
      snippet: 'Total: $29.99',
      receivedAt: '2026-03-21',
    });
    classifyEmailExpense.mockResolvedValue({ disposition: 'expense', merchant: 'Amazon', reason: 'receipt' });
    parseEmailExpense.mockResolvedValue({
      merchant: 'Amazon',
      amount: 29.99,
      date: '2026-03-21',
      notes: 'Imported from Gmail (needs review)',
    });
    assignCategory.mockResolvedValue({ category_id: null });

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.outcomes.imported_parsed).toBe(0);
    expect(res.body.outcomes.imported_pending_review).toBe(1);

    const expense = await db.query(
      `SELECT status, notes FROM expenses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    expect(expense.rows[0].status).toBe('pending');
    expect(expense.rows[0].notes).toMatch(/imported from gmail/i);
    expect(expense.rows[0].notes).toMatch(/needs review/i);
  });

  it('keeps high-trust fast-lane Gmail imports in pending with quick-check routing', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );

    const cleanOne = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, status, source)
       VALUES ($1, $2, 'Amazon', 12.34, '2026-03-01', 'confirmed', 'email')
       RETURNING id`,
      [userId, householdId]
    );
    const cleanTwo = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, status, source)
       VALUES ($1, $2, 'Amazon', 18.99, '2026-03-02', 'confirmed', 'email')
       RETURNING id`,
      [userId, householdId]
    );
    const cleanThree = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, status, source)
       VALUES ($1, $2, 'Amazon', 21.50, '2026-03-03', 'confirmed', 'email')
       RETURNING id`,
      [userId, householdId]
    );
    await db.query(
      `INSERT INTO email_import_log (user_id, message_id, expense_id, status, from_address)
       VALUES
         ($1, 'fast-1', $2, 'imported', 'orders@amazon.com'),
         ($1, 'fast-2', $3, 'imported', 'orders@amazon.com'),
         ($1, 'fast-3', $4, 'imported', 'orders@amazon.com')`,
      [userId, cleanOne.rows[0].id, cleanTwo.rows[0].id, cleanThree.rows[0].id]
    );
    await db.query(
      `INSERT INTO email_import_feedback (expense_id, review_action, review_changed_fields, review_edit_count)
       VALUES
         ($1, 'approved', '["review_path_quick_check"]'::jsonb, 0),
         ($2, 'approved', '["review_path_quick_check"]'::jsonb, 0),
         ($3, 'approved', '["review_path_quick_check"]'::jsonb, 0)`,
      [cleanOne.rows[0].id, cleanTwo.rows[0].id, cleanThree.rows[0].id]
    );

    listRecentMessages.mockResolvedValue([{ id: 'fast-lane-msg' }]);
    getMessage.mockResolvedValue({
      subject: 'Order Confirmation',
      from: 'orders@amazon.com',
      body: 'Total: $29.99',
      snippet: 'Total: $29.99',
      receivedAt: '2026-03-21',
    });
    classifyEmailExpense.mockResolvedValue({ disposition: 'expense', merchant: 'Amazon', reason: 'receipt' });
    parseEmailExpense.mockResolvedValue({
      merchant: 'Amazon',
      amount: 29.99,
      date: '2026-03-21',
      notes: 'Imported from Gmail',
    });
    assignCategory.mockResolvedValue({ category_id: null });

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.outcomes.imported_auto_confirmed).toBe(0);
    expect(res.body.outcomes.imported_fast_lane).toBe(1);
    expect(res.body.outcomes.imported_pending_review).toBe(1);

    const expense = await db.query(
      `SELECT status, notes FROM expenses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    expect(expense.rows[0].status).toBe('pending');
    expect(expense.rows[0].notes).toMatch(/imported from gmail/i);
  });

  it('surfaces classifier false negatives when the email still has strong transaction signals', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );

    listRecentMessages.mockResolvedValue([{ id: 'borderline-msg' }]);
    getMessage.mockResolvedValue({
      subject: 'Your reservation is confirmed',
      from: 'receipts@booking.com',
      body: 'Reservation details. Total charged: $184.22. View in browser.',
      snippet: 'Total charged: $184.22',
      receivedAt: '2026-03-21',
    });
    classifyEmailExpense.mockResolvedValue({ disposition: 'not_expense', merchant: null, reason: 'classifier_not_expense' });
    analyzeEmailSignals.mockReturnValue({ shouldSurfaceToReview: true });
    parseEmailExpense.mockResolvedValue(null);
    assignCategory.mockResolvedValue({ category_id: null });

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(0);
    expect(res.body.outcomes.imported_pending_review).toBe(1);
  });

  it('skips likely duplicate expenses even when the Gmail message id is different', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );
    await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, status, source, notes)
       VALUES ($1, $2, 'Amazon', 29.99, '2026-03-21', 'pending', 'email', 'Existing import')`,
      [userId, householdId]
    );

    listRecentMessages.mockResolvedValue([{ id: 'new-msg-duplicate' }]);
    getMessage.mockResolvedValue({
      subject: 'Order Confirmation',
      from: 'orders@amazon.com',
      body: 'Order total: $29.99',
      snippet: 'Order total: $29.99',
      receivedAt: '2026-03-21',
    });
    classifyEmailExpense.mockResolvedValue({ disposition: 'expense', merchant: 'Amazon', reason: 'receipt' });
    parseEmailExpense.mockResolvedValue({ merchant: 'Amazon', amount: 29.99, date: '2026-03-21', notes: 'Order #123' });
    assignCategory.mockResolvedValue({ category_id: null });

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.skipped).toBe(1);
    expect(res.body.outcomes.skipped_reasons.duplicate_expense).toBe(1);
  });

  it('clamps parsed future dates to the email received date', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );

    listRecentMessages.mockResolvedValue([{ id: 'future-date-msg' }]);
    getMessage.mockResolvedValue({
      subject: 'Order Confirmation',
      from: 'orders@amazon.com',
      body: 'Order total: $29.99. Estimated delivery: April 7.',
      snippet: 'Estimated delivery April 7',
      receivedAt: '2026-04-03',
    });
    classifyEmailExpense.mockResolvedValue({ disposition: 'expense', merchant: 'Amazon', reason: 'receipt' });
    parseEmailExpense.mockResolvedValue({
      merchant: 'Amazon',
      amount: 29.99,
      date: '2026-04-07',
      notes: 'Order #123. Estimated delivery April 7.',
    });
    assignCategory.mockResolvedValue({ category_id: null });

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);

    const expense = await db.query(`SELECT date FROM expenses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId]);
    expect(expense.rows[0].date.toISOString().split('T')[0]).toBe('2026-04-03');
  });

  it('enriches location for in-person-like Gmail receipts', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );

    listRecentMessages.mockResolvedValue([{ id: 'store-receipt-msg' }]);
    getMessage.mockResolvedValue({
      subject: 'Your receipt from Trader Joe\'s',
      from: 'receipts@traderjoes.com',
      body: 'Thanks for shopping with us today. Store #104. 123 Main St, Brooklyn, NY 11201. Total: $29.99',
      snippet: '123 Main St, Brooklyn, NY 11201',
      receivedAt: '2026-04-04',
    });
    classifyEmailExpense.mockResolvedValue({ disposition: 'expense', merchant: 'Trader Joe\'s', reason: 'receipt' });
    parseEmailExpense.mockResolvedValue({ merchant: 'Trader Joe\'s', amount: 29.99, date: '2026-04-04', notes: null });
    classifyEmailModality.mockReturnValue('in_person');
    extractEmailLocationCandidate.mockReturnValue({
      address: '123 Main St, Brooklyn, NY 11201',
      city_state: 'Brooklyn, NY 11201',
      store_number: '104',
    });
    searchPlace.mockResolvedValue({
      place_name: 'Trader Joe\'s',
      address: '123 Main St, Brooklyn, NY 11201',
      mapkit_stable_id: '40.0000,-73.0000',
    });
    assignCategory.mockResolvedValue({ category_id: null });

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);

    const expense = await db.query(
      `SELECT place_name, address, mapkit_stable_id
       FROM expenses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    expect(expense.rows[0]).toMatchObject({
      place_name: 'Trader Joe\'s',
      address: '123 Main St, Brooklyn, NY 11201',
      mapkit_stable_id: '40.0000,-73.0000',
    });
  });
});

describe('GET /gmail/import-summary', () => {
  it('returns recent aggregate import outcomes', async () => {
    const importedExpense = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, status, source, notes, review_required, review_source)
       VALUES ($1, $2, 'Example', 12.34, '2026-03-21', 'pending', 'email', 'Imported from Gmail — needs review', TRUE, 'gmail')
       RETURNING id`,
      [userId, householdId]
    );

    await db.query(
      `INSERT INTO email_import_log (user_id, message_id, expense_id, status, skip_reason)
       VALUES
         ($1, 'summary-imported', $2, 'imported', NULL),
         ($1, 'summary-skipped', NULL, 'skipped', 'classifier_uncertain'),
         ($1, 'summary-failed', NULL, 'failed', 'Network error')`,
      [userId, importedExpense.rows[0].id]
    );

    const res = await request(app).get('/gmail/import-summary?days=30');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      window_days: 30,
      imported: 1,
      imported_pending_review: 1,
      current_pending_review: 1,
      skipped: 1,
      failed: 1,
      reviewed_approved: 0,
      reviewed_dismissed: 0,
      reviewed_edited: 0,
      quality: {
        total_reviewed: 0,
        clean_approved: 0,
        approved_after_changes: 0,
        dismissed: 0,
        edited: 0,
        clean_import_rate: 0,
        review_rate: 0,
        dismissal_rate: 0,
        edit_rate: 0,
      },
    });
    expect(res.body.current_review_mode_breakdown).toEqual(expect.objectContaining({
      quick_check: expect.any(Number),
      items_first: expect.any(Number),
      full_review: expect.any(Number),
    }));
    expect(res.body.last_imported_at).toBeTruthy();
    expect(res.body.last_synced_at).toBeNull();
    expect(res.body.last_sync_attempted_at).toBeNull();
    expect(res.body.last_sync_error_at).toBeNull();
    expect(res.body.last_sync_error).toBeNull();
    expect(res.body.last_sync_source).toBeNull();
    expect(res.body.last_sync_status).toBeNull();
    expect(res.body.reasons).toEqual(expect.arrayContaining([
      { reason: 'Network error', count: 1 },
      { reason: 'classifier_uncertain', count: 1 },
    ]));
    expect(res.body.changed_fields).toEqual([]);
    expect(Array.isArray(res.body.quality.sender_quality)).toBe(true);
    expect(res.body.debug).toMatchObject({
      sender_level_counts: {
        trusted: expect.any(Number),
        mixed: expect.any(Number),
        noisy: expect.any(Number),
        unknown: expect.any(Number),
      },
    });
    expect(Array.isArray(res.body.debug.top_corrected_senders)).toBe(true);
    expect(Array.isArray(res.body.debug.top_corrected_fields)).toBe(true);
  });
});
