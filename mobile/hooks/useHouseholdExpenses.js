import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';

export function useHouseholdExpenses(month) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    await loadWithCache(
      `cache:household-expenses:${month || 'all'}`,
      () => api.get(month ? `/expenses/household?month=${month}` : '/expenses/household'),
      (data) => { setExpenses(data); setLoading(false); },
      (err) => { setError(err.message); setLoading(false); },
    );
  }, [month]);

  useEffect(() => { refresh(); }, [refresh]);

  // Server already filtered by month — sum all returned expenses
  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return { expenses, loading, error, refresh, total };
}
