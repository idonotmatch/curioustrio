jest.mock('../../src/models/user', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/oauthToken', () => ({
  findAllWithGmail: jest.fn(),
  markSyncAttempt: jest.fn(),
  markSyncQueued: jest.fn(),
  markSynced: jest.fn(),
  markSyncPartial: jest.fn(),
  markSyncFailure: jest.fn(),
}));
jest.mock('../../src/models/backgroundJob', () => ({
  JOB_TYPES: { gmailSync: 'gmail_sync' },
  enqueue: jest.fn(),
}));
jest.mock('../../src/services/gmailImporter', () => ({ importForUser: jest.fn() }));

const User = require('../../src/models/user');
const OAuthToken = require('../../src/models/oauthToken');
const BackgroundJob = require('../../src/models/backgroundJob');
const { importForUser } = require('../../src/services/gmailImporter');
const {
  partialSyncMessage,
  recordGmailSyncResult,
  runGmailSyncJob,
  runScheduledGmailSync,
} = require('../../src/services/gmailSyncService');

describe('gmailSyncService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    OAuthToken.findAllWithGmail.mockResolvedValue([]);
    OAuthToken.markSyncAttempt.mockResolvedValue({});
    OAuthToken.markSyncQueued.mockResolvedValue({});
    OAuthToken.markSynced.mockResolvedValue({});
    OAuthToken.markSyncPartial.mockResolvedValue({});
    OAuthToken.markSyncFailure.mockResolvedValue({});
    BackgroundJob.enqueue.mockImplementation(({ dedupeKey }) => Promise.resolve({ id: `job-${dedupeKey}` }));
  });

  it('records message-level failures as a partial sync with a compact reason summary', async () => {
    const result = {
      failed: 2,
      outcomes: { failed_reasons: { timeout: 1, rate_limited: 1 } },
    };

    await expect(recordGmailSyncResult('user-1', result, { source: 'manual' }))
      .resolves.toBe('partial');
    expect(OAuthToken.markSyncPartial).toHaveBeenCalledWith('user-1', {
      source: 'manual',
      error: expect.stringMatching(/2 message imports failed/),
    });
    expect(partialSyncMessage(result)).toContain('rate_limited:1');
    expect(OAuthToken.markSynced).not.toHaveBeenCalled();
  });

  it('queues every connected account without doing mailbox work in the cron request', async () => {
    OAuthToken.findAllWithGmail.mockResolvedValue(['user-1', 'user-2']);

    await expect(runScheduledGmailSync()).resolves.toMatchObject({
      ok: true,
      accepted: true,
      execution_pending: true,
      connected_accounts: 2,
      users_processed: 2,
      users_queued: 2,
      users_failed: 0,
    });
    expect(BackgroundJob.enqueue).toHaveBeenCalledTimes(2);
    expect(importForUser).not.toHaveBeenCalled();
  });

  it('makes queue failures visible to the scheduler', async () => {
    const onAccountError = jest.fn();
    OAuthToken.findAllWithGmail.mockResolvedValue(['queued-user', 'failed-user']);
    BackgroundJob.enqueue
      .mockResolvedValueOnce({ id: 'job-queued-user' })
      .mockRejectedValueOnce(new Error('queue unavailable'));

    const result = await runScheduledGmailSync({ onAccountError });

    expect(result).toMatchObject({
      ok: false,
      accepted: false,
      users_processed: 1,
      users_queued: 1,
      users_failed: 1,
      failure_reasons: { account_sync_failed: 1 },
    });
    expect(OAuthToken.markSyncFailure).toHaveBeenCalledWith('failed-user', expect.objectContaining({
      source: 'scheduler',
      error: 'queue unavailable',
    }));
    expect(onAccountError).toHaveBeenCalledWith(expect.any(Error), {
      phase: 'sync',
      userId: 'failed-user',
    });
  });

  it('records final status from a background Gmail sync job', async () => {
    User.findById.mockResolvedValue({ id: 'user-1', household_id: 'household-1' });
    importForUser.mockResolvedValue({ imported: 2, skipped: 1, failed: 0, outcomes: {} });

    await expect(runGmailSyncJob({ user_id: 'user-1', source: 'manual' })).resolves.toMatchObject({
      imported: 2,
      sync_status: 'success',
    });
    expect(OAuthToken.markSyncAttempt).toHaveBeenCalledWith('user-1', { source: 'manual' });
    expect(OAuthToken.markSynced).toHaveBeenCalledWith('user-1', { source: 'manual' });
  });
});
