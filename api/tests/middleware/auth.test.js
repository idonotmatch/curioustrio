jest.mock('jwks-rsa', () => {
  return jest.fn(() => ({
    getSigningKey: jest.fn((kid, cb) => {
      cb(null, { getPublicKey: () => 'mock-public-key' });
    }),
  }));
});

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const { authenticate } = require('../../src/middleware/auth');

describe('authenticate middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when no Authorization header', async () => {
    const req = { headers: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for non-Bearer authorization', async () => {
    const req = { headers: { authorization: 'Basic abc123' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('sets req.userId from decoded sub when token is valid', async () => {
    jwt.verify.mockImplementation((token, getKey, options, callback) => {
      callback(null, { sub: 'supabase-uuid-123' });
    });

    const req = { headers: { authorization: 'Bearer valid-token' } };
    const res = {};
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(req.userId).toBe('supabase-uuid-123');
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when token verification fails', async () => {
    jwt.verify.mockImplementation((token, getKey, options, callback) => {
      callback(new Error('invalid signature'), null);
    });

    const req = { headers: { authorization: 'Bearer bad-token' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
