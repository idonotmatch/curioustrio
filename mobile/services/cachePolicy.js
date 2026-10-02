const DEFAULT_MAX_AGE_MS = 30 * 1000;

function isCacheFresh(timestamp, maxAgeMs = DEFAULT_MAX_AGE_MS, now = Date.now()) {
  const storedAt = Number(timestamp);
  const maxAge = Math.max(0, Number(maxAgeMs) || 0);
  return Number.isFinite(storedAt) && storedAt > 0 && maxAge > 0 && now - storedAt < maxAge;
}

module.exports = {
  DEFAULT_MAX_AGE_MS,
  isCacheFresh,
};
