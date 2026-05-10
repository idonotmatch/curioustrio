import { invalidateCache, invalidateCacheByPrefix } from './cache';
import { domainsForExpenseMutation, markFreshnessStale } from './freshnessRegistry';

export const EXPENSE_MUTATION_CACHE_PREFIXES = [
  'cache:expenses:',
  'cache:budget:',
  'cache:household-expenses:',
  'cache:insights:',
];

export async function invalidateExpenseMutationCaches({
  includePending = true,
  includeInsights = true,
} = {}) {
  const work = [];
  if (includePending) work.push(invalidateCache('cache:expenses:pending'));
  for (const prefix of EXPENSE_MUTATION_CACHE_PREFIXES) {
    if (!includeInsights && prefix === 'cache:insights:') continue;
    work.push(invalidateCacheByPrefix(prefix));
  }
  await Promise.all(work);
  markFreshnessStale(
    domainsForExpenseMutation({ includePending, includeInsights }),
    { reason: 'expense_mutation' },
  );
}
