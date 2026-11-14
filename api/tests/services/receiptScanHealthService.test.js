jest.mock('../../src/models/ingestAttemptLog');
jest.mock('../../src/models/receiptScanJob');

const IngestAttemptLog = require('../../src/models/ingestAttemptLog');
const ReceiptScanJob = require('../../src/models/receiptScanJob');
const { buildRecommendations, getReceiptScanHealth } = require('../../src/services/receiptScanHealthService');

describe('receiptScanHealthService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('combines durable job and parser health', async () => {
    ReceiptScanJob.summarizeByUser.mockResolvedValue({
      counts: { jobs: 10, succeeded: 9, failed: 1, retried: 2 },
      failure_reasons: [{ reason: 'ai_timeout', count: 1 }],
    });
    IngestAttemptLog.summarizeByUser.mockResolvedValue({
      counts: { attempts: 10, parsed: 8, partial: 1, failed: 1 },
      reasons: [{ reason: 'ai_timeout', count: 1 }],
      merchants: [],
    });

    const result = await getReceiptScanHealth({ id: 'user-1' }, { days: 14 });

    expect(result.window_days).toBe(14);
    expect(result.jobs.success_rate).toBe(0.9);
    expect(result.jobs.retry_rate).toBe(0.2);
    expect(result.recommendations.map((item) => item.code)).toContain('receipt_failure_rate_high');
    expect(ReceiptScanJob.summarizeByUser).toHaveBeenCalledWith('user-1', { days: 14 });
  });

  it('raises stalled jobs before softer warnings', () => {
    const result = buildRecommendations(
      { jobs: 4, succeeded: 4, stale_processing: 1, worker_dead: 1 },
      { counts: {}, reasons: [] }
    );
    expect(result[0]).toEqual(expect.objectContaining({ code: 'receipt_jobs_stalled', level: 'error' }));
  });

  it('reports healthy windows without inventing warnings', () => {
    const result = buildRecommendations(
      { jobs: 5, succeeded: 5, failed: 0, p95_end_to_end_ms: 20_000 },
      { counts: { attempts: 5, parsed: 5 }, reasons: [] }
    );
    expect(result).toEqual([expect.objectContaining({ code: 'receipt_health_ok', level: 'ok' })]);
  });
});
