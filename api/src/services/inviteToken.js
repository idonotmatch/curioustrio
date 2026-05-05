const crypto = require('crypto');

const INVITE_TOKEN_CONTEXT = 'household-invite';

function normalizeInviteToken(token) {
  return `${token || ''}`.trim();
}

function hashInviteToken(token) {
  const normalized = normalizeInviteToken(token);
  if (!normalized) return '';
  const secret = `${process.env.EMAIL_HASH_SECRET || ''}`.trim();
  if (!secret) {
    throw new Error('EMAIL_HASH_SECRET is required to hash invite tokens');
  }
  return crypto
    .createHmac('sha256', secret)
    .update(`${INVITE_TOKEN_CONTEXT}:${normalized}`)
    .digest('hex');
}

module.exports = {
  hashInviteToken,
  normalizeInviteToken,
};
