import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { api } from '../services/api';
import { invalidateCacheByPrefix } from '../services/cache';
import { patchExpenseInCachedLists, saveExpenseSnapshot } from '../services/expenseLocalStore';

export function useExpenseVisibilityControls({
  expenseId,
  expense,
  canEdit,
  canAdjustReviewControls,
  isPrivate,
  setIsPrivate,
  excludeFromBudget,
  setExcludeFromBudget,
  budgetExclusionReason,
  setBudgetExclusionReason,
  setExpense,
}) {
  const [savingControls, setSavingControls] = useState(false);

  const persistExpenseControls = useCallback(async (patch, optimisticState = {}) => {
    if (!canEdit || !expense) return expense;
    const previousExpense = expense;
    const nextExpense = {
      ...expense,
      ...optimisticState,
    };

    setExpense(nextExpense);
    if (optimisticState.is_private !== undefined) setIsPrivate(Boolean(optimisticState.is_private));
    if (optimisticState.exclude_from_budget !== undefined) setExcludeFromBudget(Boolean(optimisticState.exclude_from_budget));
    if (optimisticState.budget_exclusion_reason !== undefined) setBudgetExclusionReason(optimisticState.budget_exclusion_reason || null);

    setSavingControls(true);
    try {
      const refreshed = await api.patch(`/expenses/${expenseId}`, patch);
      setExpense(refreshed);
      setIsPrivate(Boolean(refreshed.is_private));
      setExcludeFromBudget(Boolean(refreshed.exclude_from_budget));
      setBudgetExclusionReason(refreshed.budget_exclusion_reason || null);
      saveExpenseSnapshot(refreshed);
      patchExpenseInCachedLists(refreshed);
      await Promise.all([
        invalidateCacheByPrefix('cache:expenses:'),
        invalidateCacheByPrefix('cache:budget:'),
        invalidateCacheByPrefix('cache:household-expenses:'),
        invalidateCacheByPrefix('cache:insights:'),
      ]);
      return refreshed;
    } catch (e) {
      setExpense(previousExpense);
      setIsPrivate(Boolean(previousExpense.is_private));
      setExcludeFromBudget(Boolean(previousExpense.exclude_from_budget));
      setBudgetExclusionReason(previousExpense.budget_exclusion_reason || null);
      Alert.alert('Error', e.message);
      return previousExpense;
    } finally {
      setSavingControls(false);
    }
  }, [
    canEdit,
    expense,
    expenseId,
    setBudgetExclusionReason,
    setExcludeFromBudget,
    setExpense,
    setIsPrivate,
  ]);

  const persistReviewControlsIfNeeded = useCallback(async () => {
    if (!canAdjustReviewControls || !expense) return expense;
    const nextReason = excludeFromBudget ? budgetExclusionReason : null;
    if (excludeFromBudget && !nextReason) {
      Alert.alert('Choose a reason', 'Pick why this should be tracked without counting it toward your budget.');
      return null;
    }
    const reviewControlsChanged =
      Boolean(expense.is_private) !== Boolean(isPrivate)
      || Boolean(expense.exclude_from_budget) !== Boolean(excludeFromBudget)
      || `${expense.budget_exclusion_reason || ''}` !== `${nextReason || ''}`;

    if (!reviewControlsChanged) return expense;

    try {
      const refreshed = await api.patch(`/expenses/${expenseId}`, {
        is_private: isPrivate,
        exclude_from_budget: excludeFromBudget,
        budget_exclusion_reason: nextReason,
      });
      setExpense(refreshed);
      saveExpenseSnapshot(refreshed);
      patchExpenseInCachedLists(refreshed);
      await Promise.all([
        invalidateCacheByPrefix('cache:expenses:'),
        invalidateCacheByPrefix('cache:budget:'),
        invalidateCacheByPrefix('cache:household-expenses:'),
        invalidateCacheByPrefix('cache:insights:'),
      ]);
      return refreshed;
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not save review options');
      return null;
    }
  }, [
    budgetExclusionReason,
    canAdjustReviewControls,
    excludeFromBudget,
    expense,
    expenseId,
    isPrivate,
    setExpense,
  ]);

  const handleTogglePrivate = useCallback(async (nextValue) => {
    if (!canEdit || savingControls) return;
    await persistExpenseControls(
      { is_private: nextValue },
      { is_private: nextValue }
    );
  }, [canEdit, persistExpenseControls, savingControls]);

  const handleToggleTrackOnly = useCallback(async (nextValue) => {
    if (!canEdit || savingControls) return;
    if (!nextValue) {
      await persistExpenseControls(
        {
          exclude_from_budget: false,
          budget_exclusion_reason: null,
        },
        {
          exclude_from_budget: false,
          budget_exclusion_reason: null,
        }
      );
      return;
    }

    const nextReason = budgetExclusionReason || expense?.budget_exclusion_reason || null;
    setExcludeFromBudget(true);
    if (nextReason) {
      setBudgetExclusionReason(nextReason);
      await persistExpenseControls(
        {
          exclude_from_budget: true,
          budget_exclusion_reason: nextReason,
        },
        {
          exclude_from_budget: true,
          budget_exclusion_reason: nextReason,
        }
      );
      return;
    }

    setExpense((current) => (current ? { ...current, exclude_from_budget: true } : current));
  }, [
    budgetExclusionReason,
    canEdit,
    expense,
    persistExpenseControls,
    savingControls,
    setBudgetExclusionReason,
    setExcludeFromBudget,
    setExpense,
  ]);

  const handleSelectBudgetExclusionReason = useCallback(async (reasonValue) => {
    if (!canEdit || savingControls) return;
    await persistExpenseControls(
      {
        exclude_from_budget: true,
        budget_exclusion_reason: reasonValue,
      },
      {
        exclude_from_budget: true,
        budget_exclusion_reason: reasonValue,
      }
    );
  }, [canEdit, persistExpenseControls, savingControls]);

  return {
    savingControls,
    persistReviewControlsIfNeeded,
    handleTogglePrivate,
    handleToggleTrackOnly,
    handleSelectBudgetExclusionReason,
  };
}
