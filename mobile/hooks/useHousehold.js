import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

// Returns household info. memberCount is 0 if the user has no household.
export function useHousehold() {
  const [household, setHousehold] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.get('/households/me');
        setHousehold(data.household);
        setMembers(data.members || []);
      } catch {
        // 404 = not in a household; other errors are non-fatal
        setHousehold(null);
        setMembers([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [refreshKey]);

  return { household, members, memberCount: members.length, loading, refresh };
}
