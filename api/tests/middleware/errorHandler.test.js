jest.mock('../../src/services/observability', () => ({ captureException: jest.fn() }));

const { errorHandler } = require('../../src/middleware/errorHandler');

describe('errorHandler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'production' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function response() {
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
  }

  it('hides unexpected server errors', () => {
    const res = response();
    errorHandler(new Error('database detail'), { requestId: 'request-1' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Internal server error',
      request_id: 'request-1',
    });
  });

  it('returns explicitly safe operational errors', () => {
    const res = response();
    const error = new Error('Account deletion is temporarily unavailable');
    error.status = 503;
    error.expose = true;

    errorHandler(error, { requestId: 'request-2' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Account deletion is temporarily unavailable',
      request_id: 'request-2',
    });
  });
});
