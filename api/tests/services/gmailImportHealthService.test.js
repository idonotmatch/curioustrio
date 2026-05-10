jest.mock('../../src/models/oauthToken', () => ({
  findByUserId: jest.fn(),
}));
jest.mock('../../src/models/emailImportLog', () => ({
  listByUser: jest.fn(),
  findByMessageId: jest.fn(),
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
    listRecentMessages.mockReset();
    getMessage.mockReset();
    EmailImportLog.listByUser.mockResolvedValue([]);
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
});
