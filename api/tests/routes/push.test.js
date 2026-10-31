const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');
const PushToken = require('../../src/models/pushToken');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = 'auth0|test-push-user';
    next();
  },
}));

jest.mock('../../src/services/pushService', () => ({
  sendNotifications: jest.fn().mockResolvedValue({ accepted: 1, rejected: 0 }),
}));

let householdId;
let userId;

beforeAll(async () => {
  const hhResult = await db.query(
    `INSERT INTO households (name) VALUES ('Push Route Test Household') RETURNING id`
  );
  householdId = hhResult.rows[0].id;

  const userResult = await db.query(
    `INSERT INTO users (provider_uid, name, email, household_id)
     VALUES ('auth0|test-push-user', 'Push User', 'push@test.com', $1)
     ON CONFLICT (provider_uid) DO UPDATE SET household_id = $1
     RETURNING id`,
    [householdId]
  );
  userId = userResult.rows[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM push_tokens WHERE user_id = $1`, [userId]);
  await db.query(`UPDATE users SET household_id = NULL WHERE provider_uid = 'auth0|test-push-user'`);
  await db.query(`DELETE FROM households WHERE id = $1`, [householdId]);
});

afterEach(async () => {
  await db.query(`DELETE FROM push_tokens WHERE user_id = $1`, [userId]);
});

describe('POST /push/register', () => {
  it('registers a push token (204)', async () => {
    const res = await request(app)
      .post('/push/register')
      .send({ token: 'ExponentPushToken[test-token-123]', platform: 'ios' });

    expect(res.status).toBe(204);
  });

  it('stores the device timezone while registering', async () => {
    const res = await request(app)
      .post('/push/register')
      .send({
        token: 'ExpoPushToken[timezone-token]',
        platform: 'ios',
        timezone: 'America/New_York',
      });

    expect(res.status).toBe(204);
    const user = await db.query('SELECT notification_timezone FROM users WHERE id = $1', [userId]);
    expect(user.rows[0].notification_timezone).toBe('America/New_York');
  });

  it('returns 400 when token is missing', async () => {
    const res = await request(app)
      .post('/push/register')
      .send({ platform: 'ios' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid Expo token and platform required/i);
  });

  it('returns 400 when platform is missing', async () => {
    const res = await request(app)
      .post('/push/register')
      .send({ token: 'ExponentPushToken[test-token-123]' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid Expo token and platform required/i);
  });

  it('rejects malformed Expo tokens', async () => {
    const res = await request(app)
      .post('/push/register')
      .send({ token: 'not-a-push-token', platform: 'ios' });

    expect(res.status).toBe(400);
  });

  it('unregisters the current account token on sign-out', async () => {
    const token = 'ExponentPushToken[logout-token]';
    await request(app).post('/push/register').send({ token, platform: 'ios' });

    const res = await request(app).post('/push/unregister').send({ token });

    expect(res.status).toBe(204);
    const stored = await db.query('SELECT id FROM push_tokens WHERE token = $1', [token]);
    expect(stored.rowCount).toBe(0);
  });

  it('moves a physical device token to the currently signed-in account', async () => {
    const other = await db.query(
      `INSERT INTO users (provider_uid, name, email)
       VALUES ('push-token-owner-two', 'Second Push User', 'push-two@test.com')
       RETURNING id`
    );
    const token = 'ExponentPushToken[shared-device-token]';

    await PushToken.upsert({ userId, token, platform: 'ios' });
    await PushToken.upsert({ userId: other.rows[0].id, token, platform: 'ios' });

    const stored = await db.query('SELECT user_id FROM push_tokens WHERE token = $1', [token]);
    expect(stored.rows).toEqual([{ user_id: other.rows[0].id }]);
    await db.query('DELETE FROM users WHERE id = $1', [other.rows[0].id]);
  });
});

describe('POST /push/notify-pending', () => {
  it('returns { sent: 0 } when user has no push tokens', async () => {
    const res = await request(app)
      .post('/push/notify-pending')
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: 0 });
  });

  it('returns 403 when user has no household', async () => {
    await db.query(
      `UPDATE users SET household_id = NULL WHERE provider_uid = 'auth0|test-push-user'`
    );

    const res = await request(app)
      .post('/push/notify-pending')
      .send();

    await db.query(
      `UPDATE users SET household_id = $1 WHERE provider_uid = 'auth0|test-push-user'`,
      [householdId]
    );

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/household/i);
  });
});
