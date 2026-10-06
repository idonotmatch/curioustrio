const db = require('../db');

function cleanDomains(domains = []) {
  return [...new Set((Array.isArray(domains) ? domains : [domains])
    .map((domain) => `${domain || ''}`.trim())
    .filter(Boolean))];
}

async function create({
  householdId = null,
  userId = null,
  targetUserId = null,
  eventType,
  domains = [],
  entityType = null,
  entityId = null,
  metadata = {},
} = {}) {
  const cleanEventType = `${eventType || ''}`.trim();
  const clean = cleanDomains(domains);
  if (!cleanEventType || !clean.length) return null;
  if (!householdId && !userId && !targetUserId) return null;

  const result = await db.query(
    `INSERT INTO household_freshness_events (
       household_id, user_id, target_user_id, event_type, domains,
       entity_type, entity_id, metadata
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, household_id, user_id, target_user_id, event_type, domains,
               entity_type, entity_id, metadata, created_at`,
    [
      householdId,
      userId,
      targetUserId,
      cleanEventType,
      clean,
      entityType,
      entityId,
      metadata && typeof metadata === 'object' ? JSON.stringify(metadata) : '{}',
    ]
  );
  return result.rows[0] || null;
}

async function listForUser(user, { since = null, sinceId = null, limit = 100 } = {}) {
  if (!user?.id) return [];

  const params = [user.id, user.household_id || null, Math.max(1, Math.min(Number(limit) || 100, 250))];
  let sinceClause = '';
  if (since) {
    params.push(since);
    const sincePosition = params.length;
    if (sinceId) {
      params.push(sinceId);
      sinceClause = `AND (
        created_at > $${sincePosition}::timestamptz
        OR (created_at = $${sincePosition}::timestamptz AND id > $${params.length}::uuid)
      )`;
    } else {
      sinceClause = `AND created_at > $${sincePosition}::timestamptz`;
    }
  }

  const result = await db.query(
    `SELECT id, household_id, user_id, target_user_id, event_type, domains,
            entity_type, entity_id, metadata, created_at
     FROM household_freshness_events
     WHERE (
       user_id = $1
       OR target_user_id = $1
       OR ($2::uuid IS NOT NULL AND household_id = $2)
     )
     ${sinceClause}
     ORDER BY created_at ASC, id ASC
     LIMIT $3`,
    params
  );
  return result.rows;
}

async function pruneOldRows(retentionDays = 30) {
  const days = Math.max(1, Math.min(Number(retentionDays) || 30, 90));
  const result = await db.query(
    `DELETE FROM household_freshness_events
     WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [days]
  );
  return { deleted: result.rowCount || 0, retention_days: days };
}

module.exports = {
  create,
  listForUser,
  pruneOldRows,
  cleanDomains,
};
