let activeUserId = null;

function normalizeUserId(value) {
  const normalized = `${value || ''}`.trim();
  return normalized || null;
}

export function setActiveCacheUserId(userId) {
  const nextUserId = normalizeUserId(userId);
  const previousUserId = activeUserId;
  activeUserId = nextUserId;
  return { previousUserId, userId: nextUserId, changed: previousUserId !== nextUserId };
}

export function clearActiveCacheUserId() {
  const previousUserId = activeUserId;
  activeUserId = null;
  return previousUserId;
}

export function getActiveCacheUserId() {
  return activeUserId;
}

export function scopedCacheKey(key) {
  const baseKey = `${key || ''}`;
  return `${baseKey}:user:${encodeURIComponent(activeUserId || 'anonymous')}`;
}

export function isActiveUserCacheKey(key) {
  const suffix = `:user:${encodeURIComponent(activeUserId || 'anonymous')}`;
  return `${key || ''}`.endsWith(suffix);
}

export function unscopedCacheKey(key) {
  return `${key || ''}`.replace(/:user:[^:]+$/, '');
}

export function cacheKeyForDisplay(key) {
  return unscopedCacheKey(key);
}
