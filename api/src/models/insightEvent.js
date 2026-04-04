const db = require('../db');

const ALLOWED_EVENT_TYPES = new Set(['shown', 'tapped', 'dismissed', 'acted']);

class InsightEvent {
  static allowedEventTypes() {
    return [...ALLOWED_EVENT_TYPES];
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
