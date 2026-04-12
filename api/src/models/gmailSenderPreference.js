const db = require('../db');

function isMissingSenderPreferencesTableError(err) {
  return err?.code === '42P01' && `${err?.message || ''}`.includes('gmail_sender_preferences');
}

async function findByUserAndDomain(userId, senderDomain) {
  try {
    const result = await db.query(
      `SELECT * FROM gmail_sender_preferences WHERE user_id = $1 AND sender_domain = $2`,
      [userId, senderDomain]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (!isMissingSenderPreferencesTableError(err)) throw err;
    return null;
  }
}

async function listByUser(userId) {
  try {
    const result = await db.query(
      `SELECT * FROM gmail_sender_preferences WHERE user_id = $1 ORDER BY sender_domain ASC`,
      [userId]
    );
    return result.rows;
  } catch (err) {
    if (!isMissingSenderPreferencesTableError(err)) throw err;
    return [];
  }
}

async function upsert(userId, senderDomain, { forceReview = false } = {}) {
  try {
    const result = await db.query(
      `INSERT INTO gmail_sender_preferences (user_id, sender_domain, force_review, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, sender_domain) DO UPDATE SET
         force_review = EXCLUDED.force_review,
         updated_at = NOW()
       RETURNING *`,
      [userId, senderDomain, !!forceReview]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (!isMissingSenderPreferencesTableError(err)) throw err;
    return {
      user_id: userId,
      sender_domain: senderDomain,
      force_review: !!forceReview,
    };
  }
}

module.exports = {
  findByUserAndDomain,
  listByUser,
  upsert,
};
