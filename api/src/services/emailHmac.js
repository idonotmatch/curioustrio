const crypto = require('crypto');

function hashEmail(email) {
  if (!process.env.EMAIL_HASH_SECRET) {
    throw new Error('EMAIL_HASH_SECRET env var is not set');
  }
  return crypto
    .createHmac('sha256', process.env.EMAIL_HASH_SECRET)
    .update(email.toLowerCase().trim())
    .digest('hex');
}

module.exports = { hashEmail };
