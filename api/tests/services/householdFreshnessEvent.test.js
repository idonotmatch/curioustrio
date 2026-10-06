jest.mock('../../src/db', () => ({ query: jest.fn() }));

const db = require('../../src/db');
const HouseholdFreshnessEvent = require('../../src/models/householdFreshnessEvent');

describe('HouseholdFreshnessEvent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses a stable timestamp and id cursor when polling', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await HouseholdFreshnessEvent.listForUser(
      { id: 'user-1', household_id: '00000000-0000-0000-0000-000000000010' },
      {
        since: '2026-10-05T12:00:00.000Z',
        sinceId: '00000000-0000-0000-0000-000000000001',
        limit: 100,
      }
    );

    expect(db.query.mock.calls[0][0]).toContain('created_at = $4::timestamptz AND id > $5::uuid');
    expect(db.query.mock.calls[0][0]).toContain('ORDER BY created_at ASC, id ASC');
    expect(db.query.mock.calls[0][1]).toEqual([
      'user-1',
      '00000000-0000-0000-0000-000000000010',
      100,
      '2026-10-05T12:00:00.000Z',
      '00000000-0000-0000-0000-000000000001',
    ]);
  });

  it('prunes events with a bounded retention period', async () => {
    db.query.mockResolvedValueOnce({ rowCount: 12 });

    await expect(HouseholdFreshnessEvent.pruneOldRows(999)).resolves.toEqual({
      deleted: 12,
      retention_days: 90,
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("INTERVAL '1 day'"),
      [90]
    );
  });
});
