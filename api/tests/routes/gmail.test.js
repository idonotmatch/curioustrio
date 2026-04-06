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
jest.mock('../../src/services/emailParser', () => ({
  classifyEmailExpense: jest.fn(),
  parseEmailExpense: jest.fn(),
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
const { classifyEmailExpense, parseEmailExpense, analyzeEmailSignals, classifyEmailModality, extractEmailLocationCandidate } = require('../../src/services/emailParser');
const { assignCategory } = require('../../src/services/categoryAssigner');
const { searchPlace } = require('../../src/services/mapkitService');

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
  classifyEmailExpense.mockReset();
  analyzeEmailSignals.mockReset();
  analyzeEmailSignals.mockReturnValue({ shouldSurfaceToReview: false });
  classifyEmailModality.mockReset();
  classifyEmailModality.mockReturnValue('online');
  extractEmailLocationCandidate.mockReset();
  extractEmailLocationCandidate.mockReturnValue(null);
  searchPlace.mockReset();
  searchPlace.mockResolvedValue(null);
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
    expect(res.body).toEqual({ connected: false, last_synced_at: null });
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
    expect(res.body.last_synced_at).toBeNull();
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
      imported_parsed: 1,
      imported_pending_review: 0,
      skipped_existing: 0,
      skipped_reasons: { classifier_not_expense: 1 },
    });
    const token = await db.query(`SELECT last_synced_at FROM oauth_tokens WHERE user_id = $1`, [userId]);
    expect(token.rows[0].last_synced_at).toBeTruthy();
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
    expect(expense.rows[0].notes).toMatch(/Your order details/i);
    expect(expense.rows[0].notes).toMatch(/needs review/i);
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

  it('reduces unnecessary review notes for trusted senders', async () => {
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
         ($1, 'approved', '[]'::jsonb, 0),
         ($2, 'approved', '[]'::jsonb, 0),
         ($3, 'approved', '["merchant"]'::jsonb, 1)`,
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
    expect(res.body.outcomes.imported_parsed).toBe(1);
    expect(res.body.outcomes.imported_pending_review).toBe(0);

    const expense = await db.query(
      `SELECT notes FROM expenses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    expect(expense.rows[0].notes).toMatch(/imported from gmail/i);
    expect(expense.rows[0].notes).not.toMatch(/needs review/i);
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
    expect(res.body.last_imported_at).toBeTruthy();
    expect(res.body.last_synced_at).toBeNull();
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
