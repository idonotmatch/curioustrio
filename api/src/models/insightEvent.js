const db = require('../db');

const ALLOWED_EVENT_TYPES = new Set(['shown', 'tapped', 'dismissed', 'acted', 'helpful', 'not_helpful']);

class InsightEvent {
  static allowedEventTypes() {
    return [...ALLOWED_EVENT_TYPES];
  }

  static async getRecentByUser(userId, limit = 500) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 1000));
    const result = await db.query(
      `SELECT insight_id, event_type, metadata, created_at
       FROM insight_events
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, safeLimit]
    );
    return result.rows;
  }

  static async getRecentShownMap(userId, insightIds = [], windowHours = 6) {
    if (!insightIds.length) return new Map();
    const safeWindowHours = Math.max(1, Math.min(Number(windowHours) || 6, 24 * 30));
    const result = await db.query(
      `SELECT insight_id, MAX(created_at) AS created_at
       FROM insight_events
       WHERE user_id = $1
         AND insight_id = ANY($2::text[])
         AND event_type = 'shown'
         AND created_at >= NOW() - ($3::int * INTERVAL '1 hour')
       GROUP BY insight_id`,
      [userId, insightIds, safeWindowHours]
    );
    return new Map(result.rows.map((row) => [row.insight_id, row]));
  }

  static async createBatch(userId, events = []) {
    const clean = events
      .map((event) => ({
        insight_id: `${event?.insight_id || ''}`.trim(),
        event_type: `${event?.event_type || ''}`.trim(),
        metadata: event?.metadata ?? null,
      }))
      .filter((event) => event.insight_id && ALLOWED_EVENT_TYPES.has(event.event_type));

    if (!clean.length) return [];

    const values = [];
    const placeholders = clean.map((event, index) => {
      const offset = index * 4;
      values.push(userId, event.insight_id, event.event_type, event.metadata);
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
    });

    const result = await db.query(
      `INSERT INTO insight_events (user_id, insight_id, event_type, metadata)
       VALUES ${placeholders.join(', ')}
       RETURNING id, user_id, insight_id, event_type, metadata, created_at`,
      values
    );

    return result.rows;
  }
}

module.exports = InsightEvent;
