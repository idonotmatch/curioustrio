import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Stale-while-revalidate cache helper.
 *
 * 1. If a cached value exists, calls onData immediately (instant render, no spinner).
 * 2. Always fetches fresh data in the background regardless of cache age.
 * 3. Calls onData again with fresh data and writes it back to cache.
 * 4. Calls onError if the network fetch fails (and no cache was served).
 */
export async function loadWithCache(key, fetcher, onData, onError) {
  let served = false;

  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const { data } = JSON.parse(raw);
      onData(data);
      served = true;
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
