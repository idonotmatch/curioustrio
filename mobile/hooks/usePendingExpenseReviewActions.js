import { Alert } from 'react-native';
import { api } from '../services/api';
import { removePendingExpense, restorePendingExpense } from './usePendingExpenses';
import { removeExpenseFromCachedLists, removeExpenseSnapshot, patchExpenseInCachedLists, saveExpenseSnapshot } from '../services/expenseLocalStore';
import { invalidateExpenseMutationCaches } from '../services/expenseMutationEffects';

export function usePendingExpenseReviewActions({
  expenseId,
  expense,
  router,
  setActioning,
  setShowDismissReasonSheet,
  persistReviewControlsIfNeeded,
  isItemsFirstReview,
  isQuickCheckReview,
}) {
  async function approvePendingExpense() {
    setActioning(true);
    let persistedExpense = null;
    let didOptimisticallyLeave = false;
    try {
      persistedExpense = await persistReviewControlsIfNeeded();
      if (!persistedExpense) {
        setActioning(false);
        return;
      }
      const reviewContext = isItemsFirstReview
        ? 'items_first'
        : isQuickCheckReview
          ? 'quick_check'
          : 'full_review';
      removePendingExpense(expenseId);
      router.back();
      didOptimisticallyLeave = true;
      const approved = await api.post(`/expenses/${expenseId}/approve`, { review_context: reviewContext });
      if (approved?.id) {
        Promise.all([
          saveExpenseSnapshot(approved),
          patchExpenseInCachedLists(approved),
          invalidateExpenseMutationCaches(),
        ]).catch(() => {});
      } else {
        invalidateExpenseMutationCaches().catch(() => {});
      }
    } catch (e) {
      restorePendingExpense(persistedExpense || expense);
      Alert.alert('Error', e.message);
      if (!didOptimisticallyLeave) setActioning(false);
    }
  }

  async function dismissPendingExpense(dismissalReason) {
    let didOptimisticallyLeave = false;
    setActioning(true);
    setShowDismissReasonSheet(false);
    removePendingExpense(expenseId);
    router.back();
    didOptimisticallyLeave = true;
    try {
      await api.post(`/expenses/${expenseId}/dismiss`, { dismissal_reason: dismissalReason });
      Promise.all([
        removeExpenseFromCachedLists(expenseId),
        removeExpenseSnapshot(expenseId),
        invalidateExpenseMutationCaches(),
      ]).catch(() => {});
    } catch (e) {
      restorePendingExpense(expense);
      Alert.alert('Error', e.message);
      if (!didOptimisticallyLeave) setActioning(false);
    }
  }

  return {
    approvePendingExpense,
    dismissPendingExpense,
  };
}
