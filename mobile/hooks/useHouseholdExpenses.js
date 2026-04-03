import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';

export function useHouseholdExpenses(month, startDayOverride) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    const params = [
      month && `month=${month}`,
      startDayOverride && `start_day=${startDayOverride}`,
    ].filter(Boolean).join('&');
    const url = params ? `/expenses/household?${params}` : '/expenses/household';
    await loadWithCache(
      `cache:household-expenses:${month || 'all'}:${startDayOverride || 'default'}`,
      () => api.get(url),
      (data) => { setExpenses(data); setLoading(false); },
      (err) => { setError(err.message); setLoading(false); },
    );
  }, [month, startDayOverride]);

  useEffect(() => { refresh(); }, [refresh]);

  // Server already filtered by month — sum all returned expenses
  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return { expenses, loading, error, refresh, total };
}
