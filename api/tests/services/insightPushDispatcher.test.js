jest.mock('../../src/models/pushToken', () => ({
  findByUser: jest.fn(),
}));

jest.mock('../../src/models/insightNotification', () => ({
  findSentIds: jest.fn(),
  createBatch: jest.fn(),
}));

jest.mock('../../src/models/insightEvent', () => ({
  getRecentByUser: jest.fn(),
}));

jest.mock('../../src/services/pushService', () => ({
  sendNotifications: jest.fn(),
}));

jest.mock('../../src/services/insightBuilder', () => ({
  buildInsightsForUser: jest.fn(),
}));

const PushToken = require('../../src/models/pushToken');
const InsightNotification = require('../../src/models/insightNotification');
const InsightEvent = require('../../src/models/insightEvent');
const { sendNotifications } = require('../../src/services/pushService');
const { buildInsightsForUser } = require('../../src/services/insightBuilder');
const { dispatchInsightPushesForUser, PUSHABLE_INSIGHT_TYPES, pushCopyForInsight } = require('../../src/services/insightPushDispatcher');

beforeEach(() => {
  PushToken.findByUser.mockReset();
  InsightNotification.findSentIds.mockReset();
  InsightNotification.createBatch.mockReset();
  InsightEvent.getRecentByUser.mockReset();
  sendNotifications.mockReset();
  buildInsightsForUser.mockReset();
  InsightEvent.getRecentByUser.mockResolvedValue([]);
});

describe('PUSHABLE_INSIGHT_TYPES', () => {
  it('includes buy_soon_better_price', () => {
    expect(PUSHABLE_INSIGHT_TYPES.has('buy_soon_better_price')).toBe(true);
  });
});

describe('dispatchInsightPushesForUser', () => {
  it('builds push-specific copy instead of reusing the raw card title', () => {
    const copy = pushCopyForInsight({
      type: 'buy_soon_better_price',
      title: 'Pampers Pure is cheaper right now',
      body: 'Target is 7% below your usual price.',
      metadata: {
        product_name: 'Pampers Pure',
        retailer_name: 'Target',
      },
    });

    expect(copy).toEqual({
      title: 'Price insight ready',
      body: 'Open Adlo to review a recent price opportunity.',
    });
  });

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
    expect(sendNotifications).toHaveBeenCalledWith([expect.objectContaining({
      title: 'Price insight ready',
      data: expect.objectContaining({
        route: '/insight-detail',
        insight_id: 'buy_soon_better_price:product:abc:target:2026-04-04',
        metadata: expect.objectContaining({
          group_key: 'product:abc',
        }),
      }),
    })]);
    const sentMessage = sendNotifications.mock.calls[0][0][0];
    expect(sentMessage.data.title).toBeUndefined();
    expect(sentMessage.data.body).toBeUndefined();
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

  it('does not send when insight pushes are disabled for the user', async () => {
    const result = await dispatchInsightPushesForUser({
      id: 'user-1',
      push_insights_enabled: false,
    });

    expect(PushToken.findByUser).not.toHaveBeenCalled();
    expect(sendNotifications).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, considered: 0 });
  });

  it('suppresses pushes for insight types with strongly negative learned preference', async () => {
    PushToken.findByUser.mockResolvedValueOnce([{ token: 'expo-token-1' }]);
    InsightEvent.getRecentByUser.mockResolvedValueOnce([
      {
        insight_id: 'buy_soon_better_price:product:abc:target:2026-04-01',
        event_type: 'shown',
        metadata: { type: 'buy_soon_better_price', scope: 'personal', maturity: 'mature' },
      },
      {
        insight_id: 'buy_soon_better_price:product:abc:target:2026-04-01',
        event_type: 'dismissed',
        metadata: { type: 'buy_soon_better_price', scope: 'personal', maturity: 'mature' },
      },
      {
        insight_id: 'buy_soon_better_price:product:def:target:2026-04-02',
        event_type: 'shown',
        metadata: { type: 'buy_soon_better_price', scope: 'personal', maturity: 'mature' },
      },
      {
        insight_id: 'buy_soon_better_price:product:def:target:2026-04-02',
        event_type: 'not_helpful',
        metadata: { type: 'buy_soon_better_price', scope: 'personal', maturity: 'mature' },
      },
    ]);
    buildInsightsForUser.mockResolvedValueOnce([{
      id: 'buy_soon_better_price:product:ghi:target:2026-04-04',
      type: 'buy_soon_better_price',
      title: 'Pampers Pure is cheaper right now',
      body: 'Target is 7% below your usual price.',
      entity_type: 'item',
      entity_id: 'product:ghi',
      metadata: { group_key: 'product:ghi', scope: 'personal', maturity: 'mature' },
    }]);

    const result = await dispatchInsightPushesForUser({ id: 'user-1' });

    expect(sendNotifications).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, considered: 0 });
  });
});
