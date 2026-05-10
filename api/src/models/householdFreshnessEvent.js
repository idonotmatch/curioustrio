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

async function listForUser(user, { since = null, limit = 100 } = {}) {
  if (!user?.id) return [];

  const params = [user.id, user.household_id || null, Math.max(1, Math.min(Number(limit) || 100, 250))];
  let sinceClause = '';
  if (since) {
    params.push(since);
    sinceClause = `AND created_at > $${params.length}`;
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
     ORDER BY created_at ASC
     LIMIT $3`,
    params
  );
  return result.rows;
}

module.exports = {
  create,
  listForUser,
  cleanDomains,
};
