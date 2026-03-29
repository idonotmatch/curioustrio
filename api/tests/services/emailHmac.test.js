process.env.EMAIL_HASH_SECRET = 'test-secret-32chars-padded-xxxxx';
const { hashEmail } = require('../../src/services/emailHmac');

describe('hashEmail', () => {
  it('returns a 64-char hex string', () => {
    expect(hashEmail('user@example.com')).toHaveLength(64);
  });
  it('is deterministic', () => {
    expect(hashEmail('user@example.com')).toBe(hashEmail('user@example.com'));
  });
  it('normalises case before hashing', () => {
    expect(hashEmail('User@Example.COM')).toBe(hashEmail('user@example.com'));
  });
  it('different emails produce different hashes', () => {
    expect(hashEmail('a@example.com')).not.toBe(hashEmail('b@example.com'));
  });
  it('throws if EMAIL_HASH_SECRET is not set', () => {
    const saved = process.env.EMAIL_HASH_SECRET;
    delete process.env.EMAIL_HASH_SECRET;
    expect(() => hashEmail('x@y.com')).toThrow();
    process.env.EMAIL_HASH_SECRET = saved;
  });
});
