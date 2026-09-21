jest.mock('../../src/models/user', () => ({ findByProviderUid: jest.fn() }));
jest.mock('../../src/models/emailImportLog', () => ({ findByIdForUser: jest.fn(), listReviewHistory: jest.fn() }));
jest.mock('../../src/services/gmailImporter', () => ({ reviewSkippedImportLog: jest.fn(), retryFailedImportLog: jest.fn() }));
jest.mock('../../src/services/gmailClient', () => ({ getMessage: jest.fn() }));
jest.mock('../../src/services/gmailImportQualityService', () => ({}));
jest.mock('../../src/services/gmailImportHealthService', () => ({}));

const router = require('../../src/routes/gmail');
const User = require('../../src/models/user');
const Log = require('../../src/models/emailImportLog');
const { getMessage } = require('../../src/services/gmailClient');
const { reviewSkippedImportLog, retryFailedImportLog } = require('../../src/services/gmailImporter');
const id = '00000000-0000-4000-8000-000000000001';

async function invoke(path, { params = { id }, query = {} } = {}) {
  const handler = router.stack.find((layer) => layer.route?.path === path).route.stack.at(-1).handle;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis() };
  const next = jest.fn();
  await handler({ userId: 'provider-1', params, query }, res, next);
  return { res, next };
}

beforeEach(() => {
  jest.resetAllMocks();
  User.findByProviderUid.mockResolvedValue({ id: 'user-1' });
  Log.findByIdForUser.mockResolvedValue({ id, status: 'skipped', message_id: 'message-1' });
});

it('scopes history to the authenticated user and defaults to potential misses', async () => {
  Log.listReviewHistory.mockResolvedValue({ entries: [], next_cursor: null });
  const { res } = await invoke('/review-history');
  expect(Log.listReviewHistory).toHaveBeenCalledWith('user-1', { filter: 'potential', cursor: null });
  expect(res.json).toHaveBeenCalledWith({ entries: [], next_cursor: null });
});

it.each([{ filter: 'invalid' }, { cursor: 'invalid' }])('rejects invalid history parameters', async (query) => {
  const { res } = await invoke('/review-history', { query });
  expect(res.status).toHaveBeenCalledWith(400);
  expect(Log.listReviewHistory).not.toHaveBeenCalled();
});

it.each(['/import-log/:id/context', '/import-log/:id/review'])('does not access an unowned email through %s', async (path) => {
  Log.findByIdForUser.mockResolvedValue(null);
  const { res } = await invoke(path);
  expect(Log.findByIdForUser).toHaveBeenCalledWith(id, 'user-1');
  expect(res.status).toHaveBeenCalledWith(404);
  expect(getMessage).not.toHaveBeenCalled();
  expect(reviewSkippedImportLog).not.toHaveBeenCalled();
});

it('returns only email preview fields and disables caching', async () => {
  getMessage.mockResolvedValue({ subject: 'Receipt', from: 'orders@shop.com', snippet: 'Total $12', receivedAt: '2026-09-20', body: 'Private full message body' });
  const { res } = await invoke('/import-log/:id/context');
  expect(getMessage).toHaveBeenCalledWith('user-1', 'message-1');
  expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(res.json).toHaveBeenCalledWith({ subject: 'Receipt', from_address: 'orders@shop.com', snippet: 'Total $12', received_at: '2026-09-20' });
});

it('recovers skips and returns safe error text without internal exception details', async () => {
  reviewSkippedImportLog.mockResolvedValue({ failed: 1, error: new Error('secret internal detail') });
  const { res } = await invoke('/import-log/:id/review');
  expect(reviewSkippedImportLog).toHaveBeenCalled();
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('secret internal detail');
  expect(retryFailedImportLog).not.toHaveBeenCalled();
});

it('routes error retries without changing filtering feedback', async () => {
  Log.findByIdForUser.mockResolvedValue({ id, status: 'failed', message_id: 'message-1' });
  retryFailedImportLog.mockResolvedValue({ imported: 1 });
  const { res } = await invoke('/import-log/:id/review');
  expect(retryFailedImportLog).toHaveBeenCalled();
  expect(reviewSkippedImportLog).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ imported: 1 });
});
