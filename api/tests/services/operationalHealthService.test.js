jest.mock('../../src/db', () => ({ query: jest.fn() }));
jest.mock('../../src/services/cronAlertService', () => ({ notifyCronAlert: jest.fn() }));

const db = require('../../src/db');
const { notifyCronAlert } = require('../../src/services/cronAlertService');
const {
  assessOperationalMetrics,
  resetAlertStateForTests,
  runOperationalHealthCheck,
} = require('../../src/services/operationalHealthService');

describe('operationalHealthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetAlertStateForTests();
  });

  it('flags stalled work and elevated failure rates', () => {
    const findings = assessOperationalMetrics({
      background_jobs: { stale_queued: 1, stale_running: 0, dead_24h: 1 },
      receipt_scans: { completed: 5, failed: 2, stale_queued: 0, stale_processing: 0 },
      email_imports: { imported: 10, failed: 3 },
      push_notifications: { completed: 5, failed: 1, stale_receipts: 2 },
    });
    expect(findings.map((item) => item.code)).toEqual(expect.arrayContaining([
      'background_jobs_stalled',
      'background_jobs_dead',
      'receipt_failure_rate_high',
      'email_import_failures_high',
      'push_receipts_stalled',
      'push_failure_rate_high',
    ]));
  });

  it('sends one privacy-safe alert for degraded metrics', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ stale_queued: 0, stale_running: 0, dead_24h: 1 }] })
      .mockResolvedValueOnce({ rows: [{ completed: 0, failed: 0, stale_queued: 0, stale_processing: 0 }] })
      .mockResolvedValueOnce({ rows: [{ imported: 0, failed: 0, skipped: 0 }] })
      .mockResolvedValueOnce({ rows: [{ completed: 0, failed: 0, stale_receipts: 0 }] });
    notifyCronAlert.mockResolvedValue({ sent: true });

    const result = await runOperationalHealthCheck({ notify: true });

    expect(result.ok).toBe(false);
    expect(notifyCronAlert).toHaveBeenCalledWith(expect.objectContaining({
      job: 'operational-health',
      metadata: expect.objectContaining({ metrics: expect.any(Object) }),
    }));
    expect(JSON.stringify(notifyCronAlert.mock.calls[0][0])).not.toContain('user_id');
  });
});
