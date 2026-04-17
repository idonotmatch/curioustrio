import { invalidateCacheByPrefix } from './cache';

// Centralized invalidation functions — call these after mutations instead of
// scattering invalidateCacheByPrefix calls across screens.

export async function invalidateAfterExpenseCreate() {
  await Promise.all([
    invalidateCacheByPrefix('cache:budget:'),
    invalidateCacheByPrefix('cache:household-expenses:'),
  ]);
}

export async function invalidateAfterExpenseEdit() {
  await Promise.all([
    invalidateCacheByPrefix('cache:expenses:'),
    invalidateCacheByPrefix('cache:budget:'),
    invalidateCacheByPrefix('cache:household-expenses:'),
  ]);
}

export async function invalidateAfterExpenseDelete() {
  await Promise.all([
    invalidateCacheByPrefix('cache:expenses:'),
    invalidateCacheByPrefix('cache:budget:'),
    invalidateCacheByPrefix('cache:household-expenses:'),
  ]);
}

export async function invalidateAfterPendingApproval() {
  await Promise.all([
    invalidateCacheByPrefix('cache:expenses:pending'),
    invalidateCacheByPrefix('cache:budget:'),
    invalidateCacheByPrefix('cache:household-expenses:'),
  ]);
}

export async function invalidateAfterPendingDismiss() {
  await invalidateCacheByPrefix('cache:expenses:pending');
}

export async function invalidateAfterRecurringMutation() {
  await invalidateCacheByPrefix('cache:insights:');
}

export async function invalidateAfterBudgetMutation() {
  await Promise.all([
    invalidateCacheByPrefix('cache:budget:'),
    invalidateCacheByPrefix('cache:expenses:'),
    invalidateCacheByPrefix('cache:household-expenses:'),
  ]);
}

export async function invalidateAfterCategoryMutation() {
  await Promise.all([
    invalidateCacheByPrefix('cache:categories'),
  ]);
}
