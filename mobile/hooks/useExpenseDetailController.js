import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { api } from '../services/api';
import { invalidateCacheByPrefix } from '../services/cache';
import { invalidateExpenseMutationCaches } from '../services/expenseMutationEffects';
import { useExpenseVisibilityControls } from './useExpenseVisibilityControls';
import {
  applyExpenseToState,
  bootstrapExpenseRecord,
  buildExpensePatchPayload,
  createExpenseSetters,
  mergeReviewMetadata,
} from '../services/expenseDetailState';
import {
  patchExpenseInCachedLists,
  removeExpenseFromCachedLists,
  removeExpenseSnapshot,
  saveExpenseSnapshot,
} from '../services/expenseLocalStore';
const { expenseDraftError } = require('../services/expenseValidation');
const { createEditableExpenseItem } = require('../services/itemEditing');

export function useExpenseDetailController({ id, expenseParam, currentUserId, router }) {
  const [expense, setExpense] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [editing, setEditingState] = useState(false);
  const editingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [showDismissReasonSheet, setShowDismissReasonSheet] = useState(false);
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [categoryId, setCategoryId] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('unknown');
  const [cardLast4, setCardLast4] = useState('');
  const [cardLabel, setCardLabel] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [excludeFromBudget, setExcludeFromBudget] = useState(false);
  const [budgetExclusionReason, setBudgetExclusionReason] = useState(null);
  const [items, setItems] = useState([]);
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const [itemsEdits, setItemsEditsState] = useState([]);
  const itemsHydratedRef = useRef(false);
  const itemsDirtyRef = useRef(false);
  const [locationData, setLocationData] = useState(null);
  const [recurringPreference, setRecurringPreference] = useState(null);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [recurringFrequencyDays, setRecurringFrequencyDays] = useState('');
  const [recurringNotes, setRecurringNotes] = useState('');
  const [secondaryDetailsExpanded, setSecondaryDetailsExpanded] = useState(false);
  const [activeReviewField, setActiveReviewField] = useState(null);

  const setters = createExpenseSetters({
    setExpense,
    setMerchant,
    setAmount,
    setDate,
    setNotes,
    setCategoryId,
    setPaymentMethod,
    setCardLast4,
    setCardLabel,
    setIsPrivate,
    setExcludeFromBudget,
    setBudgetExclusionReason,
    setItems,
    setLocationData,
    setItemsEdits: setItemsEditsState,
  });

  const setEditing = useCallback((value) => {
    setEditingState((current) => {
      const next = typeof value === 'function' ? value(current) : Boolean(value);
      if (next !== current) itemsDirtyRef.current = false;
      editingRef.current = next;
      return next;
    });
  }, []);

  const setItemsEdits = useCallback((value) => {
    itemsDirtyRef.current = true;
    setItemsEditsState(value);
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoadError(null);
      const freshRequest = api.get(`/expenses/${id}`, { dedupe: false })
        .then((data) => ({ data, error: null }))
        .catch((error) => ({ data: null, error }));
      let bootstrapped = null;
      try {
        bootstrapped = await bootstrapExpenseRecord(id, expenseParam);
      } catch {
        bootstrapped = null;
      }
      if (active && bootstrapped) {
        applyExpenseToState(bootstrapped, setters);
        itemsHydratedRef.current = Array.isArray(bootstrapped.items);
        setLoading(false);
      }

      try {
        const freshResult = await freshRequest;
        if (freshResult.error) throw freshResult.error;
        const fresh = freshResult.data;
        if (!active) return;
        const merged = mergeReviewMetadata(bootstrapped, fresh);
        if (editingRef.current) {
          setExpense(merged);
          setItems(Array.isArray(merged?.items) ? merged.items : []);
          if (!itemsDirtyRef.current && Array.isArray(merged?.items)) {
            setItemsEditsState(merged.items.map((item) => createEditableExpenseItem(item)));
            itemsHydratedRef.current = true;
          }
        } else {
          applyExpenseToState(merged, setters);
          itemsHydratedRef.current = Array.isArray(merged?.items);
        }
        setLoading(false);
        saveExpenseSnapshot(merged);
      } catch (error) {
        if (active && !bootstrapped) {
          setLoadError({
            status: error?.status || null,
            message: error?.message || 'Could not load this expense.',
          });
          setLoading(false);
        }
      }
    }

    load();
    return () => { active = false; };
  }, [expenseParam, id, loadAttempt]);

  const retryLoad = useCallback(() => {
    setLoading(true);
    setLoadAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    api.get(`/recurring/preferences?expense_id=${encodeURIComponent(id)}`)
      .then((pref) => {
        setRecurringPreference(pref || null);
        setRecurringFrequencyDays(pref?.expected_frequency_days ? String(pref.expected_frequency_days) : '');
        setRecurringNotes(pref?.notes || '');
      })
      .catch(() => {
        setRecurringPreference(null);
        setRecurringFrequencyDays('');
        setRecurringNotes('');
      });
  }, [id]);

  const canEdit = !!currentUserId && !!expense && String(expense.user_id) === String(currentUserId);
  const canAdjustReviewControls = canEdit && expense?.status === 'pending' && expense?.source === 'email';

  const visibilityControls = useExpenseVisibilityControls({
    expenseId: id,
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
  });

  useEffect(() => {
    if (!canEdit && editing) setEditing(false);
  }, [canEdit, editing]);

  useEffect(() => {
    if (!excludeFromBudget) {
      setBudgetExclusionReason(null);
    }
  }, [excludeFromBudget, budgetExclusionReason]);

  async function handleSave() {
    setSaving(true);
    try {
      const validationError = expenseDraftError({ merchant, amount, date });
      if (validationError) {
        Alert.alert('Check expense details', validationError);
        return;
      }
      if (excludeFromBudget && !budgetExclusionReason) {
        Alert.alert('Choose a reason', 'Pick why this should be tracked without counting it toward your budget.');
        return;
      }
      const updated = await api.patch(`/expenses/${id}`, buildExpensePatchPayload({
        merchant,
        amount,
        isRefund: Number(expense?.amount) < 0,
        date,
        notes,
        categoryId,
        paymentMethod,
        cardLast4,
        cardLabel,
        isPrivate,
        excludeFromBudget,
        budgetExclusionReason,
        locationData,
        itemsEdits,
        includeItems: itemsHydratedRef.current || itemsDirtyRef.current,
      }));
      const refreshed = mergeReviewMetadata(expense, updated);
      applyExpenseToState(refreshed, setters);
      setExpense(refreshed);
      saveExpenseSnapshot(refreshed);
      patchExpenseInCachedLists(refreshed);
      setEditing(false);
      await invalidateExpenseMutationCaches();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    Alert.alert('Delete expense', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setDeleting(true);
          try {
            await api.delete(`/expenses/${id}`);
            await removeExpenseFromCachedLists(id);
            await removeExpenseSnapshot(id);
            await invalidateExpenseMutationCaches();
            router.back();
          } catch (e) {
            Alert.alert('Error', e.message);
            setDeleting(false);
          }
        },
      },
    ]);
  }

  async function saveRecurringPreference() {
    try {
      setActioning(true);
      const saved = await api.post('/recurring/preferences', {
        expense_id: id,
        expected_frequency_days: recurringFrequencyDays.trim() ? parseInt(recurringFrequencyDays.trim(), 10) : null,
        notes: recurringNotes.trim() || null,
      });
      setRecurringPreference(saved);
      setRecurringFrequencyDays(saved?.expected_frequency_days ? String(saved.expected_frequency_days) : '');
      setRecurringNotes(saved?.notes || '');
      setShowRecurringModal(false);
      await invalidateCacheByPrefix('cache:insights:');
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not save recurring details');
    } finally {
      setActioning(false);
    }
  }

  async function removeRecurringPreference() {
    if (!recurringPreference?.id) return;
    try {
      setActioning(true);
      await api.delete(`/recurring/preferences/${recurringPreference.id}`);
      setRecurringPreference(null);
      setRecurringFrequencyDays('');
      setRecurringNotes('');
      setShowRecurringModal(false);
      await invalidateCacheByPrefix('cache:insights:');
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not remove recurring flag');
    } finally {
      setActioning(false);
    }
  }

  return {
    expense,
    loading,
    loadError,
    retryLoad,
    editing,
    setEditing,
    saving,
    deleting,
    actioning,
    setActioning,
    showDismissReasonSheet,
    setShowDismissReasonSheet,
    merchant,
    setMerchant,
    amount,
    setAmount,
    date,
    setDate,
    notes,
    setNotes,
    categoryId,
    setCategoryId,
    paymentMethod,
    setPaymentMethod,
    cardLast4,
    setCardLast4,
    cardLabel,
    setCardLabel,
    isPrivate,
    setIsPrivate,
    excludeFromBudget,
    setExcludeFromBudget,
    budgetExclusionReason,
    setBudgetExclusionReason,
    items,
    setItems,
    itemsExpanded,
    setItemsExpanded,
    itemsEdits,
    setItemsEdits,
    locationData,
    setLocationData,
    recurringPreference,
    showRecurringModal,
    setShowRecurringModal,
    recurringFrequencyDays,
    setRecurringFrequencyDays,
    recurringNotes,
    setRecurringNotes,
    secondaryDetailsExpanded,
    setSecondaryDetailsExpanded,
    activeReviewField,
    setActiveReviewField,
    canEdit,
    canAdjustReviewControls,
    handleSave,
    handleDelete,
    saveRecurringPreference,
    removeRecurringPreference,
    ...visibilityControls,
  };
}
