jest.mock('jwks-rsa', () => {
  return jest.fn(() => ({
    getSigningKey: jest.fn(),
  }));
});

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn((token, getKey, options, callback) => {
    callback(null, { sub: 'auth0|test-user-123' });
  }),
}));

const { authenticate } = require('../../src/middleware/auth');

describe('authenticate middleware', () => {
  it('returns 401 when no Authorization header', async () => {
    const req = { headers: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.auth0Id when token is valid', async () => {
    const req = { headers: { authorization: 'Bearer valid-token' } };
    const res = {};
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(req.auth0Id).toBe('auth0|test-user-123');
    expect(next).toHaveBeenCalled();
  });
});
