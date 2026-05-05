process.env.EMAIL_HASH_SECRET = 'test-secret-32chars-padded-xxxxx';

const { hashInviteToken, normalizeInviteToken } = require('../../src/services/inviteToken');

describe('inviteToken', () => {
  it('normalizes and hashes invite tokens deterministically', () => {
    const raw = '  invite-token-123  ';

    expect(normalizeInviteToken(raw)).toBe('invite-token-123');
    expect(hashInviteToken(raw)).toBe(hashInviteToken('invite-token-123'));
    expect(hashInviteToken(raw)).not.toBe('invite-token-123');
  });
});
