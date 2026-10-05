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
    expect(sql).toContain(`'logic_version', 'item-evidence-v1'`);
    expect(sql).toContain('COALESCE(e.is_private, FALSE) = FALSE');
    expect(db.query.mock.calls[0][1]).toEqual(['user-1']);
  });

  it('degrades cleanly before the migration is installed', async () => {
    db.query.mockRejectedValue(Object.assign(new Error('relation insight_portfolio_snapshots does not exist'), { code: '42P01' }));
    await expect(Snapshot.findByUser('user-1')).resolves.toBeNull();
    await expect(Snapshot.invalidate('user-1')).resolves.toBeUndefined();
  });
});
