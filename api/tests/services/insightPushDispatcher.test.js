jest.mock('../../src/models/pushToken', () => ({
  findByUser: jest.fn(),
}));

jest.mock('../../src/models/insightNotification', () => ({
  findSentIds: jest.fn(),
  createBatch: jest.fn(),
}));

jest.mock('../../src/services/pushService', () => ({
  sendNotifications: jest.fn(),
}));

jest.mock('../../src/services/insightBuilder', () => ({
  buildInsightsForUser: jest.fn(),
}));

const PushToken = require('../../src/models/pushToken');
const InsightNotification = require('../../src/models/insightNotification');
const { sendNotifications } = require('../../src/services/pushService');
const { buildInsightsForUser } = require('../../src/services/insightBuilder');
const { dispatchInsightPushesForUser, PUSHABLE_INSIGHT_TYPES } = require('../../src/services/insightPushDispatcher');

beforeEach(() => {
  PushToken.findByUser.mockReset();
  InsightNotification.findSentIds.mockReset();
  InsightNotification.createBatch.mockReset();
  sendNotifications.mockReset();
  buildInsightsForUser.mockReset();
});

describe('PUSHABLE_INSIGHT_TYPES', () => {
  it('includes buy_soon_better_price', () => {
    expect(PUSHABLE_INSIGHT_TYPES.has('buy_soon_better_price')).toBe(true);
  });
});

describe('dispatchInsightPushesForUser', () => {
  it('dispatches push notifications for buy_soon_better_price insights', async () => {
    PushToken.findByUser.mockResolvedValueOnce([{ token: 'expo-token-1' }]);
    buildInsightsForUser.mockResolvedValueOnce([{
      id: 'buy_soon_better_price:product:abc:target:2026-04-04',
      type: 'buy_soon_better_price',
      title: 'Pampers Pure is cheaper right now',
      body: 'Target is 7% below your usual price.',
      entity_type: 'item',
      entity_id: 'product:abc',
      metadata: { group_key: 'product:abc' },
    }]);
    InsightNotification.findSentIds.mockResolvedValueOnce(new Set());
    InsightNotification.createBatch.mockResolvedValueOnce([{ id: 'notif-1' }]);
    sendNotifications.mockResolvedValueOnce([]);

    const result = await dispatchInsightPushesForUser({ id: 'user-1' });

    expect(sendNotifications).toHaveBeenCalledTimes(1);
    expect(InsightNotification.createBatch).toHaveBeenCalledWith(
      'user-1',
      ['buy_soon_better_price:product:abc:target:2026-04-04'],
      'push'
    );
    expect(result.sent).toBe(1);
  });

  it('does not re-send already-notified insights', async () => {
    PushToken.findByUser.mockResolvedValueOnce([{ token: 'expo-token-1' }]);
    buildInsightsForUser.mockResolvedValueOnce([{
      id: 'buy_soon_better_price:product:abc:target:2026-04-04',
      type: 'buy_soon_better_price',
      title: 'Pampers Pure is cheaper right now',
      body: 'Target is 7% below your usual price.',
      entity_type: 'item',
      entity_id: 'product:abc',
      metadata: { group_key: 'product:abc' },
    }]);
    InsightNotification.findSentIds.mockResolvedValueOnce(new Set(['buy_soon_better_price:product:abc:target:2026-04-04']));

    const result = await dispatchInsightPushesForUser({ id: 'user-1' });

    expect(sendNotifications).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });
});
