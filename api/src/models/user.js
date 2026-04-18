const db = require('../db');

const COLS = `id, provider_uid, name, email, household_id, budget_start_day,
  push_gmail_review_enabled, push_insights_enabled, push_recurring_enabled, created_at`;

// Upsert by provider_uid.
async function findOrCreateByProviderUid({ providerUid, name, email }) {
  const result = await db.query(
    `INSERT INTO users (provider_uid, name, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider_uid)
     DO UPDATE SET
       name = COALESCE(EXCLUDED.name, users.name),
       email = COALESCE(EXCLUDED.email, users.email)
     RETURNING ${COLS}`,
    [providerUid, name || null, email || null]
  );
  return result.rows[0];
}

async function findByProviderUid(providerUid) {
  const result = await db.query(
    `SELECT ${COLS} FROM users WHERE provider_uid = $1`,
    [providerUid]
  );
  return result.rows[0] || null;
}

async function findByEmail(email) {
  const result = await db.query(
    `SELECT ${COLS} FROM users WHERE email = $1`,
    [email]
  );
  return result.rows[0] || null;
}

async function findById(id) {
  const result = await db.query(
    `SELECT ${COLS} FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function updateProviderUid(userId, providerUid) {
  const result = await db.query(
    `UPDATE users SET provider_uid = $1 WHERE id = $2 RETURNING ${COLS}`,
    [providerUid, userId]
  );
  return result.rows[0] || null;
}

async function setHouseholdId(userId, householdId) {
  const result = await db.query(
    `UPDATE users SET household_id = $1 WHERE id = $2 RETURNING ${COLS}`,
    [householdId, userId]
  );
  return result.rows[0] || null;
}

async function updateSettings(userId, {
  budgetStartDay,
  pushGmailReviewEnabled,
  pushInsightsEnabled,
  pushRecurringEnabled,
}) {
  const result = await db.query(
    `UPDATE users
     SET budget_start_day = COALESCE($1, budget_start_day),
         push_gmail_review_enabled = COALESCE($2, push_gmail_review_enabled),
         push_insights_enabled = COALESCE($3, push_insights_enabled),
         push_recurring_enabled = COALESCE($4, push_recurring_enabled)
     WHERE id = $5
     RETURNING ${COLS}`,
    [
      budgetStartDay ?? null,
      pushGmailReviewEnabled ?? null,
      pushInsightsEnabled ?? null,
      pushRecurringEnabled ?? null,
      userId,
    ]
  );
  return result.rows[0] || null;
}

module.exports = {
  findOrCreateByProviderUid,
  findByProviderUid,
  findByEmail,
  findById,
  updateProviderUid,
  setHouseholdId,
  updateSettings,
};
