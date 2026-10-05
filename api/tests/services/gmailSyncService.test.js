jest.mock('../../src/models/user', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/oauthToken', () => ({
  findAllWithGmail: jest.fn(),
  markSyncAttempt: jest.fn(),
  markSynced: jest.fn(),
  markSyncPartial: jest.fn(),
  markSyncFailure: jest.fn(),
}));
jest.mock('../../src/services/gmailImporter', () => ({ importForUser: jest.fn() }));

const User = require('../../src/models/user');
const OAuthToken = require('../../src/models/oauthToken');
const { importForUser } = require('../../src/services/gmailImporter');
const {
  partialSyncMessage,
  recordGmailSyncResult,
  runScheduledGmailSync,
} = require('../../src/services/gmailSyncService');

describe('gmailSyncService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    OAuthToken.findAllWithGmail.mockResolvedValue([]);
    OAuthToken.markSyncAttempt.mockResolvedValue({});
    OAuthToken.markSynced.mockResolvedValue({});
    OAuthToken.markSyncPartial.mockResolvedValue({});
    OAuthToken.markSyncFailure.mockResolvedValue({});
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

  it('returns a healthy scheduler summary when every connected account completes', async () => {
    OAuthToken.findAllWithGmail.mockResolvedValue(['user-1', 'user-2']);
    User.findById.mockImplementation((id) => Promise.resolve({ id, household_id: 'household-1' }));
    importForUser
      .mockResolvedValueOnce({ imported: 1, skipped: 2, failed: 0, outcomes: {} })
      .mockResolvedValueOnce({ imported: 0, skipped: 3, failed: 0, outcomes: {} });

    await expect(runScheduledGmailSync()).resolves.toMatchObject({
      ok: true,
      connected_accounts: 2,
      users_processed: 2,
      users_succeeded: 2,
      users_partial: 0,
      users_failed: 0,
      total_imported: 1,
      total_skipped: 5,
      total_failed: 0,
    });
  });

  it('makes partial imports and account failures visible to the scheduler', async () => {
    const onAccountError = jest.fn();
    OAuthToken.findAllWithGmail.mockResolvedValue(['partial-user', 'failed-user']);
    User.findById.mockImplementation((id) => Promise.resolve({ id, household_id: 'household-1' }));
    importForUser
      .mockResolvedValueOnce({
        imported: 1,
        skipped: 0,
        failed: 1,
        outcomes: { failed_reasons: { timeout: 1 } },
      })
      .mockRejectedValueOnce(new Error('invalid_grant'));

    const result = await runScheduledGmailSync({ onAccountError });

    expect(result).toMatchObject({
      ok: false,
      users_processed: 1,
      users_succeeded: 0,
      users_partial: 1,
      users_failed: 1,
      total_imported: 1,
      total_failed: 1,
      failure_reasons: { timeout: 1, account_sync_failed: 1 },
    });
    expect(OAuthToken.markSyncPartial).toHaveBeenCalled();
    expect(OAuthToken.markSyncFailure).toHaveBeenCalledWith('failed-user', expect.objectContaining({
      source: 'scheduler',
      error: 'invalid_grant',
    }));
    expect(onAccountError).toHaveBeenCalledWith(expect.any(Error), {
      phase: 'sync',
      userId: 'failed-user',
    });
  });
});
