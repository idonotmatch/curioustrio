jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');
const {
  buildCronAlertPayload,
  notifyCronAlert,
} = require('../../src/services/cronAlertService');

describe('cronAlertService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    fetch.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('redacts sensitive values from alert payloads', () => {
    const payload = buildCronAlertPayload({
      job: 'gmail-sync',
      message: 'Failed for pat@example.com at https://mail.google.com/path with 1234567890123456',
    });

    expect(payload).toMatchObject({
      source: 'adlo-api',
      type: 'cron_alert',
      level: 'error',
      job: 'gmail-sync',
    });
    expect(payload.message).toContain('[redacted-email]');
    expect(payload.message).toContain('[redacted-link]');
    expect(payload.message).toContain('[redacted-number]');
  });

  it('does nothing when no webhook is configured', async () => {
    delete process.env.CRON_ALERT_WEBHOOK_URL;

    await expect(notifyCronAlert({ job: 'gmail-sync' })).resolves.toEqual({
      sent: false,
      reason: 'not_configured',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts a structured alert to the configured webhook', async () => {
    process.env.CRON_ALERT_WEBHOOK_URL = 'https://alerts.example.test/hook';
    fetch.mockResolvedValue({ ok: true, status: 200 });

    await expect(notifyCronAlert({
      job: 'gmail-sync',
      level: 'warning',
      message: 'Completed with failed imports',
      metadata: { total_failed: 2 },
    })).resolves.toEqual({ sent: true });

    expect(fetch).toHaveBeenCalledWith(
      'https://alerts.example.test/hook',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: expect.stringContaining('"job":"gmail-sync"'),
      })
    );
  });
});
