jest.mock('../../src/db', () => ({
  query: jest.fn().mockResolvedValue({ rows: [{ id: 'refresh-event-id' }] }),
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
  buildInsightsForUser: jest.fn(),
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

const { buildInsightsForUser } = require('../../src/services/insightBuilder');
const { requestProjectionRefresh } = require('../../src/services/projectionRefreshService');

async function flushPromises(iterations = 30) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

describe('projection refresh coalescing', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    jest.runOnlyPendingTimers();
    await flushPromises();
    jest.useRealTimers();
  });

  it('queues one trailing refresh instead of overlapping an active build', async () => {
    let releaseFirstBuild;
    let activeBuilds = 0;
    let maxActiveBuilds = 0;
    let buildCount = 0;

    buildInsightsForUser.mockImplementation(async () => {
      buildCount += 1;
      activeBuilds += 1;
      maxActiveBuilds = Math.max(maxActiveBuilds, activeBuilds);
      if (buildCount === 1) {
        await new Promise((resolve) => { releaseFirstBuild = resolve; });
      }
      activeBuilds -= 1;
      return [];
    });

    const user = { id: 'user-1', household_id: null, budget_start_day: 1 };
    requestProjectionRefresh({ user, month: '2026-10', debounceMs: 0, reason: 'first' });
    jest.runOnlyPendingTimers();
    await flushPromises();

    expect(buildInsightsForUser).toHaveBeenCalledTimes(1);
    requestProjectionRefresh({ user, month: '2026-10', debounceMs: 0, reason: 'second' });
    jest.runOnlyPendingTimers();
    await flushPromises();
    expect(buildInsightsForUser).toHaveBeenCalledTimes(1);

    releaseFirstBuild();
    await flushPromises();
    jest.runOnlyPendingTimers();
    await flushPromises();

    expect(buildInsightsForUser).toHaveBeenCalledTimes(2);
    expect(maxActiveBuilds).toBe(1);
  });
});
