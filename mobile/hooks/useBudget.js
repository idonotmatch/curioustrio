import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';

export function useBudget(month, scope) {
  const [budget, setBudget] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const params = [
        month && `month=${month}`,
        scope && `scope=${scope}`,
      ].filter(Boolean).join('&');
      const url = params ? `/budgets?${params}` : '/budgets';
      const data = await api.get(url);
      setBudget(data);
    } catch {
      setBudget(null);
    } finally {
      setLoading(false);
    }
  }, [month, scope]);

  useEffect(() => { refresh(); }, [refresh]);

  return { budget, loading, refresh };
}
