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
    const cleanIds = [...new Set(insightIds.map((id) => `${id}`.trim()).filter(Boolean))];
    if (!cleanIds.length) return [];
    const values = [];
    const placeholders = cleanIds.map((insightId, index) => {
      const offset = index * 3;
      values.push(userId, insightId, channel);
      return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
    });
    const result = await db.query(
      `INSERT INTO insight_notifications (user_id, insight_id, channel)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (user_id, insight_id, channel) DO NOTHING
       RETURNING id, user_id, insight_id, channel, created_at`,
      values
    );
    return result.rows;
  }
}

module.exports = InsightNotification;
