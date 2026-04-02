import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';

// Returns household info. memberCount is 0 if the user has no household.
export function useHousehold() {
  const [household, setHousehold] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  useEffect(() => {
    loadWithCache(
      'cache:household',
      () => api.get('/households/me'),
      (data) => {
        setHousehold(data?.household ?? null);
        setMembers(data?.members ?? []);
        setLoading(false);
      },
      () => {
        // 404 = not in a household; other errors are non-fatal
        setHousehold(null);
        setMembers([]);
        setLoading(false);
      },
    );
  }, [refreshKey]);

  return { household, members, memberCount: members.length, loading, refresh };
}
