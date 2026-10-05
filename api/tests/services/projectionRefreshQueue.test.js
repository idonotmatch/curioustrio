jest.mock('../../src/db', () => ({
  query: jest.fn().mockResolvedValue({ rows: [{ id: 'refresh-event-id' }] }),
}));
jest.mock('../../src/models/backgroundJob', () => ({
  JOB_TYPES: { projectionRefresh: 'projection_refresh' },
  enqueue: jest.fn().mockResolvedValue({ id: 'job-1' }),
}));
jest.mock('../../src/models/insightPortfolioSnapshot', () => ({
  invalidate: jest.fn().mockResolvedValue(undefined),
  sourceFingerprint: jest.fn().mockResolvedValue('fingerprint'),
  upsert: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/models/userSummarySnapshot', () => ({
  upsert: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/summaryBundleService', () => ({
  buildSummaryBundle: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/services/insightBuilder', () => ({
  buildInsightsForUser: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/services/insightAction', () => ({
  attachInsightAction: jest.fn((insight) => insight),
}));
jest.mock('../../src/services/insightForecastService', () => ({
  attachInsightForecasts: jest.fn(async (_userId, insights) => insights),
  evaluateDueForecastOutcomes: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/freshnessEvents', () => ({
  DOMAINS: { insights: 'insights', forecastMovement: 'forecastMovement' },
  emitFreshnessEvent: jest.fn(),
}));

const BackgroundJob = require('../../src/models/backgroundJob');
const InsightPortfolioSnapshot = require('../../src/models/insightPortfolioSnapshot');
const {
  durableRefreshPayload,
  requestProjectionRefresh,
} = require('../../src/services/projectionRefreshService');

describe('durable projection refresh queue', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses a stable user, scope, and month dedupe key', async () => {
    const user = { id: 'user-1', household_id: 'household-1' };
    const key = await requestProjectionRefresh({
      user,
      scope: 'household',
      month: '2026-10',
      reason: 'expense_changed',
      debounceMs: 250,
    });

    expect(key).toBe('user-1:household:2026-10');
    expect(BackgroundJob.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'projection_refresh',
      dedupeKey: key,
      delayMs: 250,
      payload: expect.objectContaining({ user_id: 'user-1', month: '2026-10' }),
    }));
    expect(InsightPortfolioSnapshot.invalidate).toHaveBeenCalledWith('user-1');
  });

  it('keeps only the expense fields needed to rebuild projections', () => {
    const payload = durableRefreshPayload({
      user: { id: 'user-1' },
      reason: 'expense_updated',
      expense: {
        id: 'expense-1',
        date: '2026-10-04',
        merchant: 'Store',
        category_id: 'category-1',
        notes: 'do not persist this in a queue payload',
      },
      metadata: { source: 'expense_edit', message_id: 'private-message-id' },
    });

    expect(payload.expense).toEqual({
      id: 'expense-1',
      date: '2026-10-04',
      merchant: 'Store',
      category_id: 'category-1',
    });
    expect(payload.expense).not.toHaveProperty('notes');
    expect(payload.metadata).toEqual({ source: 'expense_edit' });
  });
});
