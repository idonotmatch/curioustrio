import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { saveExpenseSnapshots } from '../services/expenseLocalStore';

export function useHouseholdExpenses(month, startDayOverride, { enabled = true } = {}) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setExpenses([]);
      setError(null);
      setLoading(false);
      return;
    }
    setError(null);
    const params = [
      month && `month=${month}`,
      startDayOverride && `start_day=${startDayOverride}`,
    ].filter(Boolean).join('&');
    const url = params ? `/expenses/household?${params}` : '/expenses/household';
    await loadWithCache(
      `cache:household-expenses:${month || 'all'}:${startDayOverride || 'default'}`,
      () => api.get(url),
      (data) => {
        setExpenses(data);
        setLoading(false);
        saveExpenseSnapshots(data);
      },
      (err) => { setError(err.message); setLoading(false); },
    );
  }, [enabled, month, startDayOverride]);

  useEffect(() => { refresh(); }, [refresh]);

  // Server already filtered by month — sum all returned expenses
  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return { expenses, loading, error, refresh, total };
}
