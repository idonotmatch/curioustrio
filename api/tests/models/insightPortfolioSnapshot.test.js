jest.mock('../../src/db', () => ({ query: jest.fn() }));

const db = require('../../src/db');
const Snapshot = require('../../src/models/insightPortfolioSnapshot');

describe('InsightPortfolioSnapshot', () => {
  beforeEach(() => db.query.mockReset());

  it('stores the portfolio as one JSON projection', async () => {
    db.query.mockResolvedValue({ rows: [{ generated_at: '2026-10-02T00:00:00.000Z' }] });
    const insights = [{ id: 'insight-1', title: 'A useful note' }];

    const fingerprint = { expenses: [1, '2026-10-02T00:00:00+00:00', 10] };
    await Snapshot.upsert('user-1', insights, { reason: 'expense_changed' }, fingerprint);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO insight_portfolio_snapshots'),
      ['user-1', JSON.stringify(insights), JSON.stringify({ reason: 'expense_changed' }), JSON.stringify(fingerprint)]
    );
  });

  it('does not fingerprint another household member private expenses', async () => {
    db.query.mockResolvedValue({ rows: [{ fingerprint: {} }] });

    await Snapshot.sourceFingerprint('user-1');

    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain(`'logic_version', '${Snapshot.INSIGHT_LOGIC_VERSION}'`);
    expect(sql).toContain('COALESCE(e.is_private, FALSE) = FALSE');
    expect(sql).toContain('hashtextextended');
    expect(db.query.mock.calls[0][1]).toEqual(['user-1']);
  });

  it('refreshes snapshots after the time window or an insight expiry', () => {
    const now = new Date('2026-10-08T12:00:00.000Z').getTime();
    const fingerprint = { logic_version: Snapshot.INSIGHT_LOGIC_VERSION };
    const current = {
      generated_at: '2026-10-08T10:00:00.000Z',
      source_fingerprint: fingerprint,
      insights: [{ id: 'current', expires_at: '2026-10-09T00:00:00.000Z' }],
    };

    expect(Snapshot.matchesFingerprint(current, fingerprint, { now })).toBe(true);
    expect(Snapshot.matchesFingerprint({
      ...current,
      generated_at: '2026-10-08T05:00:00.000Z',
    }, fingerprint, { now })).toBe(false);
    expect(Snapshot.matchesFingerprint({
      ...current,
      insights: [{ id: 'expired', expires_at: '2026-10-08T11:59:59.000Z' }],
    }, fingerprint, { now })).toBe(false);
  });

  it('degrades cleanly before the migration is installed', async () => {
    db.query.mockRejectedValue(Object.assign(new Error('relation insight_portfolio_snapshots does not exist'), { code: '42P01' }));
    await expect(Snapshot.findByUser('user-1')).resolves.toBeNull();
    await expect(Snapshot.invalidate('user-1')).resolves.toBeUndefined();
  });
});
