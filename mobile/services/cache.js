import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Stale-while-revalidate: serve cache immediately, background-fetch unless cache is fresh.
 * Use for data that can be updated by other parties (household members, server-side sync).
 *
 * 1. If a cached value exists, calls onData immediately (instant render, no spinner).
 * 2. If cache is older than ttlMs (or ttlMs is 0), fetches fresh data in the background.
 * 3. Calls onData again with fresh data and writes it back to cache.
 * 4. Calls onError if the network fetch fails and no cache was served.
 *
 * @param {number} [options.ttlMs=0] - Skip background fetch if cache is newer than this.
 *   Pass 0 (default) to always revalidate. Pass a positive value to throttle (e.g. 2 * 60 * 1000).
 */
export async function loadWithCache(key, fetcher, onData, onError, { ttlMs = 0 } = {}) {
  let served = false;

  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const { data, ts } = JSON.parse(raw);
      onData(data);
      served = true;
      if (ttlMs > 0 && ts && (Date.now() - ts) < ttlMs) return;
    }
  } catch {
    // cache read failure is non-fatal
  }

  try {
    const fresh = await fetcher();
    onData(fresh);
    AsyncStorage.setItem(key, JSON.stringify({ data: fresh, ts: Date.now() })).catch(() => {});
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
export async function loadCacheOnly(key, fetcher, onData, onError) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const { data } = JSON.parse(raw);
      onData(data);
      return; // cache hit — skip network entirely
    }
  } catch {
    // cache read failure is non-fatal — fall through to network
  }

  try {
    const fresh = await fetcher();
    onData(fresh);
    AsyncStorage.setItem(key, JSON.stringify({ data: fresh, ts: Date.now() })).catch(() => {});
  } catch (err) {
    if (onError) onError(err);
  }
}

/** Remove a single cache entry (e.g. after a mutation). */
export async function invalidateCache(key) {
  try { await AsyncStorage.removeItem(key); } catch {}
}

/** Remove all cache entries whose key starts with a given prefix. */
export async function invalidateCacheByPrefix(prefix) {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const matching = keys.filter(k => k.startsWith(prefix));
    if (matching.length) await AsyncStorage.multiRemove(matching);
  } catch {}
}

/** Remove all cache entries (use on logout to prevent stale data leaking between sessions). */
export async function clearAllCache() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter(k => k.startsWith('cache:'));
    if (cacheKeys.length) await AsyncStorage.multiRemove(cacheKeys);
  } catch {}
}
