import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Stale-while-revalidate: serve cache immediately, always background-fetch.
 * Use for data that can be updated by other parties (household members, server-side sync).
 *
 * Options:
 *   ttlMs — if cache is younger than this, skip the background fetch entirely.
 *           Use for current-month data where hammering on every focus event is wasteful.
 *           Set ts: 0 on a cache entry to force revalidation regardless of TTL.
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
 * Use for past months (frozen data) or data only the local user can mutate.
 * After any mutation, call invalidateCache(key) so the next load re-fetches once.
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

/** Remove all cache:* entries — call on logout to prevent stale data leaking between accounts. */
export async function clearAllCache() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter(k => k.startsWith('cache:'));
    if (cacheKeys.length) await AsyncStorage.multiRemove(cacheKeys);
  } catch {}
}
