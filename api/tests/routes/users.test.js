const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

// Mock auth middleware for tests
jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.auth0Id = 'auth0|test-user-123';
    next();
  },
}));

afterAll(() => db.pool.end());

describe('POST /users/sync', () => {
  it('creates a user on first login', async () => {
    const res = await request(app)
      .post('/users/sync')
      .send({ name: 'Dang Nguyen', email: 'dang@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.auth0_id).toBe('auth0|test-user-123');
    expect(res.body.name).toBe('Dang Nguyen');
  });

  it('returns existing user on subsequent logins', async () => {
    const res = await request(app)
      .post('/users/sync')
      .send({ name: 'Dang Nguyen', email: 'dang@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.auth0_id).toBe('auth0|test-user-123');
  });
});
