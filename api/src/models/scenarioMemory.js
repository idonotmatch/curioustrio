const db = require('../db');

function normalize(row) {
  if (!row) return null;
  return {
    ...row,
    watch_enabled: Boolean(row.watch_enabled),
    amount: row.amount != null ? Number(row.amount) : null,
    previous_risk_adjusted_headroom_amount: row.previous_risk_adjusted_headroom_amount != null ? Number(row.previous_risk_adjusted_headroom_amount) : null,
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
  timingMode = 'now',
  scenario,
  recommendedTimingMode = null,
  choiceFollowedRecommendation = null,
  choiceSource = null,
}) {
  const result = await db.query(
    `INSERT INTO scenario_memory (
       user_id,
       household_id,
       scope,
       label,
       amount,
       month,
       timing_mode,
       memory_state,
       last_affordability_status,
       last_can_absorb,
       last_projected_headroom_amount,
       last_risk_adjusted_headroom_amount,
       last_recurring_pressure_amount,
       last_recommended_timing_mode,
       last_choice_followed_recommendation,
       last_choice_source,
       last_evaluated_at,
       expires_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       'ephemeral',
       $8, $9, $10, $11, $12, $13, $14, $15,
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
      timingMode,
      scenario?.status || null,
      scenario?.can_absorb ?? null,
      scenario?.projected_headroom_amount ?? null,
      scenario?.risk_adjusted_headroom_amount ?? null,
      scenario?.recurring_pressure_amount ?? null,
      recommendedTimingMode,
      choiceFollowedRecommendation,
      choiceSource,
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
  const watchDisableClause = intentSignal === 'considering'
    ? ''
    : `,
         watch_enabled = FALSE,
         watch_started_at = NULL`;
  const result = await db.query(
    `UPDATE scenario_memory
     SET intent_signal = $3,
         memory_state = $4,
         expires_at = NOW() + ${expiresInterval},
         ${watchDisableClause}
         updated_at = NOW()
     WHERE id = $1
       AND user_id = $2
     RETURNING *`,
    [id, userId, intentSignal, state]
  );
  return normalize(result.rows[0] || null);
}

async function updateWatch(id, userId, enabled) {
  const result = await db.query(
    `UPDATE scenario_memory
     SET watch_enabled = $3,
         watch_started_at = CASE
           WHEN $3 THEN COALESCE(watch_started_at, NOW())
           ELSE NULL
         END,
         memory_state = CASE
           WHEN $3 THEN 'considering'
           ELSE memory_state
         END,
         intent_signal = CASE
           WHEN $3 THEN COALESCE(intent_signal, 'considering')
           ELSE intent_signal
         END,
         expires_at = CASE
           WHEN $3 THEN GREATEST(expires_at, NOW() + INTERVAL '45 days')
           ELSE expires_at
         END,
         updated_at = NOW()
     WHERE id = $1
       AND user_id = $2
     RETURNING *`,
    [id, userId, Boolean(enabled)]
  );
  return normalize(result.rows[0] || null);
}

async function resolve(id, userId, action, { expenseId = null } = {}) {
  const result = await db.query(
    `UPDATE scenario_memory
     SET resolution_action = $3,
         resolved_at = NOW(),
         resolved_expense_id = $4,
         watch_enabled = FALSE,
         watch_started_at = NULL,
         memory_state = 'suppressed',
         intent_signal = CASE
           WHEN $3 = 'not_buying' THEN 'not_right_now'
           ELSE intent_signal
         END,
         expires_at = NOW() + INTERVAL '2 days',
         updated_at = NOW()
     WHERE id = $1
       AND user_id = $2
     RETURNING *`,
    [id, userId, action, expenseId]
  );
  return normalize(result.rows[0] || null);
}

function nextMonth(month) {
  const [yearRaw, monthRaw] = `${month || ''}`.split('-');
  const year = Number(yearRaw);
  const monthNumber = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  }
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonthNumber = monthNumber === 12 ? 1 : monthNumber + 1;
  return `${nextYear}-${String(nextMonthNumber).padStart(2, '0')}`;
}

async function deferToNextMonth(id, userId) {
  const current = await findByIdForUser(id, userId);
  if (!current) return null;

  const deferredUntilMonth = nextMonth(current.month);
  const result = await db.query(
    `UPDATE scenario_memory
     SET memory_state = 'deferred',
         intent_signal = 'not_right_now',
         watch_enabled = FALSE,
         watch_started_at = NULL,
         resolution_action = 'revisit_next_month',
         resolved_at = NOW(),
         deferred_until_month = $3,
         expires_at = NOW() + INTERVAL '45 days',
         updated_at = NOW()
     WHERE id = $1
       AND user_id = $2
     RETURNING *`,
    [id, userId, deferredUntilMonth]
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

async function listActiveConsideringByUser(userId, { limit = 10 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 25));
  const result = await db.query(
    `SELECT *
     FROM scenario_memory
     WHERE user_id = $1
       AND expires_at > NOW()
       AND memory_state = 'considering'
     ORDER BY last_evaluated_at DESC, created_at DESC
     LIMIT $2`,
    [userId, safeLimit]
  );
  return result.rows.map(normalize);
}

async function listWatchedByUser(userId, { limit = 10 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
  const result = await db.query(
    `SELECT *
     FROM scenario_memory
     WHERE user_id = $1
       AND expires_at > NOW()
       AND watch_enabled = TRUE
     ORDER BY last_evaluated_at DESC, created_at DESC
     LIMIT $2`,
    [userId, safeLimit]
  );
  return result.rows.map(normalize);
}

async function listDeferredByUser(userId, { limit = 10 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
  const result = await db.query(
    `SELECT *
     FROM scenario_memory
     WHERE user_id = $1
       AND expires_at > NOW()
       AND memory_state = 'deferred'
     ORDER BY deferred_until_month ASC NULLS LAST, updated_at DESC, created_at DESC
     LIMIT $2`,
    [userId, safeLimit]
  );
  return result.rows.map(normalize);
}

async function updateEvaluation(id, userId, scenario, materialChange = 'unchanged') {
  const result = await db.query(
    `UPDATE scenario_memory
     SET previous_affordability_status = last_affordability_status,
         previous_risk_adjusted_headroom_amount = last_risk_adjusted_headroom_amount,
         last_affordability_status = $3,
         last_can_absorb = $4,
         last_projected_headroom_amount = $5,
         last_risk_adjusted_headroom_amount = $6,
         last_recurring_pressure_amount = $7,
         last_material_change = $8,
         last_evaluated_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND user_id = $2
     RETURNING *`,
    [
      id,
      userId,
      scenario?.status || null,
      scenario?.can_absorb ?? null,
      scenario?.projected_headroom_amount ?? null,
      scenario?.risk_adjusted_headroom_amount ?? null,
      scenario?.recurring_pressure_amount ?? null,
      materialChange,
    ]
  );
  return normalize(result.rows[0] || null);
}

async function summarizeChoiceFeedback(userId) {
  const result = await db.query(
    `SELECT
       COUNT(*)::int AS total_choices,
       COUNT(*) FILTER (WHERE last_choice_followed_recommendation IS TRUE)::int AS followed_recommendation_count,
       COUNT(*) FILTER (WHERE last_choice_followed_recommendation IS FALSE)::int AS deviated_from_recommendation_count,
       COUNT(*) FILTER (WHERE last_choice_source = 'compare_option')::int AS compare_option_count,
       COUNT(*) FILTER (WHERE last_choice_source = 'recent_plan')::int AS recent_plan_count,
       COUNT(*) FILTER (WHERE last_choice_source = 'initial')::int AS initial_count
     FROM scenario_memory
     WHERE user_id = $1
       AND last_choice_source IS NOT NULL`,
    [userId]
  );
  const row = result.rows[0] || {};
  const totalChoices = Number(row.total_choices || 0);
  return {
    total_choices: totalChoices,
    followed_recommendation_count: Number(row.followed_recommendation_count || 0),
    deviated_from_recommendation_count: Number(row.deviated_from_recommendation_count || 0),
    follow_rate: totalChoices > 0
      ? Number((Number(row.followed_recommendation_count || 0) / totalChoices).toFixed(3))
      : null,
    by_source: {
      initial: Number(row.initial_count || 0),
      compare_option: Number(row.compare_option_count || 0),
      recent_plan: Number(row.recent_plan_count || 0),
    },
  };
}

async function summarizeTimingPreferences(userId) {
  const result = await db.query(
    `SELECT
       last_recommended_timing_mode AS timing_mode,
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE last_choice_followed_recommendation IS TRUE)::int AS followed,
       COUNT(*) FILTER (WHERE last_choice_followed_recommendation IS FALSE)::int AS deviated,
       COUNT(*) FILTER (WHERE last_choice_source = 'compare_option')::int AS compare_option_count
     FROM scenario_memory
     WHERE user_id = $1
       AND last_recommended_timing_mode IS NOT NULL
     GROUP BY last_recommended_timing_mode`,
    [userId]
  );

  return result.rows.reduce((acc, row) => {
    const total = Number(row.total || 0);
    const followed = Number(row.followed || 0);
    const deviated = Number(row.deviated || 0);
    acc[row.timing_mode] = {
      total,
      followed,
      deviated,
      compare_option_count: Number(row.compare_option_count || 0),
      follow_rate: total > 0 ? Number((followed / total).toFixed(3)) : null,
      deviation_rate: total > 0 ? Number((deviated / total).toFixed(3)) : null,
      net_signal: followed - deviated,
    };
    return acc;
  }, {});
}

async function refreshScenario(
  id,
  userId,
  {
    householdId = null,
    scope = 'personal',
    label,
    amount,
    month,
    timingMode = 'now',
    scenario,
    recommendedTimingMode = null,
    choiceFollowedRecommendation = null,
    choiceSource = null,
  }
) {
  const result = await db.query(
    `UPDATE scenario_memory
     SET household_id = $3,
         scope = $4,
         label = $5,
         amount = $6,
         month = $7,
         timing_mode = $8,
         last_affordability_status = $9,
         last_can_absorb = $10,
         last_projected_headroom_amount = $11,
         last_risk_adjusted_headroom_amount = $12,
         last_recurring_pressure_amount = $13,
         last_recommended_timing_mode = $14,
         last_choice_followed_recommendation = $15,
         last_choice_source = $16,
         last_evaluated_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND user_id = $2
     RETURNING *`,
    [
      id,
      userId,
      householdId || null,
      scope,
      label,
      amount,
      month,
      timingMode,
      scenario?.status || null,
      scenario?.can_absorb ?? null,
      scenario?.projected_headroom_amount ?? null,
      scenario?.risk_adjusted_headroom_amount ?? null,
      scenario?.recurring_pressure_amount ?? null,
      recommendedTimingMode,
      choiceFollowedRecommendation,
      choiceSource,
    ]
  );
  return normalize(result.rows[0] || null);
}

module.exports = {
  create,
  findByIdForUser,
  recordIntent,
  updateWatch,
  resolve,
  deferToNextMonth,
  listRecentActiveByUser,
  listActiveConsideringByUser,
  listWatchedByUser,
  listDeferredByUser,
  updateEvaluation,
  refreshScenario,
  summarizeChoiceFeedback,
  summarizeTimingPreferences,
};
