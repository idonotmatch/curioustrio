import { invalidateCacheByPrefixes } from './cache';
import { domainsForExpenseMutation, markFreshnessStale } from './freshnessRegistry';

export const EXPENSE_MUTATION_CACHE_PREFIXES = [
  'cache:expenses:',
  'cache:budget:',
  'cache:household-expenses:',
  'cache:insights:',
  'cache:item-trends:',
  'cache:recurring-item:',
];

export async function invalidateExpenseMutationCaches({
  includePending = true,
  includeInsights = true,
} = {}) {
  const prefixes = EXPENSE_MUTATION_CACHE_PREFIXES.filter(
    (prefix) => includeInsights || prefix !== 'cache:insights:'
  );
  await invalidateCacheByPrefixes(prefixes);
  markFreshnessStale(
    domainsForExpenseMutation({ includePending, includeInsights }),
    { reason: 'expense_mutation' },
  );
}
