jest.mock('../../src/db', () => ({ query: jest.fn() }));

const db = require('../../src/db');
const Snapshot = require('../../src/models/userSummarySnapshot');

describe('UserSummarySnapshot', () => {
  beforeEach(() => db.query.mockReset());

  it('stores a summary payload by user and period', async () => {
    db.query.mockResolvedValue({ rows: [{ generated_at: '2026-10-02T00:00:00.000Z' }] });
    const payload = { period: '2026-10', expenses: [] };
    await Snapshot.upsert({
      userId: 'user-1',
      householdId: null,
      period: '2026-10',
      startDay: 1,
      payload,
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_summary_snapshots'),
      ['user-1', null, '2026-10', 1, JSON.stringify(payload)]
    );
  });

  it('degrades cleanly before the migration is installed', async () => {
    db.query.mockRejectedValue(Object.assign(new Error('missing user_summary_snapshots'), { code: '42P01' }));
    await expect(Snapshot.find('user-1', '2026-10', 1)).resolves.toBeNull();
    await expect(Snapshot.invalidateScope({ userId: 'user-1' })).resolves.toBeUndefined();
  });
});
