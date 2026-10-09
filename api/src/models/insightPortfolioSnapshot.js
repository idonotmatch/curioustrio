const db = require('../db');

const INSIGHT_LOGIC_VERSION = 'evidence-quality-v6';
const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function isMissingTable(err) {
  return err?.code === '42P01' || /insight_portfolio_snapshots/i.test(`${err?.message || ''}`);
}

async function findByUser(userId) {
  try {
    const result = await db.query(
      `SELECT insights, source_event, source_fingerprint, generated_at
       FROM insight_portfolio_snapshots
       WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

async function sourceFingerprint(userId) {
  const result = await db.query(
    `WITH user_context AS (
       SELECT household_id FROM users WHERE id = $1
     )
     SELECT jsonb_build_object(
       'logic_version', '${INSIGHT_LOGIC_VERSION}',
       'expenses', (
         SELECT jsonb_build_array(
           COUNT(*),
           COALESCE(MAX(e.created_at), 'epoch'::timestamptz),
           COALESCE(SUM(e.amount), 0),
           COALESCE(SUM(hashtextextended(CONCAT_WS('|',
             e.id::text,
             e.merchant,
             e.amount::text,
             e.date::text,
             COALESCE(e.category_id::text, ''),
             e.source,
             e.status,
             COALESCE(e.is_private, FALSE)::text,
             COALESCE(e.exclude_from_budget, FALSE)::text
           ), 0)::numeric), 0)
         )
         FROM expenses e, user_context c
         WHERE e.user_id = $1
            OR (c.household_id IS NOT NULL
                AND e.household_id = c.household_id
                AND COALESCE(e.is_private, FALSE) = FALSE)
       ),
       'items', (
         SELECT jsonb_build_array(
           COUNT(*),
           COALESCE(MAX(i.created_at), 'epoch'::timestamptz),
           COALESCE(SUM(hashtextextended(CONCAT_WS('|',
             i.id::text,
             i.description,
             COALESCE(i.amount::text, ''),
             COALESCE(i.product_id::text, ''),
             COALESCE(i.comparable_key, ''),
             COALESCE(i.product_match_confidence, ''),
             COALESCE(i.product_match_reason, ''),
             COALESCE(i.source_type, ''),
             COALESCE(i.extraction_confidence, '')
           ), 0)::numeric), 0)
         )
         FROM expense_items i
         JOIN expenses e ON e.id = i.expense_id
         CROSS JOIN user_context c
         WHERE e.user_id = $1
            OR (c.household_id IS NOT NULL
                AND e.household_id = c.household_id
                AND COALESCE(e.is_private, FALSE) = FALSE)
       ),
       'budgets', (
         SELECT jsonb_build_array(COUNT(*), COALESCE(MAX(bs.updated_at), 'epoch'::timestamptz), COALESCE(SUM(bs.monthly_limit), 0))
         FROM budget_settings bs
         JOIN users u ON u.id = bs.user_id
         CROSS JOIN user_context c
         WHERE bs.user_id = $1 OR (c.household_id IS NOT NULL AND u.household_id = c.household_id)
       ),
       'events', (
         SELECT jsonb_build_array(COUNT(*), COALESCE(MAX(created_at), 'epoch'::timestamptz))
         FROM insight_events WHERE user_id = $1 AND event_type <> 'shown'
       ),
       'state', (
         SELECT jsonb_build_array(COUNT(*), COALESCE(MAX(updated_at), 'epoch'::timestamptz))
         FROM insight_state WHERE user_id = $1
       ),
       'plans', (
         SELECT jsonb_build_array(COUNT(*), COALESCE(MAX(updated_at), 'epoch'::timestamptz))
         FROM scenario_memory WHERE user_id = $1
       )
     ) AS fingerprint`,
    [userId]
  );
  return result.rows[0]?.fingerprint || {};
}

function matchesFingerprint(snapshot, fingerprint, {
  now = Date.now(),
  maxAgeMs = SNAPSHOT_MAX_AGE_MS,
} = {}) {
  if (!snapshot?.source_fingerprint || !fingerprint) return false;
  const generatedAt = new Date(snapshot.generated_at).getTime();
  if (!Number.isFinite(generatedAt) || now - generatedAt > maxAgeMs) return false;
  const containsExpiredInsight = (Array.isArray(snapshot.insights) ? snapshot.insights : [])
    .some((insight) => {
      if (!insight?.expires_at) return false;
      const expiresAt = new Date(insight.expires_at).getTime();
      return Number.isFinite(expiresAt) && expiresAt <= now;
    });
  if (containsExpiredInsight) return false;
  return JSON.stringify(snapshot.source_fingerprint) === JSON.stringify(fingerprint);
}

async function upsert(userId, insights, sourceEvent = {}, source = {}) {
  try {
    const result = await db.query(
      `INSERT INTO insight_portfolio_snapshots (user_id, insights, source_event, source_fingerprint, generated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET insights = EXCLUDED.insights,
                     source_event = EXCLUDED.source_event,
                     source_fingerprint = EXCLUDED.source_fingerprint,
                     generated_at = NOW()
       RETURNING generated_at`,
      [
        userId,
        JSON.stringify(Array.isArray(insights) ? insights : []),
        JSON.stringify(sourceEvent || {}),
        JSON.stringify(source || {}),
      ]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

async function invalidate(userId) {
  if (!userId) return;
  try {
    await db.query('DELETE FROM insight_portfolio_snapshots WHERE user_id = $1', [userId]);
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }
}

module.exports = {
  INSIGHT_LOGIC_VERSION,
  SNAPSHOT_MAX_AGE_MS,
  findByUser,
  invalidate,
  matchesFingerprint,
  sourceFingerprint,
  upsert,
};
