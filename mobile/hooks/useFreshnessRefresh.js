import { useEffect, useRef } from 'react';
import { registerFreshnessHandler } from '../services/freshnessRegistry';

export function useFreshnessRefresh(domains, refresh, options = {}) {
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    return registerFreshnessHandler(
      domains,
      (context) => refreshRef.current?.(context),
      options,
    );
  }, [
    Array.isArray(domains) ? domains.join('|') : domains,
    options?.delayMs,
    options?.refreshIfStale,
  ]);
}
