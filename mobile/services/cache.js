import AsyncStorage from '@react-native-async-storage/async-storage';
const { isCacheFresh } = require('./cachePolicy');
const {
  scopedCacheKey,
  isActiveUserCacheKey,
} = require('./cacheIdentity');

const DEFAULT_MAX_AGE_MS = 30 * 1000;

function normalizeCacheData(data, serialize) {
  try {
    return typeof serialize === 'function' ? serialize(data) : data;
  } catch {
    return data;
  }
}

/**
 * Fresh-while-revalidate: serve cache immediately and only revalidate stale data.
 * Use for data that can be updated by other parties (household members, server-side sync).
 *
 * 1. If a cached value exists, calls onData immediately (instant render, no spinner).
 * 2. Skips the network while the cached value is inside its freshness window.
 * 3. Calls onData again with fresh data and writes it back to cache.
 * 4. Calls onError if the network fetch fails and no cache was served.
 */
export async function loadWithCache(key, fetcher, onData, onError, {
  serialize,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  forceRefresh = false,
} = {}) {
  const storageKey = scopedCacheKey(key);
  let served = false;
  let cacheIsFresh = false;

  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (raw) {
      const { data, ts } = JSON.parse(raw);
      const normalized = normalizeCacheData(data, serialize);
      onData(normalized);
      served = true;
      cacheIsFresh = isCacheFresh(ts, maxAgeMs);
      if (normalized !== data) {
        AsyncStorage.setItem(storageKey, JSON.stringify({ data: normalized, ts: Date.now() })).catch(() => {});
      }
    }
  } catch {
    // cache read failure is non-fatal
  }

  if (served && cacheIsFresh && !forceRefresh) return;

  try {
    const fresh = await fetcher();
    onData(fresh);
    const normalized = normalizeCacheData(fresh, serialize);
    AsyncStorage.setItem(storageKey, JSON.stringify({ data: normalized, ts: Date.now() })).catch(() => {});
  } catch (err) {
    if (!served && onError) onError(err);
  }
}

/**
 * Cache-first: serve cache if it exists and skip the network call entirely.
 * Use for data only the local user can mutate (personal expenses, personal budget).
 * After any mutation, call invalidateCache(key) so the next load re-fetches once.
 *
 * 1. If a cached value exists, calls onData immediately and returns — no network call.
 * 2. If no cache (first load or after invalidation), fetches, caches, then calls onData.
 * 3. Calls onError if fetch fails and no cache was served.
 */
export async function loadCacheOnly(key, fetcher, onData, onError, {
  serialize,
  forceRefresh = false,
} = {}) {
  const storageKey = scopedCacheKey(key);
  let served = false;
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (raw) {
      const { data } = JSON.parse(raw);
      const normalized = normalizeCacheData(data, serialize);
      onData(normalized);
      served = true;
      if (normalized !== data) {
        AsyncStorage.setItem(storageKey, JSON.stringify({ data: normalized, ts: Date.now() })).catch(() => {});
      }
      if (!forceRefresh) return; // cache hit — skip network entirely
    }
  } catch {
    // cache read failure is non-fatal — fall through to network
  }

  try {
    const fresh = await fetcher();
    onData(fresh);
    const normalized = normalizeCacheData(fresh, serialize);
    AsyncStorage.setItem(storageKey, JSON.stringify({ data: normalized, ts: Date.now() })).catch(() => {});
  } catch (err) {
    if (!served && onError) onError(err);
  }
}

/**
 * Network-first with cache fallback:
 * 1. Try to fetch fresh data first.
 * 2. If fetch succeeds, serve it and overwrite cache.
 * 3. If fetch fails, fall back to cached data if present.
 * 4. Only call onError if both network and cache miss/fail.
 */
export async function loadFreshWithCacheFallback(key, fetcher, onData, onError, { serialize } = {}) {
  const storageKey = scopedCacheKey(key);
  try {
    const fresh = await fetcher();
    onData(fresh);
    const normalized = normalizeCacheData(fresh, serialize);
    AsyncStorage.setItem(storageKey, JSON.stringify({ data: normalized, ts: Date.now() })).catch(() => {});
    return;
  } catch (networkErr) {
    try {
      const raw = await AsyncStorage.getItem(storageKey);
      if (raw) {
        const { data } = JSON.parse(raw);
        const normalized = normalizeCacheData(data, serialize);
        onData(normalized);
        if (normalized !== data) {
          AsyncStorage.setItem(storageKey, JSON.stringify({ data: normalized, ts: Date.now() })).catch(() => {});
        }
        return;
      }
    } catch {
      // cache read failure is non-fatal
    }

    if (onError) onError(networkErr);
  }
}

/** Remove a single cache entry (e.g. after a mutation). */
export async function invalidateCache(key) {
  try {
    await AsyncStorage.multiRemove([key, scopedCacheKey(key)]);
  } catch {}
}

/** Remove all cache entries whose key starts with a given prefix. */
export async function invalidateCacheByPrefix(prefix) {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const matching = keys.filter(k => k.startsWith(prefix));
    if (matching.length) await AsyncStorage.multiRemove(matching);
  } catch {}
}

export { isActiveUserCacheKey };
