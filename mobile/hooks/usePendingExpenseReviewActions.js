import { Alert } from 'react-native';
import { api } from '../services/api';
import { removePendingExpense } from './usePendingExpenses';
import { removeExpenseFromCachedLists, removeExpenseSnapshot, patchExpenseInCachedLists, saveExpenseSnapshot } from '../services/expenseLocalStore';

export function usePendingExpenseReviewActions({
  expenseId,
  router,
  setActioning,
  setShowDismissReasonSheet,
  persistReviewControlsIfNeeded,
  isItemsFirstReview,
  isQuickCheckReview,
}) {
  async function approvePendingExpense() {
    setActioning(true);
    try {
      const persistedExpense = await persistReviewControlsIfNeeded();
      if (!persistedExpense) {
        setActioning(false);
        return;
      }
      const reviewContext = isItemsFirstReview
        ? 'items_first'
        : isQuickCheckReview
          ? 'quick_check'
          : 'full_review';
      const approved = await api.post(`/expenses/${expenseId}/approve`, { review_context: reviewContext });
      if (approved?.id) {
        await saveExpenseSnapshot(approved);
        await patchExpenseInCachedLists(approved);
      }
      const { invalidateCache, invalidateCacheByPrefix } = await import('../services/cache');
      await Promise.all([
        invalidateCache('cache:expenses:pending'),
        invalidateCacheByPrefix('cache:expenses:'),
        invalidateCacheByPrefix('cache:budget:'),
        invalidateCacheByPrefix('cache:household-expenses:'),
        invalidateCacheByPrefix('cache:insights:'),
      ]);
      removePendingExpense(expenseId);
      router.back();
    } catch (e) {
      Alert.alert('Error', e.message);
      setActioning(false);
    }
  }

  async function dismissPendingExpense(dismissalReason) {
    setActioning(true);
    try {
      await api.post(`/expenses/${expenseId}/dismiss`, { dismissal_reason: dismissalReason });
      await removeExpenseFromCachedLists(expenseId);
      await removeExpenseSnapshot(expenseId);
      const { invalidateCache, invalidateCacheByPrefix } = await import('../services/cache');
      await Promise.all([
        invalidateCache('cache:expenses:pending'),
        invalidateCacheByPrefix('cache:expenses:'),
        invalidateCacheByPrefix('cache:budget:'),
        invalidateCacheByPrefix('cache:household-expenses:'),
        invalidateCacheByPrefix('cache:insights:'),
      ]);
      removePendingExpense(expenseId);
      setShowDismissReasonSheet(false);
      router.back();
    } catch (e) {
      Alert.alert('Error', e.message);
      setActioning(false);
    }
  }

  return {
    approvePendingExpense,
    dismissPendingExpense,
  };
}
