jest.mock('../../src/db', () => ({ query: jest.fn() }));
jest.mock('../../src/models/backgroundJob', () => ({
  JOB_TYPES: { pushDispatch: 'push_dispatch' },
  enqueue: jest.fn(),
}));
jest.mock('../../src/models/notificationDelivery', () => ({
  latestAcceptedAt: jest.fn(),
  hasAcceptedKey: jest.fn(),
}));
jest.mock('../../src/models/pushToken', () => ({ findByUser: jest.fn() }));
jest.mock('../../src/models/user', () => ({ findById: jest.fn() }));
jest.mock('../../src/services/pushService', () => ({ sendNotifications: jest.fn() }));

const db = require('../../src/db');
const BackgroundJob = require('../../src/models/backgroundJob');
const NotificationDelivery = require('../../src/models/notificationDelivery');
const PushToken = require('../../src/models/pushToken');
const User = require('../../src/models/user');
const { sendNotifications } = require('../../src/services/pushService');
const {
  buildGmailReviewPushPayload,
  dispatchGmailReviewPush,
} = require('../../src/services/notificationDispatchService');

describe('notificationDispatchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockResolvedValue({
      id: 'user-1',
      push_gmail_review_enabled: true,
      notification_timezone: 'UTC',
      notification_quiet_hours_enabled: false,
    });
    PushToken.findByUser.mockResolvedValue([{ id: 'token-1', token: 'ExponentPushToken[test]' }]);
    NotificationDelivery.latestAcceptedAt.mockResolvedValue(null);
    NotificationDelivery.hasAcceptedKey.mockResolvedValue(false);
    db.query.mockResolvedValue({ rows: [{ total: 7, new_count: 2, newest_at: '2026-10-30T12:00:00.000Z' }] });
    sendNotifications.mockResolvedValue({ accepted: 1, rejected: 0 });
    BackgroundJob.enqueue.mockResolvedValue({ id: 'job-1' });
  });

  it('shows the full queue count while identifying what is new', () => {
    expect(buildGmailReviewPushPayload(7, 2)).toEqual({
      title: '7 purchases need review',
      body: '2 are new. Open Adlo when you are ready to confirm them.',
      data: {
        type: 'review_queue', route: '/review-queue', review_count: 7, new_review_count: 2,
      },
    });
  });

  it('dispatches one truthful queue notification through the delivery ledger', async () => {
    const result = await dispatchGmailReviewPush({
      userId: 'user-1', now: new Date('2026-10-30T12:00:00.000Z'),
    });

    expect(result).toEqual({ sent: 1, rejected: 0, deferred: false });
    expect(sendNotifications).toHaveBeenCalledWith([expect.objectContaining({
      pushTokenId: 'token-1',
      title: '7 purchases need review',
      body: '2 are new. Open Adlo when you are ready to confirm them.',
    })], expect.objectContaining({
      userId: 'user-1', category: 'gmail_review',
    }));
  });

  it('defers during quiet hours instead of dropping the notification', async () => {
    User.findById.mockResolvedValue({
      id: 'user-1',
      push_gmail_review_enabled: true,
      notification_timezone: 'UTC',
      notification_quiet_hours_enabled: true,
      notification_quiet_start: 22,
      notification_quiet_end: 8,
    });

    const result = await dispatchGmailReviewPush({
      userId: 'user-1', now: new Date('2026-10-30T23:00:00.000Z'),
    });

    expect(result).toMatchObject({ sent: 0, deferred: true });
    expect(BackgroundJob.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'push_dispatch', dedupeKey: 'gmail_review:user-1',
    }));
    expect(sendNotifications).not.toHaveBeenCalled();
  });

  it('queues a retry when Expo does not accept any delivery', async () => {
    sendNotifications.mockResolvedValue({
      accepted: 0,
      rejected: 1,
      results: [{ accepted: false, error: { code: 'expo_timeout' } }],
    });

    const result = await dispatchGmailReviewPush({
      userId: 'user-1', now: new Date('2026-10-30T12:00:00.000Z'),
    });

    expect(result).toMatchObject({ sent: 0, deferred: true, retry_reason: 'delivery_rejected' });
    expect(BackgroundJob.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'push_dispatch', dedupeKey: 'gmail_review:user-1',
    }));
  });
});
