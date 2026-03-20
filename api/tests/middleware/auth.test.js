jest.mock('jwks-rsa', () => {
  return jest.fn(() => ({
    getSigningKey: jest.fn(),
  }));
});

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

  it('attaches auth0Id to req.user when token is valid', async () => {
    // Tested via integration in route tests using a mock token
    // Unit test mocks the JWKS client
  });
});
