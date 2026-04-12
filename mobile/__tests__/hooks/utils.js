/**
 * Shared test utilities for hook tests.
 *
 * loadWithCache is mocked to simulate a cache miss with a successful fetch —
 * calls the fetcher immediately and pipes the result to onData.
 *
 * loadCacheOnly follows the same pattern.
 */

export function mockCachePassthrough(loadWithCache, loadCacheOnly) {
  loadWithCache.mockImplementation(async (_key, fetcher, onData, onError) => {
    try {
      const data = await fetcher();
      onData(data);
    } catch (err) {
      if (onError) onError(err);
    }
  });

  if (loadCacheOnly) {
    loadCacheOnly.mockImplementation(async (_key, fetcher, onData, onError) => {
      try {
        const data = await fetcher();
        onData(data);
      } catch (err) {
        if (onError) onError(err);
      }
    });
  }
}

export function mockCacheError(loadWithCache) {
  loadWithCache.mockImplementation(async (_key, _fetcher, _onData, onError) => {
    if (onError) onError(new Error('Network error'));
  });
}
