jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => { req.userId = 'cors-test-user'; next(); },
}));

const request = require('supertest');
const app = require('../../src/index');

describe('CORS', () => {
  it('does not return wildcard Access-Control-Allow-Origin for unknown origins', async () => {
    const res = await request(app)
      .get('/expenses')
      .set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('allows requests with no origin (mobile apps, server-to-server)', async () => {
    const res = await request(app).get('/expenses');
    expect(res.status).not.toBe(403);
  });
});
