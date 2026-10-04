jest.mock('../../src/db', () => ({ query: jest.fn() }));

const db = require('../../src/db');
const { analyzeRollingActivity } = require('../../src/services/usageInsightSignals');

describe('usage insight household privacy', () => {
  beforeEach(() => {
    db.query.mockReset();
    db.query.mockResolvedValue({ rows: [] });
  });

  it('scopes rolling household windows to expenses visible to the requester', async () => {
    await analyzeRollingActivity({
      user: { id: 'user-1', household_id: 'household-1' },
      scope: 'household',
      days: 7,
    });

    expect(db.query).toHaveBeenCalledTimes(2);
    for (const [sql, params] of db.query.mock.calls) {
      expect(sql).toContain('(COALESCE(e.is_private, FALSE) = FALSE OR e.user_id = $4)');
      expect(params[0]).toBe('household-1');
      expect(params[3]).toBe('user-1');
    }
  });
});
