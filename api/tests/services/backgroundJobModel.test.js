jest.mock('../../src/db', () => ({ query: jest.fn() }));

const db = require('../../src/db');
const BackgroundJob = require('../../src/models/backgroundJob');

describe('BackgroundJob model', () => {
  beforeEach(() => jest.clearAllMocks());

  it('upserts active jobs by type and dedupe key', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'job-1', status: 'queued' }] });

    await BackgroundJob.enqueue({
      jobType: BackgroundJob.JOB_TYPES.projectionRefresh,
      dedupeKey: 'user-1:personal:2026-10',
      payload: { user_id: 'user-1' },
      delayMs: 750,
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (job_type, dedupe_key)'),
      ['projection_refresh', 'user-1:personal:2026-10', '{"user_id":"user-1"}', 5, 750]
    );
  });

  it('caps retry backoff at fifteen minutes', () => {
    expect(BackgroundJob.retryDelayMs(1)).toBe(1000);
    expect(BackgroundJob.retryDelayMs(4)).toBe(8000);
    expect(BackgroundJob.retryDelayMs(99)).toBe(900000);
  });

  it('claims work with skip-locked semantics', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'job-1' }] });
    await BackgroundJob.claimNext('worker-1');
    expect(db.query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(db.query.mock.calls[0][1]).toEqual(['worker-1']);
  });
});
