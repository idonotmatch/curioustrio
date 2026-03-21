const request = require('supertest');
const db = require('../../src/db');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => { req.auth0Id = 'test-auth0-gmail'; next(); }
}));
jest.mock('../../src/services/gmailClient', () => ({
  getAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?...'),
  exchangeCode: jest.fn(),
  listRecentMessages: jest.fn(),
  getMessage: jest.fn(),
}));
jest.mock('../../src/services/emailParser', () => ({
  parseEmailExpense: jest.fn(),
}));
jest.mock('../../src/services/categoryAssigner', () => ({
  assignCategory: jest.fn(),
}));

const app = require('../../src/index');
const { exchangeCode, listRecentMessages, getMessage } = require('../../src/services/gmailClient');
const { parseEmailExpense } = require('../../src/services/emailParser');
const { assignCategory } = require('../../src/services/categoryAssigner');

let householdId;
let userId;

beforeAll(async () => {
  const hhResult = await db.query(
    `INSERT INTO households (name) VALUES ('Gmail Test Household') RETURNING id`
  );
  householdId = hhResult.rows[0].id;

  const userResult = await db.query(
    `INSERT INTO users (auth0_id, name, email, household_id)
     VALUES ('test-auth0-gmail', 'Gmail Test User', 'gmail-test@test.com', $1)
     ON CONFLICT (auth0_id) DO UPDATE SET household_id = $1 RETURNING id`,
    [householdId]
  );
  userId = userResult.rows[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM email_import_log WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM oauth_tokens WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM expenses WHERE user_id = $1`, [userId]);
  await db.query(`UPDATE users SET household_id = NULL WHERE auth0_id = 'test-auth0-gmail'`);
  await db.query(`DELETE FROM households WHERE id = $1`, [householdId]);
});

beforeEach(async () => {
  exchangeCode.mockReset();
  listRecentMessages.mockReset();
  getMessage.mockReset();
  parseEmailExpense.mockReset();
  assignCategory.mockReset();
  // Clean state between tests
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
       VALUES ($1, 'google', 'acc_tok', 'ref_tok', 'gmail.readonly')`,
      [userId]
    );
    const res = await request(app).get('/gmail/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true });
  });
});

describe('GET /gmail/callback', () => {
  it('saves token, returns { connected: true }', async () => {
    exchangeCode.mockResolvedValue({
      accessToken: 'new_access',
      refreshToken: 'new_refresh',
      expiresAt: '2026-04-21T00:00:00.000Z',
      scope: 'gmail.readonly',
    });

    const res = await request(app).get(`/gmail/callback?code=auth_code_123&state=${userId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Gmail connected');
    expect(exchangeCode).toHaveBeenCalledWith('auth_code_123');

    const token = await db.query(`SELECT * FROM oauth_tokens WHERE user_id = $1`, [userId]);
    expect(token.rows).toHaveLength(1);
    expect(token.rows[0].access_token).toBe('new_access');
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
       VALUES ($1, 'google', 'acc_tok', 'ref_tok', 'gmail.readonly')`,
      [userId]
    );

    listRecentMessages.mockResolvedValue([
      { id: 'msg1' },
      { id: 'msg2' },
    ]);
    getMessage.mockResolvedValue({ subject: 'Order Confirmation', from: 'orders@amazon.com', body: 'Total: $29.99' });
    parseEmailExpense
      .mockResolvedValueOnce({ merchant: 'Amazon', amount: 29.99, date: '2026-03-21', notes: null })
      .mockResolvedValueOnce(null);
    assignCategory.mockResolvedValue({ category_id: null });

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(1);
    expect(res.body.failed).toBe(0);
  });

  it('skips already-imported messages', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', 'acc_tok', 'ref_tok', 'gmail.readonly')`,
      [userId]
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
  });

  it('counts failed when getMessage throws', async () => {
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
       VALUES ($1, 'google', 'acc_tok', 'ref_tok', 'gmail.readonly')`,
      [userId]
    );

    listRecentMessages.mockResolvedValue([{ id: 'fail-msg' }]);
    getMessage.mockRejectedValue(new Error('Network error'));

    const res = await request(app).post('/gmail/import');
    expect(res.status).toBe(200);
    expect(res.body.failed).toBe(1);
    expect(res.body.imported).toBe(0);
  });
});
