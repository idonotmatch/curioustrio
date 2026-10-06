const DEFAULT_FRESHNESS_PAGE_SIZE = 100;

function compareFreshnessCursor(left = {}, right = {}) {
  const leftCreatedAt = `${left.created_at || ''}`;
  const rightCreatedAt = `${right.created_at || ''}`;
  if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt.localeCompare(rightCreatedAt);
  return `${left.id || ''}`.localeCompare(`${right.id || ''}`);
}

function advanceFreshnessCursor(cursor, events = []) {
  let next = cursor || null;
  for (const event of Array.isArray(events) ? events : []) {
    if (!event?.created_at || !event?.id) continue;
    if (!next || compareFreshnessCursor(event, next) > 0) {
      next = { created_at: event.created_at, id: event.id };
    }
  }
  return next;
}

function buildFreshnessEventsPath(cursor, limit = DEFAULT_FRESHNESS_PAGE_SIZE) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_FRESHNESS_PAGE_SIZE, 250));
  const params = [`limit=${safeLimit}`];
  if (cursor?.created_at) params.push(`since=${encodeURIComponent(cursor.created_at)}`);
  if (cursor?.created_at && cursor?.id) params.push(`since_id=${encodeURIComponent(cursor.id)}`);
  return `/freshness/events?${params.join('&')}`;
}

module.exports = {
  DEFAULT_FRESHNESS_PAGE_SIZE,
  advanceFreshnessCursor,
  buildFreshnessEventsPath,
  compareFreshnessCursor,
};
