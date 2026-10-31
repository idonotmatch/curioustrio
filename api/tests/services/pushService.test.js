jest.mock('../../src/models/backgroundJob', () => ({
  JOB_TYPES: { pushReceipt: 'push_receipt' },
  enqueue: jest.fn(),
}));
jest.mock('../../src/models/notificationDelivery', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  markResult: jest.fn(),
}));
jest.mock('../../src/models/pushToken', () => ({ disable: jest.fn() }));
jest.mock('../../src/services/observability', () => ({ captureException: jest.fn() }));

const BackgroundJob = require('../../src/models/backgroundJob');
const NotificationDelivery = require('../../src/models/notificationDelivery');
const PushToken = require('../../src/models/pushToken');
const { reconcilePushReceipt, sendNotifications } = require('../../src/services/pushService');

describe('pushService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    NotificationDelivery.create.mockResolvedValue({ id: 'delivery-1' });
    BackgroundJob.enqueue.mockResolvedValue({ id: 'job-1' });
  });

  it('records accepted tickets and schedules receipt verification', async () => {
    const transport = jest.fn().mockResolvedValue({ data: [{ status: 'ok', id: 'ticket-1' }] });

    const result = await sendNotifications([{
      to: 'ExponentPushToken[test]',
      pushTokenId: 'token-1',
      title: 'Review purchases',
      body: 'Open Adlo.',
    }], {
      userId: 'user-1',
      category: 'gmail_review',
      notificationKey: 'gmail:1',
      transport,
    });

    expect(result).toMatchObject({ accepted: 1, rejected: 0 });
    expect(transport).toHaveBeenCalledWith('/--/api/v2/push/send', [{
      to: 'ExponentPushToken[test]',
      title: 'Review purchases',
      body: 'Open Adlo.',
    }]);
    expect(NotificationDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
      pushTokenId: 'token-1',
      expoTicketId: 'ticket-1',
      status: 'accepted',
    }));
    expect(BackgroundJob.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'push_receipt',
      payload: { delivery_id: 'delivery-1', ticket_id: 'ticket-1' },
    }));
  });

  it('rejects and disables a token Expo reports as unregistered', async () => {
    const transport = jest.fn().mockResolvedValue({
      data: [{ status: 'error', message: 'Device is not registered', details: { error: 'DeviceNotRegistered' } }],
    });

    const result = await sendNotifications([{
      to: 'ExponentPushToken[old]', pushTokenId: 'token-1', title: 'Title', body: 'Body',
    }], { userId: 'user-1', category: 'insight', transport });

    expect(result).toMatchObject({ accepted: 0, rejected: 1 });
    expect(PushToken.disable).toHaveBeenCalledWith('token-1', 'DeviceNotRegistered');
    expect(BackgroundJob.enqueue).not.toHaveBeenCalled();
  });

  it('does not disable a device for app-level credential failures', async () => {
    const transport = jest.fn().mockResolvedValue({
      data: [{ status: 'error', message: 'Credentials are invalid', details: { error: 'InvalidCredentials' } }],
    });

    await sendNotifications([{
      to: 'ExponentPushToken[current]', pushTokenId: 'token-1', title: 'Title', body: 'Body',
    }], { userId: 'user-1', category: 'insight', transport });

    expect(PushToken.disable).not.toHaveBeenCalled();
  });

  it('records transport failures instead of reporting them as sent', async () => {
    const error = Object.assign(new Error('Expo timed out'), { code: 'expo_timeout' });
    const transport = jest.fn().mockRejectedValue(error);

    const result = await sendNotifications([{
      to: 'ExponentPushToken[current]', pushTokenId: 'token-1', title: 'Title', body: 'Body',
    }], { userId: 'user-1', category: 'gmail_review', transport });

    expect(result).toMatchObject({ accepted: 0, rejected: 1 });
    expect(NotificationDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed', errorCode: 'expo_timeout',
    }));
  });

  it('marks a verified receipt delivered', async () => {
    NotificationDelivery.findById.mockResolvedValue({
      id: 'delivery-1', status: 'accepted', push_token_id: 'token-1',
    });
    const transport = jest.fn().mockResolvedValue({ data: { 'ticket-1': { status: 'ok' } } });

    await expect(reconcilePushReceipt({
      delivery_id: 'delivery-1', ticket_id: 'ticket-1',
    }, { transport })).resolves.toEqual({ delivered: true });
    expect(NotificationDelivery.markResult).toHaveBeenCalledWith('delivery-1', { status: 'delivered' });
  });

  it('marks a failed receipt and disables an unregistered token', async () => {
    NotificationDelivery.findById.mockResolvedValue({
      id: 'delivery-1', status: 'accepted', push_token_id: 'token-1',
    });
    const transport = jest.fn().mockResolvedValue({
      data: {
        'ticket-1': {
          status: 'error', message: 'Gone', details: { error: 'DeviceNotRegistered' },
        },
      },
    });

    await expect(reconcilePushReceipt({
      delivery_id: 'delivery-1', ticket_id: 'ticket-1',
    }, { transport })).resolves.toMatchObject({ delivered: false, error_code: 'DeviceNotRegistered' });
    expect(NotificationDelivery.markResult).toHaveBeenCalledWith('delivery-1', expect.objectContaining({
      status: 'failed', errorCode: 'DeviceNotRegistered',
    }));
    expect(PushToken.disable).toHaveBeenCalledWith('token-1', 'DeviceNotRegistered');
  });
});
