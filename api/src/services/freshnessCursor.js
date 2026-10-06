const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseFreshnessCursor(query = {}) {
  const since = query.since ? `${query.since}` : null;
  const sinceId = query.since_id ? `${query.since_id}` : null;
  if (since && Number.isNaN(Date.parse(since))) {
    return { error: 'Invalid freshness cursor timestamp', since: null, sinceId: null };
  }
  if (sinceId && (!since || !UUID_PATTERN.test(sinceId))) {
    return { error: 'Invalid freshness cursor id', since: null, sinceId: null };
  }
  return { error: null, since, sinceId };
}

module.exports = {
  parseFreshnessCursor,
};
