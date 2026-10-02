import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { FRESHNESS_DOMAINS } from '../services/freshnessRegistry';
import { useFreshnessRefresh } from './useFreshnessRefresh';

const SUMMARY_DOMAINS = [
  FRESHNESS_DOMAINS.expenses,
  FRESHNESS_DOMAINS.householdExpenses,
  FRESHNESS_DOMAINS.budget,
  FRESHNESS_DOMAINS.household,
  FRESHNESS_DOMAINS.watchedPlans,
];

export function useSummaryBundle(period, startDay) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async (options = {}) => {
    setError(null);
    const query = [
      `period=${encodeURIComponent(period)}`,
      startDay ? `start_day=${encodeURIComponent(startDay)}` : null,
    ].filter(Boolean).join('&');
    await loadWithCache(
      `cache:summary-bundle:v1:${period}:${startDay || 'default'}`,
      () => api.get(`/summary?${query}`),
      (data) => {
        setSummary(data || null);
        setLoading(false);
      },
      (err) => {
        setError(err?.message || 'Could not refresh summary');
        setLoading(false);
      },
      { forceRefresh: options?.forceRefresh === true },
    );
  }, [period, startDay]);

  useEffect(() => { refresh(); }, [refresh]);
  useFreshnessRefresh(SUMMARY_DOMAINS, refresh, { delayMs: 700 });

  return { summary, loading, error, refresh };
}
