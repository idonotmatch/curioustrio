const db = require('../db');

class InsightNotification {
  static async findSentIds(userId, insightIds = [], channel = 'push') {
    const cleanIds = insightIds.map((id) => `${id}`.trim()).filter(Boolean);
    if (!cleanIds.length) return new Set();
    const result = await db.query(
      `SELECT insight_id
       FROM insight_notifications
       WHERE user_id = $1
         AND channel = $2
         AND insight_id = ANY($3::text[])`,
      [userId, channel, cleanIds]
    );
    return new Set(result.rows.map((row) => row.insight_id));
  }

  static async createBatch(userId, insightIds = [], channel = 'push') {
    const cleanInsights = [...new Map(insightIds.map((value) => {
      const insight = typeof value === 'object' ? value : { id: value };
      const id = `${insight?.id || ''}`.trim();
      return [id, { id, continuityKey: `${insight?.metadata?.continuity_key || ''}`.trim() || null }];
    }).filter(([id]) => id)).values()];
    if (!cleanInsights.length) return [];
    const values = [];
    const placeholders = cleanInsights.map((insight, index) => {
      const offset = index * 4;
      values.push(userId, insight.id, channel, insight.continuityKey);
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
    });
    const result = await db.query(
      `INSERT INTO insight_notifications (user_id, insight_id, channel, continuity_key)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (user_id, insight_id, channel) DO NOTHING
       RETURNING id, user_id, insight_id, channel, continuity_key, created_at`,
      values
    );
    return result.rows;
  }

  static async findRecentContinuityKeys(userId, continuityKeys = [], channel = 'push', since = null) {
    const keys = [...new Set(continuityKeys.map((key) => `${key || ''}`.trim()).filter(Boolean))];
    if (!keys.length) return new Set();
    const result = await db.query(
      `SELECT DISTINCT continuity_key
       FROM insight_notifications
       WHERE user_id = $1
         AND channel = $2
         AND continuity_key = ANY($3::text[])
         AND ($4::timestamptz IS NULL OR created_at >= $4::timestamptz)`,
      [userId, channel, keys, since]
    );
    return new Set(result.rows.map((row) => row.continuity_key).filter(Boolean));
  }

  static async hasSentSince(userId, channel = 'push', since = null) {
    const result = await db.query(
      `SELECT EXISTS (
         SELECT 1 FROM insight_notifications
         WHERE user_id = $1
           AND channel = $2
           AND ($3::timestamptz IS NULL OR created_at >= $3::timestamptz)
       ) AS exists`,
      [userId, channel, since]
    );
    return result.rows[0]?.exists === true;
  }
}

module.exports = InsightNotification;
