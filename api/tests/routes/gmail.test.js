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
jest.mock('../../src/services/emailParser', () => ({
  classifyEmailExpense: jest.fn(),
  parseEmailExpense: jest.fn(),
}));
jest.mock('../../src/services/categoryAssigner', () => ({
  assignCategory: jest.fn(),
}));

const app = require('../../src/index');
const { exchangeCode, listRecentMessages, getMessage } = require('../../src/services/gmailClient');
const { classifyEmailExpense, parseEmailExpense } = require('../../src/services/emailParser');
const { assignCategory } = require('../../src/services/categoryAssigner');

let householdId;
let userId;

beforeAll(async () => {
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
  classifyEmailExpense.mockReset();
  assignCategory.mockReset();
  // Clean state between tests
  await db.query(`DELETE FROM gmail_oauth_states WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM email_import_log WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM oauth_tokens WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM expenses WHERE user_id = $1`, [userId]);
});

describe('GET /gmail/status', () => {
  it('returns { connected: false } when no token', async () => {
    const res = await request(app).get('/gmail/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
  });

  it('returns { connected: true } when token exists', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`,
      [userId, encrypt('ref_tok')]
    );
    const res = await request(app).get('/gmail/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true });
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
    getMessage.mockResolvedValue({ subject: 'Order Confirmation', from: 'orders@amazon.com', body: 'Total: $29.99' });
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
      imported_parsed: 1,
      imported_pending_review: 0,
      skipped_existing: 0,
      skipped_reasons: { classifier_not_expense: 1 },
    });
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
    expect(expense.rows[0].notes).toMatch(/needs review/i);
  });
});

describe('GET /gmail/import-summary', () => {
  it('returns recent aggregate import outcomes', async () => {
    const importedExpense = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, status, source, notes)
       VALUES ($1, $2, 'Example', 12.34, '2026-03-21', 'pending', 'email', 'Imported from Gmail — needs review')
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
      skipped: 1,
      failed: 1,
    });
    expect(res.body.last_imported_at).toBeTruthy();
    expect(res.body.reasons).toEqual(expect.arrayContaining([
      { reason: 'Network error', count: 1 },
      { reason: 'classifier_uncertain', count: 1 },
    ]));
  });
});
