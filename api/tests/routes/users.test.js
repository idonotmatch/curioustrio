const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

const TEST_UUID = 'supabase-test-uuid-123';
const TEST_EMAIL = 'dang@test.com';

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = 'supabase-test-uuid-123';
    next();
  },
}));

afterAll(() => db.pool.end());

async function cleanup() {
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
    expect(res.body.provider_uid).toBe(TEST_UUID);
    expect(res.body.name).toBe('Dang Nguyen');
    expect(res.body.email).toBe(TEST_EMAIL);
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
    expect(res.body.provider_uid).toBe(TEST_UUID);
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
    expect(res.body.provider_uid).toBe(TEST_UUID);
  });

  it('creates new user when no email and no provider_uid match', async () => {
    const res = await request(app)
      .post('/users/sync')
      .send({ name: 'New Apple User' });

    expect(res.status).toBe(200);
    expect(res.body.provider_uid).toBe(TEST_UUID);
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
    expect(res.body.provider_uid).toBe(TEST_UUID);
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
