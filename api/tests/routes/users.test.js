const request = require('supertest');
const db = require('../../src/db');

const TEST_UUID = 'supabase-test-uuid-123';
const TEST_EMAIL = 'dang@test.com';

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = 'supabase-test-uuid-123';
    req.auth = { email: 'dang@test.com' };
    next();
  },
}));
jest.mock('../../src/services/gmailClient', () => ({
  disconnectGmailConnection: jest.fn().mockResolvedValue({ disconnected: true, revoked: false, had_token: false }),
}));

const app = require('../../src/index');
const { disconnectGmailConnection } = require('../../src/services/gmailClient');

afterAll(() => db.pool.end());

async function cleanup() {
  const users = await db.query(
    'SELECT id FROM users WHERE provider_uid = $1 OR email = $2',
    [TEST_UUID, TEST_EMAIL]
  );
  const userIds = users.rows.map((row) => row.id);

  if (userIds.length > 0) {
    await db.query('DELETE FROM push_tokens WHERE user_id = ANY($1::uuid[])', [userIds]);
    await db.query('DELETE FROM gmail_sender_preferences WHERE user_id = ANY($1::uuid[])', [userIds]);
    await db.query('DELETE FROM gmail_oauth_states WHERE user_id = ANY($1::uuid[])', [userIds]);
    await db.query('DELETE FROM oauth_tokens WHERE user_id = ANY($1::uuid[])', [userIds]);
    await db.query('DELETE FROM email_import_log WHERE user_id = ANY($1::uuid[])', [userIds]);
    await db.query('DELETE FROM expenses WHERE user_id = ANY($1::uuid[])', [userIds]);
  }
  await db.query(
    'DELETE FROM users WHERE provider_uid = $1 OR email = $2',
    [TEST_UUID, TEST_EMAIL]
  );
}

describe('POST /users/sync', () => {
  beforeEach(cleanup);

  it('creates a new user when no email or provider_uid match exists', async () => {
    const res = await request(app)
      .post('/users/sync')
      .send({ name: 'Dang Nguyen', email: TEST_EMAIL });

    expect(res.status).toBe(200);
    expect(res.body.auth_user_id).toBe(TEST_UUID);
    expect(res.body.name).toBe('Dang Nguyen');
    expect(res.body.email).toBe(TEST_EMAIL);
    expect(res.body.provider_uid).toBeUndefined();
  });

  it('updates provider_uid when email match found (migration path)', async () => {
    await db.query(
      "INSERT INTO users (provider_uid, name, email) VALUES ('old-auth0-id', 'Dang Nguyen', $1)",
      [TEST_EMAIL]
    );

    const res = await request(app)
      .post('/users/sync')
      .send({ name: 'Dang Nguyen', email: TEST_EMAIL });

    expect(res.status).toBe(200);
    expect(res.body.auth_user_id).toBe(TEST_UUID);
    expect(res.body.email).toBe(TEST_EMAIL);
  });

  it('returns existing user by provider_uid when no email provided (Apple re-auth)', async () => {
    await db.query(
      'INSERT INTO users (provider_uid, name, email) VALUES ($1, $2, $3)',
      [TEST_UUID, 'Dang Nguyen', TEST_EMAIL]
    );

    const res = await request(app)
      .post('/users/sync')
      .send({ name: 'Dang Nguyen' }); // no email

    expect(res.status).toBe(200);
    expect(res.body.auth_user_id).toBe(TEST_UUID);
  });

  it('creates new user when no email and no provider_uid match', async () => {
    const res = await request(app)
      .post('/users/sync')
      .send({ name: 'New Apple User' });

    expect(res.status).toBe(200);
    expect(res.body.auth_user_id).toBe(TEST_UUID);
  });

  it('rejects syncing an email that does not match the authenticated token', async () => {
    const res = await request(app)
      .post('/users/sync')
      .send({ name: 'Dang Nguyen', email: 'someoneelse@test.com' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/does not match/i);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/users/sync')
      .send({ email: TEST_EMAIL });

    expect(res.status).toBe(400);
  });
});

describe('GET /users/me', () => {
  beforeEach(cleanup);

  it('returns the current user', async () => {
    await db.query(
      'INSERT INTO users (provider_uid, name, email) VALUES ($1, $2, $3)',
      [TEST_UUID, 'Dang Nguyen', TEST_EMAIL]
    );

    const res = await request(app).get('/users/me');

    expect(res.status).toBe(200);
    expect(res.body.auth_user_id).toBe(TEST_UUID);
    expect(res.body.provider_uid).toBeUndefined();
  });

  it('returns 404 when user not found', async () => {
    const res = await request(app).get('/users/me');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /users/settings', () => {
  beforeEach(cleanup);

  it('updates push notification preferences', async () => {
    await db.query(
      'INSERT INTO users (provider_uid, name, email) VALUES ($1, $2, $3)',
      [TEST_UUID, 'Dang Nguyen', TEST_EMAIL]
    );

    const res = await request(app)
      .patch('/users/settings')
      .send({
        push_gmail_review_enabled: false,
        push_insights_enabled: true,
        push_recurring_enabled: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.push_gmail_review_enabled).toBe(false);
    expect(res.body.push_insights_enabled).toBe(true);
    expect(res.body.push_recurring_enabled).toBe(false);
  });

  it('returns 400 for non-boolean push settings', async () => {
    await db.query(
      'INSERT INTO users (provider_uid, name, email) VALUES ($1, $2, $3)',
      [TEST_UUID, 'Dang Nguyen', TEST_EMAIL]
    );

    const res = await request(app)
      .patch('/users/settings')
      .send({ push_insights_enabled: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/push_insights_enabled must be a boolean/i);
  });
});

describe('DELETE /users/me', () => {
  beforeEach(async () => {
    await cleanup();
    disconnectGmailConnection.mockClear();
  });

  it('deletes the current user and their app data', async () => {
    await db.query(
      'INSERT INTO users (provider_uid, name, email) VALUES ($1, $2, $3)',
      [TEST_UUID, 'Dang Nguyen', TEST_EMAIL]
    );
    const user = await db.query('SELECT id FROM users WHERE provider_uid = $1', [TEST_UUID]);
    const userId = user.rows[0].id;

    await db.query(
      `INSERT INTO expenses (user_id, merchant, amount, date, source, status)
       VALUES ($1, 'Whole Foods', 19.84, '2026-04-27', 'manual', 'confirmed')`,
      [userId]
    );
    await db.query(
      `INSERT INTO email_import_log (user_id, message_id, status)
       VALUES ($1, 'delete-me-message', 'imported')`,
      [userId]
    );
    await db.query(
      `INSERT INTO push_tokens (user_id, token, platform)
       VALUES ($1, 'ExponentPushToken[test-delete]', 'ios')`,
      [userId]
    );
    await db.query(
      `INSERT INTO oauth_tokens (user_id, provider, refresh_token, scope)
       VALUES ($1, 'google', 'encrypted-placeholder', 'gmail.readonly')`,
      [userId]
    );

    const res = await request(app).delete('/users/me');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    expect(disconnectGmailConnection).toHaveBeenCalledWith(userId);

    const userCheck = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
    const expenseCheck = await db.query('SELECT id FROM expenses WHERE user_id = $1', [userId]);
    const logCheck = await db.query('SELECT id FROM email_import_log WHERE user_id = $1', [userId]);
    const pushCheck = await db.query('SELECT id FROM push_tokens WHERE user_id = $1', [userId]);
    const tokenCheck = await db.query('SELECT id FROM oauth_tokens WHERE user_id = $1', [userId]);

    expect(userCheck.rowCount).toBe(0);
    expect(expenseCheck.rowCount).toBe(0);
    expect(logCheck.rowCount).toBe(0);
    expect(pushCheck.rowCount).toBe(0);
    expect(tokenCheck.rowCount).toBe(0);
  });
});
