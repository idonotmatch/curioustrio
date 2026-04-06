const db = require('../db');

function normalize(row) {
  if (!row) return null;
  return {
    ...row,
    amount: row.amount != null ? Number(row.amount) : null,
    last_projected_headroom_amount: row.last_projected_headroom_amount != null ? Number(row.last_projected_headroom_amount) : null,
    last_risk_adjusted_headroom_amount: row.last_risk_adjusted_headroom_amount != null ? Number(row.last_risk_adjusted_headroom_amount) : null,
    last_recurring_pressure_amount: row.last_recurring_pressure_amount != null ? Number(row.last_recurring_pressure_amount) : null,
  };
}

async function create({
  userId,
  householdId = null,
  scope = 'personal',
  label,
  amount,
  month,
  scenario,
}) {
  const result = await db.query(
    `INSERT INTO scenario_memory (
       user_id,
       household_id,
       scope,
       label,
       amount,
       month,
       memory_state,
       last_affordability_status,
       last_can_absorb,
       last_projected_headroom_amount,
       last_risk_adjusted_headroom_amount,
       last_recurring_pressure_amount,
       last_evaluated_at,
       expires_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6,
       'ephemeral',
       $7, $8, $9, $10, $11,
       NOW(),
       NOW() + INTERVAL '7 days'
     )
     RETURNING *`,
    [
      userId,
      householdId || null,
      scope,
      label,
      amount,
      month,
      scenario?.status || null,
      scenario?.can_absorb ?? null,
      scenario?.projected_headroom_amount ?? null,
      scenario?.risk_adjusted_headroom_amount ?? null,
      scenario?.recurring_pressure_amount ?? null,
    ]
  );
  return normalize(result.rows[0] || null);
}

async function findByIdForUser(id, userId) {
  const result = await db.query(
    `SELECT *
     FROM scenario_memory
     WHERE id = $1
       AND user_id = $2`,
    [id, userId]
  );
  return normalize(result.rows[0] || null);
}

async function recordIntent(id, userId, intentSignal) {
  const state = intentSignal === 'considering' ? 'considering' : 'suppressed';
  const expiresInterval = intentSignal === 'considering' ? `INTERVAL '21 days'` : `INTERVAL '2 days'`;
  const result = await db.query(
    `UPDATE scenario_memory
     SET intent_signal = $3,
         memory_state = $4,
         expires_at = NOW() + ${expiresInterval},
         updated_at = NOW()
     WHERE id = $1
       AND user_id = $2
     RETURNING *`,
    [id, userId, intentSignal, state]
  );
  return normalize(result.rows[0] || null);
}

async function listRecentActiveByUser(userId, { limit = 3 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 3, 10));
  const result = await db.query(
    `SELECT *
     FROM scenario_memory
     WHERE user_id = $1
       AND expires_at > NOW()
       AND memory_state IN ('ephemeral', 'considering')
     ORDER BY last_evaluated_at DESC, created_at DESC
     LIMIT $2`,
    [userId, safeLimit]
  );
  return result.rows.map(normalize);
}

module.exports = {
  create,
  findByIdForUser,
  recordIntent,
  listRecentActiveByUser,
};
