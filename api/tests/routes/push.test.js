const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = 'auth0|test-push-user';
    next();
  },
}));

jest.mock('../../src/services/pushService', () => ({
  sendNotifications: jest.fn().mockResolvedValue([]),
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

  it('returns 400 when token is missing', async () => {
    const res = await request(app)
      .post('/push/register')
      .send({ platform: 'ios' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token and platform required/i);
  });

  it('returns 400 when platform is missing', async () => {
    const res = await request(app)
      .post('/push/register')
      .send({ token: 'ExponentPushToken[test-token-123]' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token and platform required/i);
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
