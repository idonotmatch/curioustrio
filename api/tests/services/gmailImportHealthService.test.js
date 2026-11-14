jest.mock('../../src/models/oauthToken', () => ({
  findByUserId: jest.fn(),
}));
jest.mock('../../src/models/emailImportLog', () => ({
  listByUser: jest.fn(),
  findByMessageId: jest.fn(),
  summarizeByUser: jest.fn(),
}));
jest.mock('../../src/services/gmailClient', () => ({
  GMAIL_SEARCH_QUERY: 'newer_than:30d subject:(receipt OR invoice)',
  listRecentMessages: jest.fn(),
  getMessage: jest.fn(),
}));

const OAuthToken = require('../../src/models/oauthToken');
const EmailImportLog = require('../../src/models/emailImportLog');
const { listRecentMessages, getMessage } = require('../../src/services/gmailClient');
const { getGmailImportHealth } = require('../../src/services/gmailImportHealthService');

const user = { id: 'user-1', household_id: 'household-1' };

describe('gmailImportHealthService', () => {
  beforeEach(() => {
    OAuthToken.findByUserId.mockReset();
    EmailImportLog.listByUser.mockReset();
    EmailImportLog.findByMessageId.mockReset();
    EmailImportLog.summarizeByUser.mockReset();
    listRecentMessages.mockReset();
    getMessage.mockReset();
    EmailImportLog.listByUser.mockResolvedValue([]);
    EmailImportLog.summarizeByUser.mockResolvedValue({ amount_quality: {} });
  });

  it('returns disconnected recommendations without probing Gmail', async () => {
    OAuthToken.findByUserId.mockResolvedValue(null);

    const health = await getGmailImportHealth(user, { days: 14, limit: 10 });

    expect(health.connected).toBe(false);
    expect(health.probes.inbox.error).toMatch(/not connected/i);
    expect(health.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'gmail_disconnected', level: 'error' }),
    ]));
    expect(listRecentMessages).not.toHaveBeenCalled();
  });

  it('surfaces recent inbox messages with no import log', async () => {
    OAuthToken.findByUserId.mockResolvedValue({
      last_synced_at: new Date().toISOString(),
      last_sync_status: 'success',
    });
    EmailImportLog.listByUser.mockResolvedValue([
      {
        id: 'log-1',
        message_id: 'logged-inbox',
        status: 'imported',
        imported_at: new Date().toISOString(),
        expense_status: 'pending',
      },
    ]);
    listRecentMessages.mockImplementation((_userId, options = {}) => {
      if (`${options.query || ''}`.includes('in:inbox')) {
        return Promise.resolve([{ id: 'logged-inbox' }, { id: 'unlogged-inbox' }]);
      }
      return Promise.resolve([{ id: 'logged-inbox' }]);
    });
    EmailImportLog.findByMessageId.mockImplementation((_userId, messageId) => (
      Promise.resolve(messageId === 'logged-inbox'
        ? { message_id: messageId, status: 'imported', expense_status: 'pending' }
        : null)
    ));
    getMessage.mockResolvedValue({
      subject: 'Missed receipt',
      from: 'orders@missed.example',
      snippet: 'Total $19.25',
      receivedAt: '2026-05-05',
    });

    const health = await getGmailImportHealth(user, { days: 14, limit: 10 });

    expect(health.probes.inbox).toMatchObject({
      checked_count: 2,
      logged_count: 1,
      unlogged_count: 1,
    });
    expect(health.probes.inbox.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message_id: 'unlogged-inbox',
        import_status: 'unlogged',
        subject: 'Missed receipt',
        sender: 'missed.example',
      }),
    ]));
    expect(health.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unlogged_inbox_messages', level: 'warning' }),
    ]));
  });

  it('flags amount-sign mismatches and degraded amount confidence', async () => {
    OAuthToken.findByUserId.mockResolvedValue({
      last_synced_at: new Date().toISOString(),
      last_sync_status: 'success',
    });
    EmailImportLog.summarizeByUser.mockResolvedValue({
      amount_quality: {
        tracked_imports: 8,
        low_confidence: 3,
        low_confidence_rate: 0.375,
        negative_purchase_sign_mismatches: 1,
        positive_refund_sign_mismatches: 0,
      },
    });
    listRecentMessages.mockResolvedValue([]);

    const health = await getGmailImportHealth(user, { days: 14, limit: 10 });

    expect(health.amount_quality).toMatchObject({ low_confidence: 3 });
    expect(health.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'amount_sign_mismatch', level: 'error' }),
      expect.objectContaining({ code: 'amount_confidence_degraded', level: 'warning' }),
    ]));
  });
});
