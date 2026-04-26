import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Linking, Platform
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useState, useEffect } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { invalidateCacheByPrefix } from '../../services/cache';
import { useCategories } from '../../hooks/useCategories';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { usePendingExpenseReviewActions } from '../../hooks/usePendingExpenseReviewActions';
import { useExpenseVisibilityControls } from '../../hooks/useExpenseVisibilityControls';
import { DismissReasonSheet } from '../../components/DismissReasonSheet';
import { LocationPicker } from '../../components/LocationPicker';
import { DismissKeyboardScrollView } from '../../components/DismissKeyboardScrollView';
import { PendingExpenseReviewPanel } from '../../components/PendingExpenseReviewPanel';
import { ExpenseDetailActions } from '../../components/ExpenseDetailActions';
import { ExpenseItemsSection } from '../../components/ExpenseItemsSection';
import { ExpenseVisibilityControls } from '../../components/ExpenseVisibilityControls';
import { RecurringExpenseModal } from '../../components/RecurringExpenseModal';
import { findExpenseSnapshotInCaches, loadExpenseItemsSnapshot, mergeExpenseData, removeExpenseFromCachedLists, saveExpenseSnapshot, removeExpenseSnapshot, patchExpenseInCachedLists } from '../../services/expenseLocalStore';
import { toLocalDateString } from '../../services/date';
import {
  formatImportedAt,
  formatEmailSnippet,
  formatCurrency,
  formatShortDate,
  buildReviewFocusSummary,
  buildReviewDecisionFacts,
  buildTreatmentSuggestionSummary,
  buildPriorityReviewFields,
  formatItemStructuredMeta,
  itemMatchLabel,
  itemSubmeta,
  summarizeItemSignals,
} from '../../services/expenseDetailPresentation';

function parseExpenseParam(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const TRACK_ONLY_REASONS = [
  { value: 'business', label: 'Business' },
  { value: 'reimbursable', label: 'Reimbursable' },
  { value: 'different_budget', label: 'Different budget' },
  { value: 'shared_not_mine', label: 'Shared, not mine' },
  { value: 'transfer_like', label: 'Transfer-like' },
  { value: 'other', label: 'Other' },
];

function applyExpenseToState(record, setters) {
  if (!record) return;
  const {
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
  } = setters;
  setExpense(record);
  setMerchant(record.merchant || '');
  setAmount(String(Math.abs(Number(record.amount))));
  setDate(record.date ? record.date.slice(0, 10) : '');
  setNotes(record.notes || '');
  setCategoryId(record.category_id || null);
  setPaymentMethod(record.payment_method || 'unknown');
  setCardLast4(record.card_last4 || '');
  setCardLabel(record.card_label || '');
  setIsPrivate(record.is_private || false);
  setExcludeFromBudget(record.exclude_from_budget || false);
  setBudgetExclusionReason(record.budget_exclusion_reason || null);
  setItems(record.items || []);
  setLocationData(
    record.place_name || record.address || record.mapkit_stable_id
      ? {
          place_name: record.place_name || '',
          address: record.address || null,
          mapkit_stable_id: record.mapkit_stable_id || null,
        }
      : null
  );
  setItemsEdits((record.items || []).map((it) => ({
    ...it,
    description: it.description,
    amount: it.amount != null ? String(it.amount) : '',
  })));
}

function mergeReviewMetadata(previous, next) {
  if (!next) return previous || null;
  if (!previous) return next;
  return mergeExpenseData(previous, next);
}

const ITEM_CACHE_FRESH_MS = 10 * 60 * 1000;

export default function ExpenseDetailScreen() {
  const { id, expense: expenseParam } = useLocalSearchParams();
  const router = useRouter();
  const { categories } = useCategories();
  const { userId: currentUserId } = useCurrentUser();
  const [expense, setExpense] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [showDismissReasonSheet, setShowDismissReasonSheet] = useState(false);

  // Edit state
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

  useEffect(() => {
    let active = true;
    const routeExpense = parseExpenseParam(typeof expenseParam === 'string' ? expenseParam : null);

    async function load() {
      const setters = {
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
      };
      const bootstrapped = routeExpense || await findExpenseSnapshotInCaches(id);
      const cachedItems = await loadExpenseItemsSnapshot(id, {
        maxAgeMs: ITEM_CACHE_FRESH_MS,
        includeMeta: true,
      });
      const bootstrappedWithItems = bootstrapped && cachedItems?.items && !Array.isArray(bootstrapped.items)
        ? {
            ...bootstrapped,
            items: cachedItems.items,
            item_count: cachedItems.items.length,
          }
        : bootstrapped;
      if (active && bootstrappedWithItems) {
        applyExpenseToState(bootstrappedWithItems, setters);
        setLoading(false);
      }

      try {
        const fresh = await api.get(`/expenses/${id}`);
        if (!active) return;
        const merged = mergeReviewMetadata(bootstrappedWithItems, fresh);
        applyExpenseToState(merged, setters);
        setLoading(false);
        saveExpenseSnapshot(merged);
      } catch {
        if (active && !bootstrapped) setLoading(false);
      }
    }

    load();
    return () => { active = false; };
  }, [id, expenseParam]);

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
  const itemSignals = summarizeItemSignals(items);
  const canAdjustReviewControls = canEdit && expense?.status === 'pending' && expense?.source === 'email';
  const {
    savingControls,
    persistReviewControlsIfNeeded,
    handleTogglePrivate,
    handleToggleTrackOnly,
    handleSelectBudgetExclusionReason,
  } = useExpenseVisibilityControls({
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

  const reviewState = expense?.status === 'pending' && expense?.source === 'email';
  const gmailReviewHint = expense?.gmail_review_hint || null;
  const isPendingEmailReview = reviewState;
  const isItemsFirstReview = gmailReviewHint?.review_mode === 'items_first';
  const isQuickCheckReview = gmailReviewHint?.review_mode === 'quick_check';

  useEffect(() => {
    if (!isPendingEmailReview) return;
    if (!Array.isArray(items) || items.length === 0) return;
    if (itemsExpanded) return;
    setItemsExpanded(true);
    if (isItemsFirstReview) {
      setEditing(true);
      setActiveReviewField((current) => current || 'items');
    }
  }, [isPendingEmailReview, items, itemsExpanded, isItemsFirstReview]);

  async function handleSave() {
    setSaving(true);
    try {
      if (excludeFromBudget && !budgetExclusionReason) {
        Alert.alert('Choose a reason', 'Pick why this should be tracked without counting it toward your budget.');
        return;
      }
      const updated = await api.patch(`/expenses/${id}`, {
        merchant,
        amount: parseFloat(amount),
        date,
        notes,
        category_id: categoryId,
        payment_method: paymentMethod,
        card_last4: cardLast4 || null,
        card_label: cardLabel || null,
        is_private: isPrivate,
        exclude_from_budget: excludeFromBudget,
        budget_exclusion_reason: excludeFromBudget ? budgetExclusionReason : null,
        place_name: locationData?.place_name || null,
        address: locationData?.address || null,
        mapkit_stable_id: locationData?.mapkit_stable_id || null,
        items: itemsEdits
          .filter(it => it.description.trim())
          .map(it => ({
            description: it.description.trim(),
            amount: it.amount ? parseFloat(it.amount) : null,
            upc: it.upc || null,
            sku: it.sku || null,
            brand: it.brand || null,
            product_size: it.product_size || null,
            pack_size: it.pack_size || null,
            unit: it.unit || null,
          })),
      });
      const refreshed = mergeReviewMetadata(expense, updated);
      applyExpenseToState(refreshed, {
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

  if (loading) return <View style={styles.center}><ActivityIndicator color="#555" /></View>;
  if (!expense) return <View style={styles.center}><Text style={styles.muted}>Expense not found.</Text></View>;

  const formattedDate = (() => {
    const d = new Date((expense.date || '').slice(0, 10) + 'T12:00:00');
    return isNaN(d) ? expense.date : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  })();
  const sourceLabel = { manual: 'Manual entry', camera: 'Receipt scan', email: 'Email import', refund: 'Refund' };
  const isRefund = Number(expense.amount) < 0;
  const categoryLabel = expense.category_parent_name || expense.category_name || 'Uncategorized';
  const ownerLabel = expense.user_name || 'You';
  const sourceText = sourceLabel[expense.source] || expense.source;
  const categoryReasoning = expense.category_reasoning || null;
  const treatmentSuggestion = gmailReviewHint?.treatment_suggestion || null;
  const importedAtLabel = formatImportedAt(gmailReviewHint?.imported_at);
  const subjectLine = `${gmailReviewHint?.message_subject || expense?.email_subject || ''}`.trim();
  const emailSnippet = formatEmailSnippet(gmailReviewHint?.message_snippet || expense?.email_snippet);
  const importMetaBits = [gmailReviewHint?.from_address || expense?.email_from_address, importedAtLabel].filter(Boolean);
  const treatmentSuggestionSummary = buildTreatmentSuggestionSummary(treatmentSuggestion);
  const reviewFocusSummary = buildReviewFocusSummary(gmailReviewHint);
  const reviewDecisionFacts = buildReviewDecisionFacts({
    expense,
    gmailReviewHint,
    formattedDate,
    importedAtLabel,
    categoryLabel,
  });
  const priorityReviewFields = isPendingEmailReview
    ? buildPriorityReviewFields({ expense, gmailReviewHint, formattedDate, categoryLabel })
    : [];
  const showSecondaryDetails = !isPendingEmailReview || secondaryDetailsExpanded;
  const displayIsPrivate = isPendingEmailReview ? isPrivate : (editing ? isPrivate : expense.is_private);
  const displayExcludeFromBudget = isPendingEmailReview ? excludeFromBudget : (editing ? excludeFromBudget : expense.exclude_from_budget);
  const itemReviewContext = Array.isArray(expense.item_review_context) ? expense.item_review_context : [];
  const { approvePendingExpense, dismissPendingExpense } = usePendingExpenseReviewActions({
    expenseId: id,
    router,
    setActioning,
    setShowDismissReasonSheet,
    persistReviewControlsIfNeeded,
    isItemsFirstReview,
    isQuickCheckReview,
  });

  function activateReviewField(fieldKey) {
    setEditing(true);
    setActiveReviewField(fieldKey);
    if (fieldKey === 'items') setItemsExpanded(true);
  }

  function applyTreatmentSuggestion() {
    if (!treatmentSuggestion) return;
    if (treatmentSuggestion.suggested_category_id) {
      setCategoryId(treatmentSuggestion.suggested_category_id);
    }
    if (treatmentSuggestion.suggested_payment_method) {
      setPaymentMethod(treatmentSuggestion.suggested_payment_method);
      setCardLabel(treatmentSuggestion.suggested_card_label || '');
      setCardLast4(treatmentSuggestion.suggested_card_last4 || '');
    }
    if (treatmentSuggestion.suggested_private) {
      setIsPrivate(true);
    }
    if (treatmentSuggestion.suggested_track_only) {
      setExcludeFromBudget(true);
      if (treatmentSuggestion.budget_exclusion_reason) {
        setBudgetExclusionReason(treatmentSuggestion.budget_exclusion_reason);
      }
    }
  }

  return (
    <DismissKeyboardScrollView style={styles.container}>
      <Stack.Screen options={{
        title: expense.merchant,
        headerRight: editing || !canEdit ? undefined : () => (
          <TouchableOpacity onPress={() => setEditing(true)} style={{ marginRight: 4 }}>
            <Ionicons name="pencil-outline" size={20} color="#f5f5f5" />
          </TouchableOpacity>
        ),
      }} />

      {/* Hero */}
      <View style={styles.hero}>
        {editing && canEdit ? (
          <View style={styles.editRow}>
            <TextInput style={[styles.editInput, { flex: 1 }, activeReviewField === 'merchant' && styles.editInputFocused]} value={merchant} onChangeText={setMerchant} placeholderTextColor="#444" placeholder="Merchant" />
            <TextInput style={[styles.editInput, styles.editAmount, activeReviewField === 'amount' && styles.editInputFocused]} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#444" />
          </View>
        ) : (
          <>
            <Text style={styles.merchant}>{expense.merchant}</Text>
            <Text style={[styles.amount, isRefund && styles.amountRefund]}>
              {isRefund ? '−' : ''}${Math.abs(Number(expense.amount)).toFixed(2)}
            </Text>
            <View style={styles.heroMetaWrap}>
              <View style={styles.heroMetaChip}>
                <Text style={styles.heroMetaText}>{formattedDate}</Text>
              </View>
              <View style={styles.heroMetaChip}>
                <Text style={styles.heroMetaText}>{categoryLabel}</Text>
              </View>
              <View style={styles.heroMetaChip}>
                <Text style={styles.heroMetaText}>{sourceText}</Text>
              </View>
              {expense.user_name ? (
                <View style={[styles.heroMetaChip, styles.heroMetaChipMuted]}>
                  <Text style={styles.heroMetaText}>{ownerLabel}</Text>
                </View>
              ) : null}
              {displayIsPrivate ? (
                <View style={[styles.heroMetaChip, styles.heroMetaChipMuted]}>
                  <Text style={styles.heroMetaText}>Private</Text>
                </View>
              ) : null}
              {displayExcludeFromBudget ? (
                <View style={[styles.heroMetaChip, styles.heroMetaChipMuted]}>
                  <Text style={styles.heroMetaText}>Track only</Text>
                </View>
              ) : null}
            </View>
          </>
        )}
      </View>

      {isPendingEmailReview ? (
        <PendingExpenseReviewPanel
          styles={styles}
          activeReviewField={activeReviewField}
          subjectLine={subjectLine}
          expenseMerchant={expense?.merchant}
          reviewDecisionFacts={reviewDecisionFacts}
          reviewFocusSummary={reviewFocusSummary}
          treatmentSuggestion={treatmentSuggestion}
          treatmentSuggestionSummary={treatmentSuggestionSummary}
          importMetaBits={importMetaBits}
          emailSnippet={emailSnippet}
          priorityReviewFields={priorityReviewFields}
          isItemsFirstReview={isItemsFirstReview}
          editing={editing}
          activateReviewField={activateReviewField}
          applyTreatmentSuggestion={applyTreatmentSuggestion}
          isPrivate={isPrivate}
          excludeFromBudget={excludeFromBudget}
          canAdjustReviewControls={canAdjustReviewControls}
          handleTogglePrivate={handleTogglePrivate}
          handleToggleTrackOnly={handleToggleTrackOnly}
          handleSelectBudgetExclusionReason={handleSelectBudgetExclusionReason}
          savingControls={savingControls}
          trackOnlyReasons={TRACK_ONLY_REASONS}
          budgetExclusionReason={budgetExclusionReason}
          secondaryDetailsExpanded={secondaryDetailsExpanded}
          setSecondaryDetailsExpanded={setSecondaryDetailsExpanded}
          items={items}
          formatCurrency={formatCurrency}
          setItemsExpanded={setItemsExpanded}
        />
      ) : reviewState ? (
        <View style={styles.reviewBanner}>
          <Text style={styles.reviewBannerEyebrow}>
            {isQuickCheckReview ? 'Quick check' : 'Gmail import'}
          </Text>
          <Text style={styles.reviewBannerTitle}>
            {subjectLine || expense?.merchant || 'Gmail import awaiting review'}
          </Text>
          {expense?.merchant && subjectLine && subjectLine.toLowerCase() !== `${expense.merchant}`.toLowerCase() ? (
            <Text style={styles.reviewBannerText}>{expense.merchant}</Text>
          ) : null}
          {reviewDecisionFacts.length ? (
            <View style={styles.reviewFactGrid}>
              {reviewDecisionFacts.map((fact) => (
                <View key={`${fact.label}:${fact.value}`} style={styles.reviewFactChip}>
                  <Text style={styles.reviewFactLabel}>{fact.label}</Text>
                  <Text style={styles.reviewFactValue} numberOfLines={1}>{fact.value}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {canEdit && showSecondaryDetails ? (
        <View style={styles.recurringCard}>
          <View style={styles.recurringHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.recurringTitle}>Recurring</Text>
              <Text style={styles.recurringSubtitle}>
                {recurringPreference
                  ? recurringPreference.expected_frequency_days
                    ? `Marked recurring · about every ${recurringPreference.expected_frequency_days} days`
                    : 'Marked recurring'
                  : 'Flag this as a common purchase so Adlo can learn from it sooner'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setShowRecurringModal(true)} disabled={actioning}>
              <Text style={styles.recurringAction}>{recurringPreference ? 'Edit' : 'Mark'}</Text>
            </TouchableOpacity>
          </View>
          {recurringPreference?.notes ? (
            <Text style={styles.recurringNotePreview}>{recurringPreference.notes}</Text>
          ) : null}
        </View>
      ) : null}

      {!isPendingEmailReview && itemReviewContext.length > 0 ? (
        <View style={styles.itemHistoryCard}>
          <Text style={styles.itemHistoryEyebrow}>Item patterns</Text>
          <Text style={styles.itemHistoryTitle}>Recent item history from your own spend</Text>
          {itemReviewContext.map((entry) => {
            const merchantCount = Array.isArray(entry.merchants) ? entry.merchants.length : 0;
            const merchantLine = merchantCount > 1
              ? `${merchantCount} merchants`
              : entry.merchants?.[0] || null;
            const latest = entry.latest_purchase || null;
            const subline = [
              latest?.merchant || null,
              latest?.date ? formatShortDate(latest.date) : null,
              latest?.amount != null ? formatCurrency(latest.amount) : null,
            ].filter(Boolean).join('  •  ') || null;
            const occurrenceCount = Number(entry.occurrence_count || 0);
            const cadence = Number(entry.average_gap_days || 0);
            const medianAmount = formatCurrency(entry.median_amount);
            const summary = occurrenceCount >= 3 && cadence > 0
              ? `${entry.item_name || 'This item'} has shown up ${occurrenceCount} times, about every ${cadence} days${medianAmount ? ` at around ${medianAmount}` : ''}.`
              : occurrenceCount >= 2
                ? `${entry.item_name || 'This item'} has shown up ${occurrenceCount} times recently${medianAmount ? ` at around ${medianAmount}` : ''}.`
                : `${entry.item_name || 'This item'} has some recent history${medianAmount ? ` around ${medianAmount}` : ''}.`;
            return (
              <View key={entry.group_key} style={styles.itemHistoryRow}>
                <View style={styles.itemHistoryText}>
                  <Text style={styles.itemHistoryName}>{entry.item_name || 'Untitled item'}</Text>
                  <Text style={styles.itemHistorySummary}>{summary}</Text>
                  {subline ? <Text style={styles.itemHistoryMeta}>{subline}</Text> : null}
                </View>
                <View style={styles.itemHistoryRight}>
                  {merchantLine ? <Text style={styles.itemHistoryBadge}>{merchantLine}</Text> : null}
                  {entry.median_unit_price != null ? (
                    <Text style={styles.itemHistoryUnit}>
                      {formatCurrency(entry.median_unit_price)} / {entry.normalized_total_size_unit || 'unit'}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {!isPendingEmailReview && categoryReasoning?.label ? (
        <View style={styles.categoryReasoningCard}>
          <Text style={styles.categoryReasoningEyebrow}>Category signal</Text>
          <Text style={styles.categoryReasoningTitle}>{categoryReasoning.label}</Text>
          {categoryReasoning.detail ? (
            <Text style={styles.categoryReasoningBody}>{categoryReasoning.detail}</Text>
          ) : null}
          {Number.isFinite(categoryReasoning?.decision_count) || Number.isFinite(categoryReasoning?.merchant_hit_count) ? (
            <View style={styles.categoryReasoningMetaWrap}>
              {Number.isFinite(categoryReasoning?.decision_count) ? (
                <View style={styles.categoryReasoningMetaChip}>
                  <Text style={styles.categoryReasoningMetaText}>
                    {categoryReasoning.decision_count} learned {categoryReasoning.decision_count === 1 ? 'decision' : 'decisions'}
                  </Text>
                </View>
              ) : null}
              {Number.isFinite(categoryReasoning?.merchant_hit_count) && categoryReasoning.merchant_hit_count > 0 ? (
                <View style={styles.categoryReasoningMetaChip}>
                  <Text style={styles.categoryReasoningMetaText}>
                    {categoryReasoning.merchant_hit_count} merchant {categoryReasoning.merchant_hit_count === 1 ? 'match' : 'matches'}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {editing && canEdit ? (
        <View style={styles.editDetailsCard}>
          <Text style={styles.editDetailsTitle}>Details</Text>
          <View style={activeReviewField === 'date' ? styles.reviewFieldWrapActive : null}>
            <Row label="Date">
              <DateTimePicker
                value={date ? new Date(date + 'T12:00:00') : new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'compact' : 'default'}
                maximumDate={new Date()}
                onChange={(_, selected) => {
                  if (selected) setDate(toLocalDateString(selected));
                }}
                themeVariant="dark"
                style={styles.datePicker}
              />
            </Row>
          </View>
          <View style={activeReviewField === 'category' ? styles.reviewFieldWrapActive : null}>
            <Row label="Category">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 36 }}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {(categories || []).map(c => (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.catChip, categoryId === c.id && styles.catChipActive]}
                      onPress={() => setCategoryId(c.id)}
                    >
                      <Text style={[styles.catChipText, categoryId === c.id && styles.catChipTextActive]}>{c.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </Row>
          </View>
        </View>
      ) : null}

      {/* Fields */}
      <View style={styles.section}>

        <Row label="Payment">
          {editing ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 36 }}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {['cash', 'debit', 'credit', 'unknown'].map(m => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.catChip, paymentMethod === m && styles.catChipActive]}
                    onPress={() => setPaymentMethod(m)}
                  >
                    <Text style={[styles.catChipText, paymentMethod === m && styles.catChipTextActive]}>
                      {m === 'unknown' ? 'other' : m}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          ) : (
            <Text style={styles.value}>
              {expense.payment_method && expense.payment_method !== 'unknown'
                ? `${expense.payment_method}${expense.card_label ? ` · ${expense.card_label}` : ''}${expense.card_last4 ? ` ····${expense.card_last4}` : ''}`
                : '—'}
            </Text>
          )}
        </Row>

        {editing && (paymentMethod === 'debit' || paymentMethod === 'credit') && (
          <Row label="Card">
            <View style={{ flexDirection: 'row', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
              <TextInput
                style={[styles.editInputInline, { flex: 1 }]}
                placeholder="nickname"
                placeholderTextColor="#444"
                value={cardLabel}
                onChangeText={setCardLabel}
              />
              <TextInput
                style={[styles.editInputInline, { width: 50 }]}
                placeholder="last4"
                placeholderTextColor="#444"
                value={cardLast4}
                onChangeText={t => setCardLast4(t.replace(/\D/g, '').slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>
          </Row>
        )}

        {!isPendingEmailReview ? (
          <ExpenseVisibilityControls
            styles={styles}
            isPrivate={isPrivate}
            excludeFromBudget={excludeFromBudget}
            budgetExclusionReason={budgetExclusionReason}
            canAdjust={canEdit}
            savingControls={savingControls}
            trackOnlyReasons={TRACK_ONLY_REASONS}
            onTogglePrivate={handleTogglePrivate}
            onToggleTrackOnly={handleToggleTrackOnly}
            onSelectBudgetExclusionReason={handleSelectBudgetExclusionReason}
          />
        ) : null}
      </View>

      {showSecondaryDetails && ((editing && canEdit) || locationData || expense.place_name || expense.address) ? (
        <View style={styles.locationSection}>
          {editing && canEdit ? (
            <LocationPicker
              onLocation={setLocationData}
              locationData={locationData}
              merchant={merchant}
            />
          ) : (expense.place_name || expense.address) ? (
            (() => {
              const coords = expense.mapkit_stable_id?.split(',').map(Number);
              const hasCoords = coords?.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1]);
              const locationLabel = expense.place_name || expense.address;
              const mapsUrl = hasCoords
                ? `maps://?ll=${coords[0]},${coords[1]}&q=${encodeURIComponent(locationLabel)}`
                : `maps://?q=${encodeURIComponent(expense.address || expense.place_name)}`;
              return (
                <TouchableOpacity style={styles.locationCard} onPress={() => Linking.openURL(mapsUrl)}>
                  <View style={styles.locationInfo}>
                    <Text style={styles.locationName}>{locationLabel}</Text>
                    {expense.address ? <Text style={styles.locationAddress}>{expense.address}</Text> : null}
                  </View>
                  <Ionicons name="map-outline" size={18} color="#444" />
                </TouchableOpacity>
              );
            })()
          ) : null}
        </View>
      ) : null}

      {showSecondaryDetails && ((editing && canEdit) || expense.notes) && (
        <View style={styles.noteCard}>
          <Text style={styles.noteCardLabel}>Notes</Text>
          {editing && canEdit ? (
            <TextInput
              style={styles.noteInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add a note"
              placeholderTextColor="#444"
              multiline
            />
          ) : (
            <Text style={styles.noteText}>{expense.notes}</Text>
          )}
        </View>
      )}

      <ExpenseItemsSection
        styles={styles}
        items={items}
        itemsExpanded={itemsExpanded}
        setItemsExpanded={setItemsExpanded}
        activeReviewField={activeReviewField}
        editing={editing}
        canEdit={canEdit}
        itemsEdits={itemsEdits}
        setItemsEdits={setItemsEdits}
        amount={amount}
        itemSignals={itemSignals}
        itemMatchLabel={itemMatchLabel}
        formatItemStructuredMeta={formatItemStructuredMeta}
        itemSubmeta={itemSubmeta}
      />

      <ExpenseDetailActions
        styles={styles}
        expense={expense}
        editing={editing}
        canEdit={canEdit}
        saving={saving}
        handleSave={handleSave}
        actioning={actioning}
        approvePendingExpense={approvePendingExpense}
        openDismissReasonSheet={() => setShowDismissReasonSheet(true)}
        isItemsFirstReview={isItemsFirstReview}
        isQuickCheckReview={isQuickCheckReview}
        deleting={deleting}
        handleDelete={handleDelete}
      />

      <RecurringExpenseModal
        styles={styles}
        visible={showRecurringModal}
        onClose={() => setShowRecurringModal(false)}
        recurringPreference={recurringPreference}
        recurringFrequencyDays={recurringFrequencyDays}
        setRecurringFrequencyDays={setRecurringFrequencyDays}
        recurringNotes={recurringNotes}
        setRecurringNotes={setRecurringNotes}
        removeRecurringPreference={removeRecurringPreference}
        saveRecurringPreference={saveRecurringPreference}
        actioning={actioning}
      />
      <DismissReasonSheet
        visible={showDismissReasonSheet}
        busy={actioning}
        onClose={() => !actioning && setShowDismissReasonSheet(false)}
        onSelect={dismissPendingExpense}
      />
    </DismissKeyboardScrollView>
  );
}

function Row({ label, children }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueWrap}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
  muted: { color: '#555' },

  hero: { padding: 24, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: '#111' },
  merchant: { fontSize: 20, color: '#f5f5f5', fontWeight: '600', letterSpacing: -0.3 },
  amount: { fontSize: 36, color: '#f5f5f5', fontWeight: '600', marginTop: 4, letterSpacing: -1 },
  amountRefund: { color: '#4ade80' },
  heroMetaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  heroMetaChip: {
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#202020',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  heroMetaChipMuted: {
    backgroundColor: '#101010',
  },
  heroMetaText: { color: '#a4a4a4', fontSize: 12, fontWeight: '500' },
  reviewBanner: {
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: -4,
    backgroundColor: '#15120a',
    borderWidth: 1,
    borderColor: '#2c220f',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  reviewBannerEyebrow: { color: '#cbb37c', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  reviewBannerTitle: { color: '#f5f5f5', fontSize: 15, fontWeight: '600', lineHeight: 20 },
  reviewBannerText: { color: '#b8aa86', fontSize: 12, lineHeight: 17, marginTop: 4 },
  reviewBannerSubjectBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#24201a',
  },
  reviewBannerSubjectLabel: {
    color: '#cbb37c',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  reviewBannerSubjectValue: { color: '#f1eadc', fontSize: 13, fontWeight: '600', lineHeight: 18 },
  reviewFactGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  reviewFactChip: {
    minWidth: 100,
    maxWidth: '48%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2112',
    backgroundColor: '#110e08',
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  reviewFactLabel: { color: '#8f8468', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  reviewFactValue: { color: '#f1eadc', fontSize: 12, fontWeight: '600' },
  reviewFocusBlock: {
    marginTop: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#302614',
    backgroundColor: '#120f09',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  reviewFocusTitle: { color: '#f5f0e2', fontSize: 12, fontWeight: '600', marginBottom: 3 },
  reviewFocusBody: { color: '#c8bda3', fontSize: 12, lineHeight: 17 },
  reviewPatternBlock: {
    marginTop: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f3a2c',
    backgroundColor: '#0d1511',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  reviewPatternLabel: { color: '#86efac', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  reviewPatternBody: { color: '#d8f3e1', fontSize: 12, lineHeight: 17 },
  reviewBannerMeta: { color: '#7f7766', fontSize: 11, lineHeight: 16, marginBottom: 6 },
  reviewBannerEmailContext: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#24201a',
  },
  reviewBannerEmailLabel: {
    color: '#cbb37c',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  reviewBannerEmailSnippet: { color: '#c9c1af', fontSize: 12, lineHeight: 18 },
  reviewProvenanceCard: {
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: -4,
    backgroundColor: '#14110d',
    borderWidth: 1,
    borderColor: '#25201a',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  reviewSectionEyebrow: { color: '#8a816f', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  reviewProvenanceTitle: { color: '#f3efe8', fontSize: 15, fontWeight: '600', lineHeight: 20 },
  reviewProvenanceMeta: { color: '#a79b87', fontSize: 12, lineHeight: 17, marginTop: 6 },
  reviewProvenanceSnippet: { color: '#c8bfaf', fontSize: 12, lineHeight: 18, marginTop: 8 },
  reviewSummaryCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: -4,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  reviewSummaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  reviewSummaryTitle: { color: '#f5f5f5', fontSize: 15, fontWeight: '600', lineHeight: 20 },
  reviewSummarySubtitle: { color: '#8d8d8d', fontSize: 12, lineHeight: 17, marginTop: 4 },
  reviewSummaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reviewSummaryChip: {
    minWidth: 104,
    maxWidth: '48%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#222',
    backgroundColor: '#0d0d0d',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  reviewSummaryChipLabel: { color: '#7f7f7f', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  reviewSummaryChipValue: { color: '#f3f3f3', fontSize: 13, fontWeight: '600' },
  reviewAttentionBody: { color: '#9aa5b1', fontSize: 12, lineHeight: 18, marginTop: 4 },
  priorityFieldsCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: -4,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  priorityFieldsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  priorityFieldsEyebrow: { color: '#6f6f6f', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  priorityFieldsTitle: { color: '#f5f5f5', fontSize: 14, fontWeight: '600' },
  priorityFieldsAction: { color: '#8ab4ff', fontSize: 13, fontWeight: '600', marginTop: 2 },
  reviewControlsCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: -4,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  reviewControlsEyebrow: { color: '#6f6f6f', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  reviewControlsTitle: { color: '#f5f5f5', fontSize: 14, fontWeight: '600', marginBottom: 10 },
  reviewSuggestionCard: {
    marginTop: 2,
    marginBottom: 10,
    backgroundColor: '#0d1511',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f3a2c',
    padding: 12,
  },
  reviewSuggestionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  reviewSuggestionCopy: { flex: 1 },
  reviewSuggestionEyebrow: { color: '#86efac', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  reviewSuggestionTitle: { color: '#e8f7ee', fontSize: 13, fontWeight: '600', lineHeight: 18 },
  reviewSuggestionDetail: { color: '#8bb59a', fontSize: 11, lineHeight: 16, marginTop: 6 },
  reviewSuggestionMeta: { color: '#b7d8c2', fontSize: 11, lineHeight: 16, marginTop: 6 },
  reviewSuggestionAction: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#29533d',
    backgroundColor: '#123222',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  reviewSuggestionActionText: { color: '#c7f9d7', fontSize: 11, fontWeight: '700' },
  priorityFieldRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  priorityFieldRowActive: { backgroundColor: '#0f141d', marginHorizontal: -12, paddingHorizontal: 12, borderRadius: 8 },
  priorityFieldTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  priorityFieldLabel: { color: '#d6d6d6', fontSize: 12, fontWeight: '600', flex: 1, minWidth: 0, paddingTop: 2 },
  priorityFieldValue: { color: '#f5f5f5', fontSize: 15, fontWeight: '600', marginTop: 5 },
  priorityFieldReason: { color: '#9aa5b1', fontSize: 12, lineHeight: 18, marginTop: 4 },
  reviewFieldsHeader: {
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: -2,
  },
  reviewFieldsEyebrow: { color: '#6f6f6f', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  reviewFieldsTitle: { color: '#d9d9d9', fontSize: 14, fontWeight: '600' },
  secondaryDetailsToggle: {
    marginHorizontal: 20,
    marginTop: 14,
    marginBottom: -2,
    paddingVertical: 10,
    paddingHorizontal: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  secondaryDetailsEyebrow: { color: '#6f6f6f', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  secondaryDetailsTitle: { color: '#cfcfcf', fontSize: 13, lineHeight: 18 },
  recurringCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 14,
  },
  recurringHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  recurringTitle: { color: '#f5f5f5', fontSize: 15, fontWeight: '600' },
  recurringSubtitle: { color: '#777', fontSize: 13, lineHeight: 18, marginTop: 4 },
  recurringAction: { color: '#8ab4ff', fontSize: 14, fontWeight: '600' },
  recurringNotePreview: { color: '#b8b8b8', fontSize: 13, lineHeight: 18, marginTop: 10 },
  categoryReasoningCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 14,
  },
  categoryReasoningEyebrow: { color: '#6f6f6f', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  categoryReasoningTitle: { color: '#f5f5f5', fontSize: 15, fontWeight: '600', lineHeight: 20 },
  categoryReasoningBody: { color: '#cfcfcf', fontSize: 13, lineHeight: 19, marginTop: 6 },
  categoryReasoningMetaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  categoryReasoningMetaChip: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#242424',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  categoryReasoningMetaText: { color: '#a8a8a8', fontSize: 11, fontWeight: '600' },
  itemHistoryCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 14,
  },
  itemHistoryEyebrow: { color: '#6f6f6f', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  itemHistoryTitle: { color: '#f5f5f5', fontSize: 15, fontWeight: '600', lineHeight: 20 },
  itemHistoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  itemHistoryText: { flex: 1, minWidth: 0 },
  itemHistoryName: { color: '#f5f5f5', fontSize: 14, fontWeight: '600' },
  itemHistorySummary: { color: '#cfcfcf', fontSize: 13, lineHeight: 19, marginTop: 4 },
  itemHistoryMeta: { color: '#8d8d8d', fontSize: 12, marginTop: 5 },
  itemHistoryRight: { alignItems: 'flex-end', gap: 6, maxWidth: 110 },
  itemHistoryBadge: {
    color: '#d7d7d7',
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    overflow: 'hidden',
  },
  itemHistoryUnit: { color: '#8ab4ff', fontSize: 11, fontWeight: '600', textAlign: 'right' },
  editDetailsCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 2,
  },
  editDetailsTitle: {
    color: '#555',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },

  editRow: { flexDirection: 'row', gap: 10 },
  editInput: { backgroundColor: '#111', borderRadius: 8, padding: 10, color: '#f5f5f5', fontSize: 15, borderWidth: 1, borderColor: '#1f1f1f' },
  editInputFocused: { borderColor: '#8ab4ff', backgroundColor: '#0f141d' },
  editAmount: { width: 100 },
  editInputInline: { color: '#f5f5f5', fontSize: 14, textAlign: 'right', flex: 1, padding: 4 },
  datePicker: { marginRight: -8 },
  reviewFieldWrapActive: {
    borderWidth: 1,
    borderColor: '#263448',
    backgroundColor: '#0f141d',
    borderRadius: 10,
    marginHorizontal: -8,
    paddingHorizontal: 8,
  },

  section: { paddingHorizontal: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#111' },
  label: { fontSize: 13, color: '#444', width: 90 },
  trackOnlyTextWrap: { flex: 1, paddingRight: 12 },
  trackOnlyHint: { color: '#666', fontSize: 11, lineHeight: 16, marginTop: 2, maxWidth: 220 },
  trackOnlyReasonBlock: { marginBottom: 16 },
  trackOnlyReasonLabel: { color: '#bdbdbd', fontSize: 12, marginBottom: 10 },
  reasonChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#121212',
  },
  reasonChipActive: {
    borderColor: '#0f3a2b',
    backgroundColor: '#0f3a2b',
  },
  reasonChipText: { color: '#cfcfcf', fontSize: 12, fontWeight: '600' },
  reasonChipTextActive: { color: '#fff' },
  valueWrap: { flex: 1, alignItems: 'flex-end' },
  value: { fontSize: 14, color: '#f5f5f5', textAlign: 'right' },
  noteCard: {
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 4,
    padding: 14,
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  noteCardLabel: {
    color: '#555',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  noteText: {
    color: '#f5f5f5',
    fontSize: 16,
    lineHeight: 24,
  },
  noteInput: {
    color: '#f5f5f5',
    fontSize: 15,
    lineHeight: 22,
    minHeight: 84,
    padding: 0,
    textAlignVertical: 'top',
  },

  catChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: '#111', borderWidth: 1, borderColor: '#1f1f1f' },
  catChipActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  catChipText: { fontSize: 12, color: '#555' },
  catChipTextActive: { color: '#000', fontWeight: '600' },

  locationSection: { marginHorizontal: 20, marginTop: 4 },
  locationCard: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 4, padding: 14, backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#1f1f1f' },
  locationInfo: { flex: 1 },
  locationName: { color: '#f5f5f5', fontSize: 13, fontWeight: '500' },
  locationAddress: { color: '#555', fontSize: 11, marginTop: 2 },

  dupSection: { margin: 20, padding: 12, backgroundColor: '#141008', borderRadius: 8, borderWidth: 1, borderColor: '#2a1f00' },
  dupTitle: { color: '#f59e0b', fontWeight: '600', fontSize: 13, marginBottom: 4 },
  dupItem: { color: '#78716c', fontSize: 12, marginTop: 2 },

  saveBtn: { margin: 20, marginBottom: 8, backgroundColor: '#f5f5f5', borderRadius: 10, padding: 14, alignItems: 'center' },
  saveBtnText: { color: '#000', fontWeight: '600', fontSize: 15 },
  pendingActions: { flexDirection: 'row', marginHorizontal: 20, marginTop: 20, gap: 10 },
  approveBtn: { flex: 1, backgroundColor: '#22c55e', borderRadius: 10, padding: 14, alignItems: 'center' },
  approveBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  dismissBtn: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#2a2a2a' },
  dismissBtnText: { color: '#ef4444', fontWeight: '600', fontSize: 15 },
  deleteBtn: { margin: 20, marginTop: 8, padding: 14, alignItems: 'center' },
  deleteBtnText: { color: '#ef4444', fontSize: 14 },

  itemsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, marginTop: 4, marginBottom: 4, padding: 14, backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#1f1f1f' },
  itemsHeaderActive: { borderColor: '#263448', backgroundColor: '#0f141d' },
  itemsHeaderText: { fontSize: 13, color: '#444', fontWeight: '500' },
  itemsHeaderTextActive: { color: '#f5f5f5' },
  itemsList: { marginHorizontal: 20, marginBottom: 4, backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#1f1f1f', overflow: 'hidden' },
  itemSummaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 },
  itemSummaryChip: { borderRadius: 8, backgroundColor: '#182418', paddingHorizontal: 10, paddingVertical: 5 },
  itemSummaryChipMuted: { borderRadius: 8, backgroundColor: '#171717', paddingHorizontal: 10, paddingVertical: 5 },
  itemSummaryChipText: { color: '#86efac', fontSize: 11, fontWeight: '700' },
  itemSummaryChipTextMuted: { color: '#8a8a8a', fontSize: 11, fontWeight: '700' },
  itemReadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', gap: 12 },
  itemReadText: { flex: 1, minWidth: 0, gap: 4 },
  itemReadTop: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 },
  itemReadDesc: { fontSize: 13, color: '#f5f5f5', flexShrink: 1, fontWeight: '600' },
  itemReadMeta: { fontSize: 12, color: '#b8b8b8' },
  itemReadSubmeta: { fontSize: 11, color: '#777' },
  itemReadAmount: { fontSize: 13, color: '#888', paddingLeft: 8, paddingTop: 1, fontWeight: '700' },
  itemMatchChip: { borderRadius: 8, backgroundColor: '#1d2531', paddingHorizontal: 8, paddingVertical: 4 },
  itemMatchChipText: { color: '#bfdbfe', fontSize: 10, fontWeight: '700' },
  itemEditRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  itemEditDesc: { flex: 1, minWidth: 0, color: '#f5f5f5', fontSize: 13, padding: 4 },
  itemEditAmount: { width: 72, flexShrink: 0, color: '#f5f5f5', fontSize: 13, padding: 4, textAlign: 'right' },
  itemRemoveBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  itemRemoveText: { color: '#555', fontSize: 20, lineHeight: 22 },
  addItemRow: { paddingHorizontal: 14, paddingVertical: 10 },
  addItemText: { color: '#555', fontSize: 13 },
  itemBalance: { paddingHorizontal: 14, paddingBottom: 10 },
  itemBalanceText: { fontSize: 12 },
  itemBalanceOk: { color: '#4ade80' },
  itemBalanceWarn: { color: '#f59e0b' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#111',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 18,
  },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  modalSubtitle: { color: '#8e8e8e', fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 18 },
  modalLabel: { color: '#d5d5d5', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  modalInput: {
    backgroundColor: '#0b0b0b',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  modalTextarea: { minHeight: 90, textAlignVertical: 'top' },
  modalHelp: { color: '#686868', fontSize: 12, marginBottom: 16 },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  modalRightActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  modalDelete: { color: '#ef4444', fontSize: 14, fontWeight: '600' },
  modalCancel: { color: '#8a8a8a', fontSize: 14, fontWeight: '600' },
  modalSave: { color: '#8ab4ff', fontSize: 14, fontWeight: '700' },
});
