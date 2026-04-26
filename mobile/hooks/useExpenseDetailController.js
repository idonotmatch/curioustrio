import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { api } from '../services/api';
import { invalidateCacheByPrefix } from '../services/cache';
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

export function useExpenseDetailController({ id, expenseParam, currentUserId, router }) {
  const [expense, setExpense] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
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
  const [itemsEdits, setItemsEdits] = useState([]);
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
    setItemsEdits,
  });

  useEffect(() => {
    let active = true;

    async function load() {
      const bootstrapped = await bootstrapExpenseRecord(id, expenseParam);
      if (active && bootstrapped) {
        applyExpenseToState(bootstrapped, setters);
        setLoading(false);
      }

      try {
        const fresh = await api.get(`/expenses/${id}`);
        if (!active) return;
        const merged = mergeReviewMetadata(bootstrapped, fresh);
        applyExpenseToState(merged, setters);
        setLoading(false);
        saveExpenseSnapshot(merged);
      } catch {
        if (active && !bootstrapped) setLoading(false);
      }
    }

    load();
    return () => { active = false; };
  }, [expenseParam, id]);

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
      if (excludeFromBudget && !budgetExclusionReason) {
        Alert.alert('Choose a reason', 'Pick why this should be tracked without counting it toward your budget.');
        return;
      }
      const updated = await api.patch(`/expenses/${id}`, buildExpensePatchPayload({
        merchant,
        amount,
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
      }));
      const refreshed = mergeReviewMetadata(expense, updated);
      applyExpenseToState(refreshed, setters);
      setExpense(refreshed);
      saveExpenseSnapshot(refreshed);
      patchExpenseInCachedLists(refreshed);
      setEditing(false);
      await Promise.all([
        invalidateCacheByPrefix('cache:expenses:'),
        invalidateCacheByPrefix('cache:budget:'),
        invalidateCacheByPrefix('cache:household-expenses:'),
        invalidateCacheByPrefix('cache:insights:'),
      ]);
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
            await Promise.all([
              invalidateCacheByPrefix('cache:expenses:'),
              invalidateCacheByPrefix('cache:budget:'),
              invalidateCacheByPrefix('cache:household-expenses:'),
            ]);
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
