/**
 * Named cache invalidation helpers.
 * All mutation paths should use these instead of hand-rolling invalidateCacheByPrefix calls,
 * so that new cache keys only need to be added in one place.
 */
import { invalidateCache, invalidateCacheByPrefix } from './cache';

/**
 * After creating or approving an expense (write-through callers update the list cache directly;
 * only budget and household aggregates need a full invalidation).
 */
export async function invalidateAfterExpenseCreate() {
  return Promise.all([
    invalidateCacheByPrefix('cache:budget:'),
    invalidateCacheByPrefix('cache:household-expenses:'),
  ]);
}

/**
 * After editing an existing expense (list cache must also refresh since the row changed).
 */
export async function invalidateAfterExpenseEdit() {
  return Promise.all([
    invalidateCacheByPrefix('cache:expenses:'),
    invalidateCacheByPrefix('cache:budget:'),
    invalidateCacheByPrefix('cache:household-expenses:'),
  ]);
}

/**
 * After deleting an expense (full list + aggregate invalidation).
 */
export async function invalidateAfterExpenseDelete() {
  return Promise.all([
    invalidateCacheByPrefix('cache:expenses:'),
    invalidateCacheByPrefix('cache:budget:'),
    invalidateCacheByPrefix('cache:household-expenses:'),
  ]);
}

/**
 * After approving a pending expense from the review queue.
 * Clears pending + full list so "Mine" reconciles immediately.
 */
export async function invalidateAfterPendingApproval() {
  return Promise.all([
    invalidateCache('cache:expenses:pending'),
    invalidateCacheByPrefix('cache:budget:'),
    invalidateCacheByPrefix('cache:household-expenses:'),
  ]);
}

/**
 * After dismissing a pending expense.
 */
export async function invalidateAfterPendingDismiss() {
  return invalidateCache('cache:expenses:pending');
}

/**
 * After saving or removing a recurring rule (insights depend on recurring patterns).
 */
export async function invalidateAfterRecurringMutation() {
  return invalidateCacheByPrefix('cache:insights:');
}

/**
 * After saving budget settings (limit or period change).
 */
export async function invalidateAfterBudgetMutation() {
  return Promise.all([
    invalidateCacheByPrefix('cache:budget:'),
    invalidateCacheByPrefix('cache:expenses:'),
    invalidateCacheByPrefix('cache:household-expenses:'),
  ]);
}

/**
 * After any category mutation (add, edit, delete, merge, suggestion accept/reject).
 */
export async function invalidateAfterCategoryMutation() {
  return Promise.all([
    invalidateCache('cache:categories'),
    invalidateCache('cache:categories:include_hidden'),
  ]);
}
