import { View, Text, StyleSheet, TouchableOpacity, Alert, Switch, TextInput, ActivityIndicator, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, useEffect, useRef, useMemo } from 'react';
import * as MediaLibrary from 'expo-media-library';
import DateTimePicker from '@react-native-community/datetimepicker';
import { api } from '../services/api';
import { queueConfirmedExpenseClientWork } from '../services/confirmClientWork';
import { invalidateExpenseMutationCaches } from '../services/expenseMutationEffects';
import { LocationPicker } from '../components/LocationPicker';
import { ProvenanceSummary } from '../components/ProvenanceSummary';
import { DismissKeyboardScrollView } from '../components/DismissKeyboardScrollView';
import { useCategories } from '../hooks/useCategories';
import { createManualExpenseDraft } from '../services/manualExpenseDraft';
import { toLocalDateString } from '../services/date';
import { clearNavigationPayload, getNavigationPayload } from '../services/navigationPayloadStore';
import {
  buildItemReviewPresentation,
  createEditableExpenseItem,
  normalizeExpenseItemPayload,
  updateEditableExpenseItem,
} from '../services/itemEditing';
import { colors } from '../theme/tokens';
const { createExpenseIdempotencyKey } = require('../services/expenseIdempotency');
const { expenseDraftError } = require('../services/expenseValidation');
const {
  buildReceiptBreakdownPresentation,
  createEditableReceiptDetails,
  normalizeReceiptDetailsPayload,
  receiptDetailChangedFields,
} = require('../services/receiptDetailsEditing');

function parseConfirmData(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function firstParam(value, fallback = '') {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

function savedCardKey(card = {}) {
  return `${card.payment_method || ''}:${card.card_label || ''}:${card.card_last4 || ''}`;
}

function createEditableDraftItems(parsed = {}) {
  if (!Array.isArray(parsed?.items) || parsed.items.length === 0) return [];
  return parsed.items.map((item) => createEditableExpenseItem({
    ...item,
    source_type: item?.source_type || parsed.source || null,
    raw_description: item?.raw_description || item?.description || '',
  }));
}

function createOriginalItemSnapshot(parsed = {}, editableItems = []) {
  if (!Array.isArray(parsed?.items)) return [];
  return parsed.items.map((item, index) => ({
    observation_key: editableItems[index]?.observation_key || item?.observation_key || null,
    description: item?.description || '',
    raw_description: item?.raw_description || item?.description || '',
    amount: item?.amount ?? null,
    quantity: item?.quantity ?? null,
    unit_price: item?.unit_price ?? null,
  }));
}

const TRACK_ONLY_REASONS = [
  { value: 'business', label: 'Business' },
  { value: 'reimbursable', label: 'Reimbursable' },
  { value: 'different_budget', label: 'Different budget' },
  { value: 'shared_not_mine', label: 'Shared, not mine' },
  { value: 'transfer_like', label: 'Transfer-like' },
  { value: 'other', label: 'Other' },
];

export default function ConfirmScreen() {
  const params = useLocalSearchParams();
  const dataParam = firstParam(params.data, '');
  const payloadKey = firstParam(params.payload_key, '');
  const navigationPayload = useMemo(
    () => getNavigationPayload(payloadKey, null),
    [payloadKey]
  );
  const parsed = useMemo(
    () => createManualExpenseDraft(navigationPayload?.confirmData || parseConfirmData(dataParam)),
    [navigationPayload, dataParam]
  );
  const router = useRouter();
  const { categories, refresh: refreshCategories } = useCategories();
  const isWatchedPlanFlow = Boolean(parsed?.scenario_memory_id);
  const isPurchasePlanFlow = Boolean(parsed?.purchase_plan_id);
  const isManualScratchFlow = parsed?.source === 'manual' && !parsed?.merchant && !parsed?.description && !parsed?.scenario_memory_id && !parsed?.purchase_plan_id;

  const [expense, setExpense] = useState(parsed);
  const [amountText, setAmountText] = useState(String(Math.abs(parsed?.amount ?? 0)));
  const [merchant, setMerchant] = useState(parsed.merchant || '');
  const [description, setDescription] = useState(parsed.description || '');
  const [saving, setSaving] = useState(false);
  const [locationData, setLocationData] = useState(null);
  const [saveToRoll, setSaveToRoll] = useState(false);
  const [isRefund, setIsRefund] = useState((parsed?.amount ?? 0) < 0);
  const [paymentMethod, setPaymentMethod] = useState(parsed.payment_method || 'unknown');
  const [cardLast4, setCardLast4] = useState(parsed.card_last4 || '');
  const [cardLabel, setCardLabel] = useState(parsed.card_label || '');
  const [excludeFromBudget, setExcludeFromBudget] = useState(parsed.exclude_from_budget || false);
  const [budgetExclusionReason, setBudgetExclusionReason] = useState(parsed.budget_exclusion_reason || null);
  const [savedCards, setSavedCards] = useState([]);
  const [selectedSavedCardKey, setSelectedSavedCardKey] = useState(null);
  const [savedCardMatchNote, setSavedCardMatchNote] = useState(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [categoryUserOwned, setCategoryUserOwned] = useState(false);
  const [locationUserOwned, setLocationUserOwned] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [catSearch, setCatSearch] = useState('');
  const [catCreating, setCatCreating] = useState(false);
  const [catSuggestion, setCatSuggestion] = useState(null);
  const [catSuggestionLoading, setCatSuggestionLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const confirmRequestKeyRef = useRef(createExpenseIdempotencyKey('confirm'));
  const initialItems = useMemo(() => createEditableDraftItems(parsed), [parsed]);
  const originalParsedItemsRef = useRef(createOriginalItemSnapshot(parsed, initialItems));
  const [items, setItems] = useState(initialItems);
  const initialReceiptDetails = useMemo(() => createEditableReceiptDetails(parsed), [parsed]);
  const originalReceiptDetailsRef = useRef(initialReceiptDetails);
  const [receiptDetails, setReceiptDetails] = useState(initialReceiptDetails);
  const reviewFields = Array.isArray(expense?.review_fields) ? expense.review_fields : [];
  const fieldConfidence = expense?.field_confidence || {};
  const itemReviewPresentation = useMemo(
    () => buildItemReviewPresentation({
      ...expense,
      subtotal: receiptDetails.subtotal,
      discounts: receiptDetails.discounts,
    }, items, amountText),
    [expense, items, amountText, receiptDetails.subtotal, receiptDetails.discounts]
  );
  const receiptBreakdownPresentation = useMemo(
    () => buildReceiptBreakdownPresentation(receiptDetails, amountText),
    [receiptDetails, amountText]
  );
  const effectiveReviewFields = reviewFields.filter(
    (field) => field !== 'items' || itemReviewPresentation
  );

  useEffect(() => {
    setExpense(parsed);
    setAmountText(String(Math.abs(parsed?.amount ?? 0)));
    setMerchant(parsed?.merchant || '');
    setDescription(parsed?.description || '');
    setSaveToRoll(false);
    setIsRefund((parsed?.amount ?? 0) < 0);
    setPaymentMethod(parsed?.payment_method || 'unknown');
    setCardLast4(parsed?.card_last4 || '');
    setCardLabel(parsed?.card_label || '');
    setExcludeFromBudget(parsed?.exclude_from_budget || false);
    setBudgetExclusionReason(parsed?.budget_exclusion_reason || null);
    setSelectedSavedCardKey(null);
    setSavedCardMatchNote(null);
    setIsPrivate(Boolean(parsed?.is_private));
    setCategoryUserOwned(false);
    setLocationUserOwned(false);
    setShowCategoryPicker(false);
    setCatSearch('');
    setCatCreating(false);
    setCatSuggestion(null);
    setCatSuggestionLoading(false);
    setShowDatePicker(false);
    const nextItems = createEditableDraftItems(parsed);
    originalParsedItemsRef.current = createOriginalItemSnapshot(parsed, nextItems);
    setItems(nextItems);
    const nextReceiptDetails = createEditableReceiptDetails(parsed);
    originalReceiptDetailsRef.current = nextReceiptDetails;
    setReceiptDetails(nextReceiptDetails);
    setLocationData(
      parsed?.place_name || parsed?.address || parsed?.mapkit_stable_id
        ? {
            place_name: parsed.place_name || parsed.merchant || '',
            address: parsed.address || null,
            mapkit_stable_id: parsed.mapkit_stable_id || null,
            provider_place_id: parsed.location_provider_id || parsed.provider_place_id || null,
            latitude: parsed.location_latitude ?? parsed.latitude ?? null,
            longitude: parsed.location_longitude ?? parsed.longitude ?? null,
            source: parsed.location_source || (parsed.source === 'camera' ? 'receipt' : null),
            location_status: parsed.location_status || null,
            location_confidence: parsed.location_confidence ?? null,
            location_user_owned: Boolean(parsed.location_user_owned),
          }
        : null
    );
    confirmRequestKeyRef.current = createExpenseIdempotencyKey('confirm');
  }, [payloadKey, dataParam, parsed]);

  useEffect(() => {
    if (!payloadKey) return undefined;
    return () => {
      clearNavigationPayload(payloadKey);
    };
  }, [payloadKey]);

  function confidenceMeta(field) {
    const level = fieldConfidence[field];
    if (level === 'low') return { text: 'Needs review', style: styles.confidenceLow };
    if (level === 'medium') return { text: 'Double-check', style: styles.confidenceMedium };
    return null;
  }

  function reviewNote(field, fallback = 'Double-check this field before saving.') {
    const meta = confidenceMeta(field);
    if (!meta) return null;
    return (
      <View style={styles.confidenceNoteRow}>
        <View style={[styles.confidencePill, meta.style]}>
          <Text style={styles.confidencePillText}>{meta.text}</Text>
        </View>
        <Text style={styles.confidenceHint}>{fallback}</Text>
      </View>
    );
  }

  async function refreshSavedCards() {
    const cards = await api.get('/expenses/cards');
    setSavedCards(cards || []);
  }

  useEffect(() => {
    refreshSavedCards().catch(() => {});
  }, []);

  useEffect(() => {
    if (!paymentMethod || paymentMethod === 'unknown') {
      setSavedCardMatchNote(null);
      return;
    }

    const exactMatch = savedCards.find((card) =>
      card.payment_method === paymentMethod
      && cardLast4
      && card.card_last4 === cardLast4
    );
    if (exactMatch) {
      setSelectedSavedCardKey(savedCardKey(exactMatch));
      if (!cardLabel && exactMatch.card_label) setCardLabel(exactMatch.card_label);
      setSavedCardMatchNote('Matched a saved card from the last 4 digits.');
      return;
    }

    const labelMatch = savedCards.find((card) =>
      card.payment_method === paymentMethod
      && cardLabel
      && card.card_label
      && card.card_label.toLowerCase() === cardLabel.toLowerCase()
    );
    if (labelMatch) {
      if (!cardLast4 && labelMatch.card_last4) setCardLast4(labelMatch.card_last4);
      setSavedCardMatchNote('Prefilled from a saved card label. Double-check before saving.');
      return;
    }

    setSavedCardMatchNote(null);
  }, [savedCards, paymentMethod, cardLast4, cardLabel]);

  useEffect(() => {
    if (!excludeFromBudget) {
      setBudgetExclusionReason(null);
    } else if (!budgetExclusionReason) {
      setBudgetExclusionReason(TRACK_ONLY_REASONS[0].value);
    }
  }, [excludeFromBudget, budgetExclusionReason]);

  useEffect(() => {
    if (selectedSavedCard && selectedSavedCard.payment_method !== paymentMethod) {
      setSelectedSavedCardKey(null);
    }
    if (paymentMethod === 'unknown') {
      setSavedCardMatchNote(null);
    }
  }, [paymentMethod, selectedSavedCard, selectedSavedCardKey]);

  const isCameraSource = parsed.source === 'camera';
  const cardsForMethod = savedCards.filter(c => c.payment_method === paymentMethod);
  const selectedSavedCard = cardsForMethod.find(c => savedCardKey(c) === selectedSavedCardKey) || null;
  const canRenameSavedCard = Boolean(
    selectedSavedCard
      && ((cardLabel || '') !== (selectedSavedCard.card_label || '') || (cardLast4 || '') !== (selectedSavedCard.card_last4 || ''))
      && (cardLabel || cardLast4)
  );

  function handleItemChange(index, field, value) {
    setItems(prev => prev.map((it, i) => (
      i === index ? updateEditableExpenseItem(it, field, value) : it
    )));
  }
  function handleAddItem() {
    setItems(prev => [...prev, createEditableExpenseItem({
      description: '',
      amount: '',
      quantity: '',
      unit_price: '',
      upc: null,
      sku: null,
      brand: null,
      product_size: null,
      pack_size: null,
      unit: null,
    })]);
  }
  function handleRemoveItem(index) {
    setItems(prev => prev.filter((_, i) => i !== index));
  }

  function handleReceiptDetailChange(field, value) {
    setReceiptDetails((current) => ({ ...current, [field]: value }));
  }

  function handleRefundToggle(value) {
    setIsRefund(value);
    setExpense(prev => ({
      ...prev,
      amount: value ? -Math.abs(parseFloat(amountText) || 0) : Math.abs(parseFloat(amountText) || 0),
    }));
  }

  async function forgetSavedCard(card) {
    try {
      await api.post('/expenses/cards/forget', {
        payment_method: card.payment_method,
        card_label: card.card_label || null,
        card_last4: card.card_last4 || null,
      });
      if (savedCardKey(card) === selectedSavedCardKey) {
        setSelectedSavedCardKey(null);
        if ((cardLabel || '') === (card.card_label || '')) setCardLabel('');
        if ((cardLast4 || '') === (card.card_last4 || '')) setCardLast4('');
      }
      await invalidateExpenseMutationCaches({ includePending: false });
      await refreshSavedCards();
    } catch (err) {
      Alert.alert('Error', err.message || 'Could not remove saved card');
    }
  }

  async function renameSavedCard() {
    if (!selectedSavedCard) return;
    try {
      await api.patch('/expenses/cards/rename', {
        payment_method: selectedSavedCard.payment_method,
        card_label: selectedSavedCard.card_label || null,
        card_last4: selectedSavedCard.card_last4 || null,
        next_card_label: cardLabel || null,
        next_card_last4: cardLast4 || null,
      });
      await invalidateExpenseMutationCaches({ includePending: false });
      await refreshSavedCards();
      setSelectedSavedCardKey(savedCardKey({
        payment_method: selectedSavedCard.payment_method,
        card_label: cardLabel || null,
        card_last4: cardLast4 || null,
      }));
    } catch (err) {
      Alert.alert('Error', err.message || 'Could not update saved card');
    }
  }

  function updateExpenseDate(nextDate) {
    setExpense(prev => ({ ...prev, date: nextDate }));
  }

  function handleDateChange(_, selectedDate) {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (selectedDate) {
      updateExpenseDate(toLocalDateString(selectedDate));
    }
  }

  function selectCategory(cat) {
    setCategoryUserOwned(true);
    setExpense(prev => ({ ...prev, category_id: cat?.id || null, category_name: cat?.name || null }));
    setCatSearch('');
    setCatSuggestion(null);
    setShowCategoryPicker(false);
  }

  useEffect(() => {
    const name = catSearch.trim();
    const exactMatch = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (!name || exactMatch) {
      setCatSuggestion(null);
      setCatSuggestionLoading(false);
      return undefined;
    }

    let cancelled = false;
    setCatSuggestionLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ name });
        if (merchant.trim()) params.set('merchant', merchant.trim());
        if (description.trim()) params.set('description', description.trim());
        const suggestion = await api.get(`/categories/quick-parent-suggestion?${params.toString()}`);
        if (!cancelled) setCatSuggestion(suggestion);
      } catch {
        if (!cancelled) setCatSuggestion(null);
      } finally {
        if (!cancelled) setCatSuggestionLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [catSearch, merchant, description, categories]);

  async function createAndSelectCategory() {
    const name = catSearch.trim();
    if (!name) return;
    setCatCreating(true);
    try {
      const newCat = await api.post('/categories/quick', {
        name,
        merchant: merchant.trim() || null,
        description: description.trim() || null,
        preferred_parent_id: catSuggestion?.parent_id || null,
      });
      setCategoryUserOwned(true);
      setExpense(prev => ({ ...prev, category_id: newCat.id, category_name: newCat.name }));
      setCatSearch('');
      setCatSuggestion(null);
      setShowCategoryPicker(false);
      refreshCategories();
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not create category');
    } finally {
      setCatCreating(false);
    }
  }

  async function handleConfirm() {
    try {
      setSaving(true);
      const validationError = expenseDraftError({ merchant, amount: expense.amount, date: expense.date });
      if (validationError) {
        Alert.alert('Check expense details', validationError);
        return;
      }
      if (excludeFromBudget && !budgetExclusionReason) {
        Alert.alert('Choose a reason', 'Pick why this should be tracked without counting it toward your budget.');
        return;
      }

      const normalizedReceiptDetails = normalizeReceiptDetailsPayload(receiptDetails);
      const correctedReceiptFields = receiptDetailChangedFields(
        originalReceiptDetailsRef.current,
        receiptDetails
      );
      const result = await api.post('/expenses/confirm', {
        idempotency_key: confirmRequestKeyRef.current,
        purchase_plan_id: parsed?.purchase_plan_id || null,
        merchant: merchant.trim() || null,
        description: description.trim() || null,
        amount: expense.amount,
        date: expense.date,
        category_id: expense.category_id || null,
        suggested_category_id: parsed?.category_id || null,
        category_source: parsed?.category_source || null,
        category_confidence: parsed?.category_confidence ?? null,
        category_reasoning: parsed?.category_reasoning || null,
        category_status: parsed?.category_status || (expense.category_id ? 'assigned' : null),
        location_status: locationData?.location_status
          || (locationUserOwned && !locationData ? 'cleared' : parsed?.location_status)
          || null,
        category_user_owned: categoryUserOwned,
        location_user_owned: locationUserOwned,
        source: isRefund ? 'refund' : (parsed?.source || 'manual'),
        notes: expense.notes,
        place_name: locationData?.place_name,
        address: locationData?.address,
        mapkit_stable_id: locationData?.mapkit_stable_id,
        location_provider_id: locationData?.provider_place_id || null,
        location_latitude: locationData?.latitude ?? null,
        location_longitude: locationData?.longitude ?? null,
        location_source: locationData?.source
          || (locationUserOwned && !locationData ? 'user_cleared' : parsed?.location_source)
          || null,
        location_confidence: locationData?.location_confidence ?? parsed?.location_confidence ?? null,
        payment_method: paymentMethod,
        card_last4: cardLast4 || null,
        card_label: cardLabel || null,
        is_private: isPrivate,
        exclude_from_budget: excludeFromBudget,
        budget_exclusion_reason: excludeFromBudget ? budgetExclusionReason : null,
        ingest_attempt_id: parsed?.ingest_attempt_id || null,
        parsed_payment_snapshot: parsed?.parsed_payment_snapshot || {
          payment_method: parsed?.payment_method || null,
          card_label: parsed?.card_label || null,
          card_last4: parsed?.card_last4 || null,
        },
        receipt_details: parsed?.source === 'camera' ? {
          ...normalizedReceiptDetails,
          validation: {
            ...(parsed?.receipt_validation || {}),
            uncertain_fields: parsed?.uncertain_fields || [],
            field_confidence: parsed?.field_confidence || {},
            user_corrected_fields: correctedReceiptFields,
          },
        } : undefined,
        original_parsed_items: parsed?.ingest_attempt_id && Array.isArray(parsed?.items)
          ? originalParsedItemsRef.current
          : undefined,
        items: items.length > 0
          ? items
              .filter(it => it.description.trim())
              .map((it) => normalizeExpenseItemPayload(it))
          : undefined,
      });
      queueConfirmedExpenseClientWork({
        expense: result?.expense || null,
        extraWork: [
          parsed?.scenario_memory_id
            ? async () => {
                await api.post(`/trends/scenario-memory/${parsed.scenario_memory_id}/resolve`, {
                  action: 'bought',
                  expense_id: result?.expense?.id || null,
                });
              }
            : null,
          isCameraSource && saveToRoll && parsed.image_uri
            ? async () => {
                const { status } = await MediaLibrary.requestPermissionsAsync();
                if (status === 'granted') {
                  await MediaLibrary.saveToLibraryAsync(parsed.image_uri);
                }
              }
            : null,
        ].filter(Boolean),
      });

      if (isPurchasePlanFlow) {
        router.replace('/plans');
      } else if (isWatchedPlanFlow) {
        router.replace({
          pathname: '/watching-plans',
          params: {
            resolved: 'bought',
            label: merchant.trim() || parsed?.merchant || parsed?.description || 'Watched plan',
          },
        });
      } else {
        router.replace('/(tabs)');
      }
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <DismissKeyboardScrollView style={styles.container} contentContainerStyle={styles.content}>
      {isPurchasePlanFlow ? (
        <View style={styles.watchBanner}>
          <Text style={styles.watchBannerTitle}>Logging a planned purchase</Text>
          <Text style={styles.watchBannerBody}>Once saved, the plan will be marked purchased and linked to this expense.</Text>
        </View>
      ) : isWatchedPlanFlow ? (
        <View style={styles.watchBanner}>
          <Text style={styles.watchBannerTitle}>Logging a watched plan</Text>
          <Text style={styles.watchBannerBody}>
            Once you save this expense, Adlo will mark the watched plan as bought.
          </Text>
        </View>
      ) : null}
      <ProvenanceSummary
        expense={{
          ...expense,
          source: parsed?.source || expense?.source || 'manual',
          review_fields: effectiveReviewFields,
        }}
        compact
        style={styles.provenanceBanner}
      />
      {/* Merchant / Description — editable */}
      <View style={styles.editableGroup}>
        <View style={styles.editableRow}>
          <Text style={styles.editableLabel}>{merchant.trim() ? 'MERCHANT' : 'DETAILS'}</Text>
          <TextInput
            style={styles.editableInput}
            value={merchant.trim() ? merchant : description}
            onChangeText={merchant.trim() ? setMerchant : setDescription}
            placeholder={merchant.trim() ? 'Merchant name' : 'What was this for?'}
            placeholderTextColor={colors.textDisabled}
            autoCorrect
            spellCheck
            autoCapitalize="words"
            accessibilityLabel={merchant.trim() ? 'Merchant' : 'Expense details'}
          />
        </View>
      </View>
      {merchant.trim()
        ? reviewNote('merchant', 'Merchant was inferred from the parse.')
        : reviewNote('description', 'Description was inferred from the parse.')}
      {/* If both merchant and description exist (e.g. from receipt scan), show both */}
      {merchant.trim() && description.trim() ? (
        <>
          <View style={styles.editableGroup}>
            <View style={styles.editableRow}>
              <Text style={styles.editableLabel}>DESCRIPTION</Text>
              <TextInput
                style={styles.editableInput}
                value={description}
                onChangeText={setDescription}
                placeholder="Description"
                placeholderTextColor={colors.textDisabled}
                autoCorrect
                spellCheck
                accessibilityLabel="Description"
              />
            </View>
          </View>
          {reviewNote('description', 'Description was inferred from the parse.')}
        </>
      ) : null}

      <View style={styles.editableGroup}>
        <View style={styles.editableRow}>
          <Text style={styles.editableLabel}>AMOUNT</Text>
          <TextInput
            style={styles.editableInput}
            value={amountText}
            onChangeText={value => {
              setAmountText(value);
              setExpense(prev => ({
                ...prev,
                amount: isRefund
                  ? -Math.abs(parseFloat(value) || 0)
                  : Math.abs(parseFloat(value) || 0),
              }));
            }}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.textDisabled}
            accessibilityLabel="Amount"
          />
        </View>
        {reviewNote('amount', 'Amount may need a quick check.')}
      </View>
      <View style={styles.editableGroup}>
        <View style={styles.editableRow}>
          <Text style={styles.editableLabel}>DATE</Text>
          {Platform.OS === 'ios' ? (
            <DateTimePicker
              value={expense.date ? new Date(`${expense.date}T12:00:00`) : new Date()}
              mode="date"
              display="compact"
              maximumDate={new Date()}
              onChange={handleDateChange}
              themeVariant="dark"
              style={styles.confirmDatePicker}
            />
          ) : (
            <TouchableOpacity style={styles.dateButton} onPress={() => setShowDatePicker(true)} accessibilityRole="button" accessibilityLabel={`Expense date ${expense.date || 'not selected'}`}>
              <Text style={styles.dateButtonText}>{expense.date || 'Select date'}</Text>
            </TouchableOpacity>
          )}
        </View>
        {Platform.OS === 'android' && showDatePicker ? (
          <DateTimePicker
            value={expense.date ? new Date(`${expense.date}T12:00:00`) : new Date()}
            mode="date"
            display="default"
            maximumDate={new Date()}
            onChange={handleDateChange}
          />
        ) : null}
        {reviewNote('date', 'Date was inferred and may need adjusting.')}
      </View>

      {isCameraSource ? (
        <View style={styles.receiptDetailsSection}>
          <Text style={styles.sectionLabel}>RECEIPT BREAKDOWN</Text>
          <Text style={styles.receiptDetailsHint}>
            Check the printed breakdown. Savings is informational and is not subtracted from the subtotal again.
          </Text>
          {receiptBreakdownPresentation ? (
            <View style={[styles.itemReviewNotice, styles.itemReviewNoticeWarning]}>
              <Text style={styles.itemReviewNoticeTitle}>{receiptBreakdownPresentation.title}</Text>
              <Text style={styles.itemReviewNoticeBody}>{receiptBreakdownPresentation.body}</Text>
            </View>
          ) : null}
          <View style={styles.receiptDetailsGrid}>
            {[
              ['subtotal', 'Subtotal'],
              ['tax', 'Tax'],
              ['tip', 'Tip'],
              ['fees', 'Fees'],
              ['discounts', 'Savings'],
            ].map(([field, label]) => (
              <View key={field} style={styles.receiptDetailField}>
                <Text style={styles.itemMetricLabel}>{label}</Text>
                <TextInput
                  style={styles.itemMetricInput}
                  value={receiptDetails[field]}
                  onChangeText={(value) => handleReceiptDetailChange(field, value)}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.textDisabled}
                  accessibilityLabel={`Receipt ${label.toLowerCase()}`}
                />
              </View>
            ))}
            <View style={styles.receiptDetailField}>
              <Text style={styles.itemMetricLabel}>Currency</Text>
              <TextInput
                style={styles.itemMetricInput}
                value={receiptDetails.currency}
                onChangeText={(value) => handleReceiptDetailChange('currency', value.toUpperCase().slice(0, 3))}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={3}
                placeholder="USD"
                placeholderTextColor={colors.textDisabled}
                accessibilityLabel="Receipt currency"
              />
            </View>
          </View>
          <View style={styles.receiptMetaRow}>
            <View style={styles.receiptMetaField}>
              <Text style={styles.itemMetricLabel}>Time (24h)</Text>
              <TextInput
                style={styles.itemMetricInput}
                value={receiptDetails.purchase_time}
                onChangeText={(value) => handleReceiptDetailChange('purchase_time', value)}
                placeholder="14:30"
                placeholderTextColor={colors.textDisabled}
                maxLength={5}
                accessibilityLabel="Receipt purchase time"
              />
            </View>
            <View style={styles.receiptMetaField}>
              <Text style={styles.itemMetricLabel}>Store #</Text>
              <TextInput
                style={styles.itemMetricInput}
                value={receiptDetails.store_number}
                onChangeText={(value) => handleReceiptDetailChange('store_number', value)}
                placeholder="Optional"
                placeholderTextColor={colors.textDisabled}
                autoCorrect={false}
                accessibilityLabel="Receipt store number"
              />
            </View>
          </View>
          <View style={styles.receiptTransactionField}>
            <Text style={styles.itemMetricLabel}>Transaction / order ID</Text>
            <TextInput
              style={styles.itemMetricInput}
              value={receiptDetails.transaction_id}
              onChangeText={(value) => handleReceiptDetailChange('transaction_id', value)}
              placeholder="Optional"
              placeholderTextColor={colors.textDisabled}
              autoCorrect={false}
              autoCapitalize="characters"
              accessibilityLabel="Receipt transaction or order ID"
            />
          </View>
          {reviewNote('receipt totals', 'One or more printed totals did not reconcile. Check the breakdown and paid total.')}
        </View>
      ) : null}

      {/* Category — tappable picker */}
      <View style={styles.editableGroup}>
        <TouchableOpacity
          style={styles.categoryRow}
          onPress={() => setShowCategoryPicker(!showCategoryPicker)}
          accessibilityRole="button"
          accessibilityLabel={`Category ${expense.category_name || 'Unassigned'}`}
          accessibilityState={{ expanded: showCategoryPicker }}
        >
          <Text style={styles.categoryLabel}>CATEGORY</Text>
          <View style={styles.categoryRight}>
            <Text style={styles.categoryValue} numberOfLines={1}>{expense.category_name || 'Unassigned'}</Text>
            <Text style={styles.categoryChevron}>{showCategoryPicker ? '▲' : '▼'}</Text>
          </View>
        </TouchableOpacity>
      </View>
      {showCategoryPicker && (
        <View style={styles.categoryPicker}>
          {/* Search / create input */}
          <View style={styles.catSearchRow}>
            <TextInput
              style={styles.catSearchInput}
              placeholder="Search or create..."
              placeholderTextColor={colors.textDisabled}
              value={catSearch}
              onChangeText={setCatSearch}
              autoCorrect={false}
            />
            {catSearch.trim() && !categories.find(c => c.name.toLowerCase() === catSearch.trim().toLowerCase()) && (
              <TouchableOpacity
                style={[styles.catCreateBtn, catCreating && { opacity: 0.5 }]}
                onPress={createAndSelectCategory}
                disabled={catCreating}
              >
                {catCreating
                  ? <ActivityIndicator size="small" color={colors.textInverse} />
                  : <Text style={styles.catCreateText}>
                      {catSuggestion?.parent_name && catSuggestion.source !== 'fallback_uncategorized' && catSuggestion.source !== 'created_uncategorized'
                        ? `+ Create under ${catSuggestion.parent_name}`
                        : '+ Create'}
                    </Text>}
              </TouchableOpacity>
            )}
          </View>
          {catSearch.trim() && !categories.find(c => c.name.toLowerCase() === catSearch.trim().toLowerCase()) ? (
            <View style={styles.catSuggestionRow}>
              {catSuggestionLoading ? (
                <ActivityIndicator size="small" color={colors.textDisabled} />
              ) : catSuggestion?.parent_name ? (
                <Text style={styles.catSuggestionText}>
                  {catSuggestion.source === 'fallback_uncategorized' || catSuggestion.source === 'created_uncategorized'
                    ? `Will group under ${catSuggestion.parent_name} for now`
                    : `Suggested parent: ${catSuggestion.parent_name}`}
                </Text>
              ) : null}
            </View>
          ) : null}
          {/* Chips */}
          <View style={styles.catChipsWrap}>
            {!catSearch && (
              <TouchableOpacity
                style={[styles.catChip, !expense.category_id && styles.catChipActive]}
                onPress={() => selectCategory(null)}
              >
                <Text style={[styles.catChipText, !expense.category_id && styles.catChipTextActive]}>Unassigned</Text>
              </TouchableOpacity>
            )}
            {categories
              .filter(c => !catSearch || c.name.toLowerCase().includes(catSearch.toLowerCase()))
              .map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.catChip, expense.category_id === c.id && styles.catChipActive]}
                  onPress={() => selectCategory(c)}
                >
                  <Text style={[styles.catChipText, expense.category_id === c.id && styles.catChipTextActive]}>{c.name}</Text>
                </TouchableOpacity>
              ))}
          </View>
        </View>
      )}

      <LocationPicker
        onLocation={(nextLocation) => {
          setLocationData(nextLocation);
          setLocationUserOwned(true);
        }}
        locationData={locationData}
        merchant={merchant}
      />

      {isManualScratchFlow && items.length === 0 ? (
        <TouchableOpacity style={styles.addItemsPrompt} onPress={handleAddItem}>
          <Text style={styles.addItemsPromptTitle}>Add item details</Text>
          <Text style={styles.addItemsPromptBody}>
            Optional for split purchases or receipts you want to break down.
          </Text>
        </TouchableOpacity>
      ) : null}

      {(items.length > 0 || parsed?.source === 'camera' || parsed?.source === 'email') && (
        <View style={styles.itemsSection}>
          <Text style={styles.sectionLabel}>ITEMS</Text>
          {itemReviewPresentation ? (
            <View style={[
              styles.itemReviewNotice,
              itemReviewPresentation.tone === 'warning' && styles.itemReviewNoticeWarning,
            ]}>
              <Text style={styles.itemReviewNoticeTitle}>{itemReviewPresentation.title}</Text>
              <Text style={styles.itemReviewNoticeBody}>{itemReviewPresentation.body}</Text>
            </View>
          ) : null}
          {parsed?.items_truncated ? (
            <Text style={styles.truncatedItemsNote}>
              This receipt shows about {parsed.visible_item_count || 'more'} items. The first {items.length} were extracted. Add or correct the rest if you need a complete item history.
            </Text>
          ) : null}
          {items.map((item, i) => (
            <View key={item.observation_key || i} style={styles.itemCard}>
              <View style={styles.itemRow}>
                <TextInput
                  style={styles.itemDescInput}
                  placeholder="Description"
                  placeholderTextColor={colors.textDisabled}
                  value={item.description}
                  onChangeText={v => handleItemChange(i, 'description', v)}
                />
                <TouchableOpacity onPress={() => handleRemoveItem(i)} style={styles.removeItemBtn} accessibilityRole="button" accessibilityLabel={`Remove ${item.description || `item ${i + 1}`}`}>
                  <Text style={styles.removeItemText}>×</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.itemMetricsRow}>
                <View style={styles.itemMetricField}>
                  <Text style={styles.itemMetricLabel}>Qty</Text>
                  <TextInput
                    style={styles.itemMetricInput}
                    placeholder="1"
                    placeholderTextColor={colors.textDisabled}
                    value={item.quantity}
                    onChangeText={v => handleItemChange(i, 'quantity', v)}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.itemMetricField}>
                  <Text style={styles.itemMetricLabel}>Each</Text>
                  <TextInput
                    style={styles.itemMetricInput}
                    placeholder="0.00"
                    placeholderTextColor={colors.textDisabled}
                    value={item.unit_price}
                    onChangeText={v => handleItemChange(i, 'unit_price', v)}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.itemMetricFieldWide}>
                  <Text style={styles.itemMetricLabel}>Total</Text>
                  <TextInput
                    style={styles.itemMetricInput}
                    placeholder="0.00"
                    placeholderTextColor={colors.textDisabled}
                    value={item.amount}
                    onChangeText={v => handleItemChange(i, 'amount', v)}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            </View>
          ))}
          <TouchableOpacity onPress={handleAddItem} style={styles.addItemRow}>
            <Text style={styles.addItemText}>+ Add item</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>This is a refund / return</Text>
        <Switch
          value={isRefund}
          onValueChange={handleRefundToggle}
          trackColor={{ false: colors.borderStrong, true: colors.warning }}
          thumbColor={isRefund ? colors.text : colors.textSubtle}
        />
      </View>

      {/* Payment method */}
      <View style={styles.paymentSection}>
        <Text style={styles.sectionLabel}>PAYMENT</Text>
        <View style={styles.methodRow}>
          {['cash', 'debit', 'credit', 'unknown'].map(m => (
            <TouchableOpacity
              key={m}
              style={[styles.methodChip, paymentMethod === m && styles.methodChipActive]}
              onPress={() => setPaymentMethod(m)}
            >
              <Text style={[styles.methodChipText, paymentMethod === m && styles.methodChipTextActive]}>
                {m === 'unknown' ? 'other' : m}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {(paymentMethod === 'debit' || paymentMethod === 'credit') && (
          <>
            {cardsForMethod.length > 0 && (
              <View style={styles.savedCardsRow}>
                {cardsForMethod.map((c, i) => {
                  const isSelected = cardLabel === (c.card_label || '') && cardLast4 === (c.card_last4 || '');
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[styles.savedCardChip, isSelected && styles.savedCardChipActive]}
                      onPress={() => {
                        setCardLabel(c.card_label || '');
                        setCardLast4(c.card_last4 || '');
                        setSelectedSavedCardKey(savedCardKey(c));
                      }}
                      onLongPress={() =>
                        Alert.alert(
                          'Saved card',
                          'What would you like to do with this saved card?',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Forget card', style: 'destructive', onPress: () => forgetSavedCard(c) },
                          ]
                        )
                      }
                    >
                      <Text style={[styles.savedCardChipText, isSelected && styles.savedCardChipTextActive]}>
                        {c.card_label || ''}
                        {c.card_last4 ? ` ····${c.card_last4}` : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            {cardsForMethod.length > 0 ? (
              <Text style={styles.savedCardsHint}>Long-press a saved card to remove it.</Text>
            ) : null}
            {savedCardMatchNote ? (
              <Text style={styles.savedCardsMatchNote}>{savedCardMatchNote}</Text>
            ) : null}
            <View style={styles.cardRow}>
              <TextInput
                style={[styles.cardInput, { flex: 1 }]}
                placeholder="Card nickname (optional)"
                placeholderTextColor={colors.textDisabled}
                value={cardLabel}
                onChangeText={setCardLabel}
              />
              <TextInput
                style={[styles.cardInput, { width: 64 }]}
                placeholder="last 4"
                placeholderTextColor={colors.textDisabled}
                value={cardLast4}
                onChangeText={t => setCardLast4(t.replace(/\D/g, '').slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>
            {canRenameSavedCard ? (
              <TouchableOpacity style={styles.savedCardUpdateBtn} onPress={renameSavedCard}>
                <Text style={styles.savedCardUpdateText}>Update saved card</Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </View>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Keep private</Text>
        <Switch
          value={isPrivate}
          onValueChange={setIsPrivate}
          trackColor={{ false: colors.borderStrong, true: colors.accentMuted }}
          thumbColor={isPrivate ? colors.accent : colors.textSubtle}
        />
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.toggleTextWrap}>
          <Text style={styles.toggleLabel}>Track only</Text>
          <Text style={styles.toggleHint}>Save it without counting it toward your budget.</Text>
        </View>
        <Switch
          value={excludeFromBudget}
          onValueChange={setExcludeFromBudget}
          trackColor={{ false: colors.borderStrong, true: colors.successMuted }}
          thumbColor={excludeFromBudget ? colors.success : colors.textSubtle}
        />
      </View>

      {excludeFromBudget ? (
        <View style={styles.trackOnlyReasonBlock}>
          <Text style={styles.trackOnlyReasonLabel}>Why are you tracking it separately?</Text>
          <View style={styles.reasonChipWrap}>
            {TRACK_ONLY_REASONS.map((reason) => {
              const selected = budgetExclusionReason === reason.value;
              return (
                <TouchableOpacity
                  key={reason.value}
                  style={[styles.reasonChip, selected && styles.reasonChipActive]}
                  onPress={() => setBudgetExclusionReason(reason.value)}
                  activeOpacity={0.82}
                >
                  <Text style={[styles.reasonChipText, selected && styles.reasonChipTextActive]}>{reason.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

      {isCameraSource && (
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Save receipt to camera roll</Text>
          <Switch
            value={saveToRoll}
            onValueChange={setSaveToRoll}
          trackColor={{ false: colors.borderStrong, true: colors.accentMuted }}
          thumbColor={saveToRoll ? colors.accent : colors.textSubtle}
          />
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.discard} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Discard expense">
          <Text style={styles.discardText}>discard</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirm, saving && styles.confirmDisabled]}
          onPress={handleConfirm}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Confirm expense"
          accessibilityState={{ disabled: saving, busy: saving }}
        >
          <Text style={styles.confirmText}>{saving ? 'saving...' : 'confirm'}</Text>
        </TouchableOpacity>
      </View>
    </DismissKeyboardScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20 },
  watchBanner: {
    backgroundColor: colors.infoMuted,
    borderWidth: 1,
    borderColor: colors.infoMuted,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  watchBannerTitle: { color: colors.text, fontSize: 13, fontWeight: '600', marginBottom: 2 },
  watchBannerBody: { color: colors.text, fontSize: 12, lineHeight: 17 },
  provenanceBanner: { marginBottom: 12 },
  editableGroup: { marginBottom: 8 },
  confidenceNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: -2,
    marginBottom: 2,
    paddingHorizontal: 4,
  },
  confidencePill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  confidenceMedium: {
    backgroundColor: colors.warningMuted,
    borderWidth: 1,
    borderColor: colors.warningMuted,
  },
  confidenceLow: {
    backgroundColor: colors.dangerMuted,
    borderWidth: 1,
    borderColor: colors.dangerMuted,
  },
  confidencePillText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  confidenceHint: {
    flex: 1,
    color: colors.textDisabled,
    fontSize: 11,
  },

  editableRow: {
    backgroundColor: colors.borderSubtle, borderRadius: 8, padding: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  editableLabel: { fontSize: 11, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 1, width: 92 },
  editableInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    textAlign: 'right',
    paddingHorizontal: 6,
    paddingVertical: 4,
    minHeight: 28,
  },
  confirmDatePicker: { marginRight: -2 },
  dateButton: { flex: 1, alignItems: 'flex-end', paddingHorizontal: 6, paddingVertical: 8, minHeight: 44, justifyContent: 'center' },
  dateButtonText: { color: colors.text, fontSize: 15, textAlign: 'right' },

  categoryRow: {
    backgroundColor: colors.borderSubtle, borderRadius: 8, padding: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  categoryLabel: { fontSize: 11, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 1, width: 92 },
  categoryRight: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6, minHeight: 28, paddingLeft: 8 },
  categoryValue: { flexShrink: 1, fontSize: 15, color: colors.text, textAlign: 'right' },
  categoryChevron: { fontSize: 11, color: colors.textSubtle },
  categoryPicker: {
    backgroundColor: colors.surface, borderRadius: 8, padding: 10, marginBottom: 8, gap: 8,
  },
  catSearchRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  catSearchInput: { flex: 1, backgroundColor: colors.borderSubtle, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.borderStrong },
  catCreateBtn: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center' },
  catCreateText: { color: colors.textInverse, fontSize: 14, fontWeight: '600' },
  catSuggestionRow: { minHeight: 18, justifyContent: 'center' },
  catSuggestionText: { color: colors.textDisabled, fontSize: 12 },
  catChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  catChip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.borderSubtle, borderWidth: 1, borderColor: colors.borderStrong },
  catChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  catChipText: { fontSize: 14, color: colors.textSubtle },
  catChipTextActive: { color: colors.textInverse, fontWeight: '600' },

  toggleRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.borderSubtle, borderRadius: 8, padding: 12, marginBottom: 8,
  },
  toggleTextWrap: { flex: 1, paddingRight: 12 },
  toggleLabel: { color: colors.text, fontSize: 15 },
  toggleHint: { color: colors.textSubtle, fontSize: 12, lineHeight: 17, marginTop: 2 },
  trackOnlyReasonBlock: { marginTop: -4, marginBottom: 14 },
  trackOnlyReasonLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 10 },
  reasonChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  reasonChipActive: {
    borderColor: colors.successMuted,
    backgroundColor: colors.successMuted,
  },
  reasonChipText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  reasonChipTextActive: { color: colors.text },
  paymentSection: { backgroundColor: colors.borderSubtle, borderRadius: 8, padding: 12, marginBottom: 8 },
  sectionLabel: { fontSize: 12, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  receiptDetailsSection: { backgroundColor: colors.borderSubtle, borderRadius: 8, padding: 12, marginBottom: 8 },
  receiptDetailsHint: { color: colors.textSubtle, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  receiptDetailsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  receiptDetailField: { width: '31%', minWidth: 0 },
  receiptMetaRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  receiptMetaField: { flex: 1, minWidth: 0 },
  receiptTransactionField: { marginTop: 8 },
  methodRow: { flexDirection: 'row', gap: 6 },
  methodChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  methodChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  methodChipText: { fontSize: 14, color: colors.textSubtle },
  methodChipTextActive: { color: colors.textInverse, fontWeight: '600' },
  savedCardsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  savedCardChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  savedCardChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  savedCardChipText: { fontSize: 14, color: colors.textSubtle },
  savedCardChipTextActive: { color: colors.textInverse, fontWeight: '600' },
  savedCardsHint: { color: colors.textDisabled, fontSize: 11, marginTop: 8 },
  savedCardsMatchNote: { color: colors.info, fontSize: 11, marginTop: 6, lineHeight: 16 },
  savedCardUpdateBtn: { marginTop: 10, alignSelf: 'flex-end' },
  savedCardUpdateText: { color: colors.info, fontSize: 13, fontWeight: '600' },
  cardRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  cardInput: { backgroundColor: colors.surface, borderRadius: 8, padding: 10, color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.borderStrong },

  itemsSection: { backgroundColor: colors.borderSubtle, borderRadius: 8, padding: 12, marginBottom: 8 },
  itemReviewNotice: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  itemReviewNoticeWarning: { borderColor: colors.warning },
  itemReviewNoticeTitle: { color: colors.text, fontSize: 13, fontWeight: '600', marginBottom: 3 },
  itemReviewNoticeBody: { color: colors.textSubtle, fontSize: 12, lineHeight: 17 },
  truncatedItemsNote: { color: colors.warning, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  itemCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    marginBottom: 8,
    gap: 8,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemDescInput: { flex: 1, backgroundColor: colors.surface, borderRadius: 6, padding: 8, color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.borderStrong },
  itemMetricsRow: { flexDirection: 'row', gap: 8 },
  itemMetricField: { flex: 1, minWidth: 0 },
  itemMetricFieldWide: { flex: 1.3, minWidth: 0 },
  itemMetricLabel: { color: colors.textSubtle, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  itemMetricInput: { backgroundColor: colors.surface, borderRadius: 6, padding: 8, color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.borderStrong },
  removeItemBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  removeItemText: { color: colors.textSubtle, fontSize: 20, lineHeight: 22 },
  addItemRow: { paddingVertical: 6 },
  addItemText: { color: colors.textSubtle, fontSize: 14 },
  addItemsPrompt: { backgroundColor: colors.surfaceMuted, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 },
  addItemsPromptTitle: { color: colors.text, fontSize: 13, fontWeight: '600', marginBottom: 2 },
  addItemsPromptBody: { color: colors.textSubtle, fontSize: 12, lineHeight: 17 },

  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  discard: { flex: 1, backgroundColor: colors.borderSubtle, borderRadius: 10, padding: 16, alignItems: 'center' },
  discardText: { color: colors.textSubtle, fontSize: 15 },
  confirm: { flex: 2, backgroundColor: colors.accent, borderRadius: 10, padding: 16, alignItems: 'center' },
  confirmDisabled: { opacity: 0.5 },
  confirmText: { color: colors.textInverse, fontSize: 15, fontWeight: '700' },
});
