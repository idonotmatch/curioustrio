const { redact, redactString } = require('../../src/services/observability');

describe('observability redaction', () => {
  it('redacts sensitive keys and inline secrets', () => {
    const safe = redact({
      email: 'person@example.com',
      metadata: {
        path: '/gmail/import',
        message: 'Failed for person@example.com token ya29abcdefghijklmnop',
        subject: 'Receipt from Store',
      },
    });

    expect(safe.email).toBe('[redacted]');
    expect(safe.metadata.subject).toBe('[redacted]');
    expect(safe.metadata.message).toContain('[redacted-email]');
    expect(safe.metadata.message).toContain('[redacted-token]');
  });

  it('redacts long identifiers from strings', () => {
    expect(redactString('message 1234567890123')).toBe('message [redacted-number]');
  });
});
