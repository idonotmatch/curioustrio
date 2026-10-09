import { invalidateCacheByPrefix } from './cache';
import { FRESHNESS_DOMAINS, markFreshnessStale } from './freshnessRegistry';

export async function refreshInsightsAfterFeedback() {
  await invalidateCacheByPrefix('cache:insights:');
  markFreshnessStale(FRESHNESS_DOMAINS.insights, {
    delayMs: 0,
    reason: 'insight_feedback',
  });
}
