jest.mock('../../src/models/pushToken', () => ({ findAllUserIds: jest.fn() }));
jest.mock('../../src/models/user', () => ({ findById: jest.fn() }));
jest.mock('../../src/services/insightPushDispatcher', () => ({
  dispatchInsightPushesForUser: jest.fn(),
}));
jest.mock('../../src/services/cronAlertService', () => ({ notifyCronAlert: jest.fn() }));
jest.mock('../../src/services/observability', () => ({ captureException: jest.fn() }));

const PushToken = require('../../src/models/pushToken');
const User = require('../../src/models/user');
const { dispatchInsightPushesForUser } = require('../../src/services/insightPushDispatcher');
const { notifyCronAlert } = require('../../src/services/cronAlertService');
const { captureException } = require('../../src/services/observability');
const { runInsightPushCron } = require('../../src/services/insightPushCronService');

describe('insightPushCronService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    notifyCronAlert.mockResolvedValue({ sent: true });
  });

  it('reports successful dispatch totals', async () => {
    PushToken.findAllUserIds.mockResolvedValue(['user-1', 'user-2']);
    User.findById.mockImplementation(async (id) => ({ id }));
    dispatchInsightPushesForUser
      .mockResolvedValueOnce({ sent: 1 })
      .mockResolvedValueOnce({ sent: 0 });

    await expect(runInsightPushCron()).resolves.toEqual({
      ok: true,
      users_targeted: 2,
      users_processed: 2,
      users_failed: 0,
      notifications_sent: 1,
    });
    expect(notifyCronAlert).not.toHaveBeenCalled();
  });

  it('returns a failed result and alerts when any user dispatch fails', async () => {
    const error = new Error('push failed');
    PushToken.findAllUserIds.mockResolvedValue(['user-1', 'user-2']);
    User.findById.mockImplementation(async (id) => ({ id }));
    dispatchInsightPushesForUser
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ sent: 2 });

    const result = await runInsightPushCron();

    expect(result).toMatchObject({
      ok: false,
      users_targeted: 2,
      users_processed: 1,
      users_failed: 1,
      notifications_sent: 2,
    });
    expect(captureException).toHaveBeenCalledWith(error, expect.objectContaining({
      area: 'insights_push_scheduler',
    }));
    expect(notifyCronAlert).toHaveBeenCalledWith(expect.objectContaining({
      job: 'insights-push',
      metadata: expect.objectContaining({ users_failed: 1 }),
    }));
  });
});
