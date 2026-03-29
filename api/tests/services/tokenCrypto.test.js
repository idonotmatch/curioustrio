process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes as hex

const { encrypt, decrypt } = require('../../src/services/tokenCrypto');

describe('tokenCrypto', () => {
  it('returns a string different from plaintext', () => {
    expect(encrypt('secret')).not.toBe('secret');
  });
  it('round-trips correctly', () => {
    expect(decrypt(encrypt('refresh-token-abc'))).toBe('refresh-token-abc');
  });
  it('each encrypt produces a unique ciphertext', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });
  it('throws on tampered ciphertext', () => {
    const ct = encrypt('valid');
    expect(() => decrypt(ct.slice(0, -4) + 'xxxx')).toThrow();
  });
  it('throws if TOKEN_ENCRYPTION_KEY is not set', () => {
    const saved = process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encrypt('x')).toThrow();
    process.env.TOKEN_ENCRYPTION_KEY = saved;
  });
});
