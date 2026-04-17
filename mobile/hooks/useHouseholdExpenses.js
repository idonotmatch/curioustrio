import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { saveExpenseSnapshots, loadExpenseSnapshotsForMonth } from '../services/expenseLocalStore';

const REVALIDATE_TTL_MS = 2 * 60 * 1000; // 2 minutes

function isPastMonth(month) {
  if (!month) return false;
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return month < current;
}

export function useHouseholdExpenses(month, startDayOverride, { enabled = true } = {}) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);

  // TTL-respecting — safe for focus events
  const load = useCallback(async () => {
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
    const key = `cache:household-expenses:${month || 'all'}:${startDayOverride || 'default'}`;
    const onData = (data) => { setExpenses(data); setLoading(false); saveExpenseSnapshots(data); };
    const onError = (err) => { setError(err.message); setLoading(false); };

    if (isPastMonth(month)) {
      // 1. Try month-array cache
      try {
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
          const { data } = JSON.parse(raw);
          if (Array.isArray(data)) { onData(data); return; }
        }
      } catch {}
      // 2. Reconstruct from individual detail snapshots (offline-capable)
      const snapshots = await loadExpenseSnapshotsForMonth(month);
      if (snapshots) {
        onData(snapshots);
        AsyncStorage.setItem(key, JSON.stringify({ data: snapshots, ts: 0 })).catch(() => {});
        return;
      }
      // 3. Network fallback
      try {
        const fresh = await api.get(url);
        onData(fresh);
        AsyncStorage.setItem(key, JSON.stringify({ data: fresh, ts: Date.now() })).catch(() => {});
      } catch (err) { onError(err); }
      return;
    }

    await loadWithCache(key, () => api.get(url), onData, onError, { ttlMs: REVALIDATE_TTL_MS });
  }, [enabled, month, startDayOverride]);

  // Force revalidation — for pull-to-refresh
  const refresh = useCallback(async () => {
    if (!enabled) { setExpenses([]); setError(null); setLoading(false); return; }
    setError(null);
    const params = [
      month && `month=${month}`,
      startDayOverride && `start_day=${startDayOverride}`,
    ].filter(Boolean).join('&');
    const url = params ? `/expenses/household?${params}` : '/expenses/household';
    const key = `cache:household-expenses:${month || 'all'}:${startDayOverride || 'default'}`;
    await loadWithCache(
      key,
      () => api.get(url),
      (data) => { setExpenses(data); setLoading(false); saveExpenseSnapshots(data); },
      (err) => { setError(err.message); setLoading(false); },
    );
  }, [enabled, month, startDayOverride]);

  useEffect(() => { load(); }, [load]);

  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return { expenses, loading, error, refresh, softRefresh: load, total };
}
