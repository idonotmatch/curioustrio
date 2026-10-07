import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { DismissKeyboardScrollView } from '../components/DismissKeyboardScrollView';
import { LocationPicker } from '../components/LocationPicker';
import { SmartSuggestionCard } from '../components/SmartSuggestionCard';
import { ProvenanceSummary } from '../components/ProvenanceSummary';
import { useCategories } from '../hooks/useCategories';
import { createManualExpenseDraft } from '../services/manualExpenseDraft';
import { toLocalDateString } from '../services/date';
import { api } from '../services/api';
import { queueConfirmedExpenseClientWork } from '../services/confirmClientWork';
import { getCoords } from '../services/locationService';
import {
  normalizeMerchant,
  selectSuggestedCategoryCandidate,
  selectSuggestedLocationCandidate,
  shouldSuggestLocationFromMerchant,
} from '../services/manualAddSuggestions';
import { colors, radius } from '../theme/tokens';
import { sanitizeMoneyInput } from '../services/moneyInput';
import {
  createEditableExpenseItem,
  normalizeExpenseItemPayload,
  updateEditableExpenseItem,
} from '../services/itemEditing';
const { createExpenseIdempotencyKey } = require('../services/expenseIdempotency');
const { expenseDraftError } = require('../services/expenseValidation');

const TRACK_ONLY_REASONS = [
  { value: 'business', label: 'Business' },
  { value: 'reimbursable', label: 'Reimbursable' },
  { value: 'different_budget', label: 'Different budget' },
  { value: 'shared_not_mine', label: 'Shared, not mine' },
  { value: 'transfer_like', label: 'Transfer-like' },
  { value: 'other', label: 'Other' },
];

const PAYMENT_METHODS = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'credit', label: 'Credit' },
  { value: 'debit', label: 'Debit' },
  { value: 'cash', label: 'Cash' },
];

export default function ManualAddScreen() {
  const confirmRequestKeyRef = useRef(createExpenseIdempotencyKey('manual'));
  const router = useRouter();
  const draft = useMemo(() => createManualExpenseDraft(), []);
  const { categories, loading: categoriesLoading } = useCategories();
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState(draft.merchant || '');
  const [merchantEdited, setMerchantEdited] = useState(false);
  const [notes, setNotes] = useState(draft.notes || '');
  const [date, setDate] = useState(draft.date || toLocalDateString());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [categoryId, setCategoryId] = useState(draft.category_id || null);
  const [categoryEdited, setCategoryEdited] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(draft.payment_method || 'unknown');
  const [cardLabel, setCardLabel] = useState(draft.card_label || '');
  const [cardLast4, setCardLast4] = useState(draft.card_last4 || '');
  const [isPrivate, setIsPrivate] = useState(false);
  const [excludeFromBudget, setExcludeFromBudget] = useState(false);
  const [budgetExclusionReason, setBudgetExclusionReason] = useState(null);
  const [locationData, setLocationData] = useState(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [suggestedCategory, setSuggestedCategory] = useState(null);
  const [dismissedCategorySuggestionKey, setDismissedCategorySuggestionKey] = useState('');
  const [suggestedLocation, setSuggestedLocation] = useState(null);
  const [suggestingLocation, setSuggestingLocation] = useState(false);
  const [dismissedMerchantSuggestion, setDismissedMerchantSuggestion] = useState('');
  const [lastSuggestedMerchant, setLastSuggestedMerchant] = useState('');
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState([]);
  const [itemsOpen, setItemsOpen] = useState(false);

  const topCategories = categories.slice(0, 8);
  const selectedCategory = categories.find((category) => category.id === categoryId) || null;
  const filteredCategories = useMemo(() => {
    const query = categoryQuery.trim().toLowerCase();
    if (!query) return categories;
    return categories.filter((category) => `${category.name || ''}`.toLowerCase().includes(query));
  }, [categories, categoryQuery]);
  const canSave = Number(amount) > 0 && merchant.trim().length > 0 && !saving;
  const itemizedTotal = useMemo(() => items.reduce((sum, item) => {
    const value = Number.parseFloat(`${item.amount || ''}`);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0), [items]);
  const itemizedDifference = Number(amount) > 0 && items.length > 0
    ? Number(amount) - itemizedTotal
    : null;
  const saveHint = !Number(amount) || Number(amount) <= 0
    ? 'Add an amount to save this expense.'
    : !merchant.trim()
      ? 'Add a merchant or short description to save.'
      : excludeFromBudget && !budgetExclusionReason
        ? 'Choose why this should be tracked without counting toward budget.'
        : '';

  useEffect(() => {
    const placeName = `${locationData?.place_name || ''}`.trim();
    if (!placeName) return;
    if (!merchantEdited || !merchant.trim()) {
      setMerchant(placeName);
    }
  }, [locationData?.place_name, merchantEdited, merchant]);

  useEffect(() => {
    const normalizedMerchant = normalizeMerchant(merchant);
    if (!shouldSuggestLocationFromMerchant({
      merchant,
      hasAcceptedLocation: !!locationData,
      dismissedMerchantSuggestion,
    })) {
      setSuggestingLocation(false);
      setSuggestedLocation(null);
      return undefined;
    }

    if (normalizedMerchant === lastSuggestedMerchant) return undefined;

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setSuggestingLocation(true);
      try {
        let coords = null;
        try {
          coords = await getCoords();
        } catch {
          coords = null;
        }
        const params = new URLSearchParams({ q: merchant.trim() });
        params.set('intent', 'auto');
        if (coords?.latitude && coords?.longitude) {
          params.set('lat', String(coords.latitude));
          params.set('lng', String(coords.longitude));
        }
        const lookup = await api.get(`/places/search?${params.toString()}`);
        if (cancelled) return;
        const results = Array.isArray(lookup?.results)
          ? lookup.results
          : (lookup?.result ? [lookup.result] : []);
        const nextSuggestion = selectSuggestedLocationCandidate(merchant, results);
        setLastSuggestedMerchant(normalizedMerchant);
        setSuggestedLocation(nextSuggestion);
      } catch {
        if (!cancelled) setSuggestedLocation(null);
      } finally {
        if (!cancelled) setSuggestingLocation(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [merchant, locationData, dismissedMerchantSuggestion, lastSuggestedMerchant, suggestedLocation]);

  useEffect(() => {
    if (categoryEdited || categoryId) {
      setSuggestedCategory(null);
      return;
    }

    const suggestion = selectSuggestedCategoryCandidate({
      merchant,
      location: locationData,
      categories,
    });

    if (!suggestion || suggestion.key === dismissedCategorySuggestionKey) {
      setSuggestedCategory(null);
      return;
    }

    setSuggestedCategory(suggestion);
  }, [merchant, locationData, categories, categoryEdited, categoryId, dismissedCategorySuggestionKey]);

  function onDateChange(_, selectedDate) {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selectedDate) setDate(toLocalDateString(selectedDate));
  }

  function closeCategoryPicker() {
    setCategoryPickerOpen(false);
    setCategoryQuery('');
  }

  function selectCategory(nextCategoryId) {
    setCategoryEdited(true);
    setCategoryId(nextCategoryId);
    setSuggestedCategory(null);
    setDismissedCategorySuggestionKey('');
    closeCategoryPicker();
  }

  function acceptSuggestedLocation() {
    if (!suggestedLocation?.value) return;
    setLocationData({
      ...suggestedLocation.value,
      source: suggestedLocation.value.search_strategy === 'user_history' ? 'history' : 'merchant_suggestion',
      location_status: 'suggested',
      location_confidence: suggestedLocation.confidence,
      location_user_owned: true,
    });
    setSuggestedLocation(null);
    setDismissedMerchantSuggestion('');
  }

  function dismissSuggestedLocation() {
    setSuggestedLocation(null);
    setSuggestingLocation(false);
    setDismissedMerchantSuggestion(normalizeMerchant(merchant));
  }

  function handleLocationChange(nextLocation) {
    setLocationData(nextLocation);
    setSuggestedLocation(null);
    setDismissedMerchantSuggestion('');
  }

  function acceptSuggestedCategory() {
    if (!suggestedCategory?.value?.id) return;
    setCategoryId(suggestedCategory.value.id);
    setSuggestedCategory(null);
    setDismissedCategorySuggestionKey('');
  }

  function dismissSuggestedCategory() {
    setDismissedCategorySuggestionKey(suggestedCategory?.key || '');
    setSuggestedCategory(null);
  }

  async function handleSave() {
    const validationError = expenseDraftError({ merchant, amount, date });
    if (validationError) {
      Alert.alert('Check expense details', validationError);
      return;
    }
    if (excludeFromBudget && !budgetExclusionReason) {
      Alert.alert('Choose a reason', 'Pick why this should be tracked without counting against the budget.');
      return;
    }

    try {
      setSaving(true);
      const result = await api.post('/expenses/confirm', {
        idempotency_key: confirmRequestKeyRef.current,
        merchant: merchant.trim(),
        description: notes.trim() || null,
        amount: Number(amount),
        date,
        category_id: categoryId || null,
        source: 'manual',
        notes: notes.trim() || null,
        place_name: locationData?.place_name || null,
        address: locationData?.address || null,
        mapkit_stable_id: locationData?.mapkit_stable_id || null,
        location_provider_id: locationData?.provider_place_id || null,
        location_latitude: locationData?.latitude ?? null,
        location_longitude: locationData?.longitude ?? null,
        location_source: locationData?.source || null,
        location_status: locationData?.location_status || (locationData ? 'enriched' : 'missing'),
        location_confidence: locationData?.location_confidence ?? null,
        location_user_owned: Boolean(locationData?.location_user_owned || locationData),
        payment_method: paymentMethod,
        card_last4: cardLast4.trim() || null,
        card_label: cardLabel.trim() || null,
        is_private: isPrivate,
        exclude_from_budget: excludeFromBudget,
        budget_exclusion_reason: excludeFromBudget ? budgetExclusionReason : null,
        items: items
          .filter((item) => `${item.description || ''}`.trim())
          .map((item) => normalizeExpenseItemPayload({
            ...item,
            source_type: 'manual',
            extraction_confidence: 'high',
          })),
      });

      queueConfirmedExpenseClientWork({ expense: result?.expense || null });
      router.back();
    } catch (error) {
      Alert.alert('Could not save expense', error?.message || 'Something went wrong while saving this expense.');
    } finally {
      setSaving(false);
    }
  }

  function addItem() {
    setItemsOpen(true);
    setItems((current) => [...current, createEditableExpenseItem({
      description: '',
      quantity: 1,
      unit_price: null,
      amount: null,
    })]);
  }

  function updateItem(index, field, value) {
    setItems((current) => current.map((item, itemIndex) => (
      itemIndex === index ? updateEditableExpenseItem(item, field, value) : item
    )));
  }

  function removeItem(index) {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Pressable style={styles.screenBackdrop} onPress={() => router.back()} />
      <View style={styles.sheetShell}>
        <DismissKeyboardScrollView style={styles.sheet} contentContainerStyle={styles.content}>
          <View style={styles.grabber} />

          <View style={styles.heroRow}>
            <View style={styles.hero}>
              <Text style={styles.eyebrow}>Manual add</Text>
              <Text style={styles.title}>Log it quickly</Text>
              <Text style={styles.subtitle}>Start with the few things you always care about. Add the rest only if it helps.</Text>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Close manual add"
            >
              <Ionicons name="close" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ProvenanceSummary expense={{ source: 'manual' }} compact style={styles.provenanceBanner} />

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Core details</Text>

            <View style={styles.compactDateRow}>
              <Text style={styles.compactDateLabel}>Date</Text>
              {Platform.OS === 'ios' ? (
                <View style={styles.compactDateValue}>
                  <DateTimePicker
                    value={new Date(`${date}T12:00:00`)}
                    mode="date"
                    display="compact"
                    maximumDate={new Date()}
                    onChange={onDateChange}
                    themeVariant="dark"
                  />
                </View>
              ) : (
                <TouchableOpacity style={styles.compactDateValue} onPress={() => setShowDatePicker(true)}>
                  <Text style={styles.compactDateText}>{date}</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Amount</Text>
              <TextInput
                style={styles.primaryInput}
                value={amount}
                onChangeText={(value) => setAmount(sanitizeMoneyInput(value))}
                placeholder="62.05"
                placeholderTextColor={colors.textDisabled}
                keyboardType="decimal-pad"
              />
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Merchant</Text>
              <TextInput
                style={styles.primaryInput}
                value={merchant}
                onChangeText={(value) => {
                  setMerchantEdited(true);
                  setMerchant(value);
                }}
                placeholder="Amazon, lunch, hair clips..."
                placeholderTextColor={colors.textDisabled}
                autoCorrect
                spellCheck
                autoCapitalize="words"
                textContentType="organizationName"
              />
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Location</Text>
              <LocationPicker onLocation={handleLocationChange} locationData={locationData} merchant={merchant} />
              {!locationData && suggestingLocation ? (
                <Text style={styles.locationSuggestionStatus}>Looking for a nearby match...</Text>
              ) : null}
              {!locationData && suggestedLocation?.value ? (
                <SmartSuggestionCard
                  eyebrow="Suggested location"
                  title={suggestedLocation.value.place_name}
                  body={suggestedLocation.value.address || ''}
                  onDismiss={dismissSuggestedLocation}
                  onAccept={acceptSuggestedLocation}
                />
              ) : null}
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Category</Text>
              <TouchableOpacity style={styles.selectorButton} onPress={() => setCategoryPickerOpen(true)} activeOpacity={0.82}>
                <Text style={styles.selectorButtonText} numberOfLines={1}>
                  {selectedCategory?.name || 'Choose a category'}
                </Text>
                <Ionicons name="chevron-forward" size={15} color={colors.textSubtle} />
              </TouchableOpacity>
              {!categoryId && suggestedCategory?.value ? (
                <SmartSuggestionCard
                  eyebrow="Suggested category"
                  title={suggestedCategory.value.name}
                  body="Based on the merchant and place you entered."
                  onDismiss={dismissSuggestedCategory}
                  onAccept={acceptSuggestedCategory}
                />
              ) : null}
            </View>
          </View>

          {Platform.OS === 'android' && showDatePicker ? (
            <DateTimePicker
              value={new Date(`${date}T12:00:00`)}
              mode="date"
              display="default"
              maximumDate={new Date()}
              onChange={onDateChange}
            />
          ) : null}

          <TouchableOpacity
            style={styles.expandToggle}
            onPress={() => {
              if (items.length === 0) addItem();
              else setItemsOpen((value) => !value);
            }}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityLabel={itemsOpen ? 'Hide item breakdown' : 'Add or review item breakdown'}
            accessibilityState={{ expanded: itemsOpen }}
          >
            <View style={styles.expandCopy}>
              <Text style={styles.expandTitle}>{items.length > 0 ? `Items (${items.length})` : 'Add items'}</Text>
              <Text style={styles.expandBody}>Optional details for price history and planning.</Text>
            </View>
            <Ionicons name={itemsOpen ? 'chevron-up' : 'add'} size={17} color={colors.textSubtle} />
          </TouchableOpacity>

          {itemsOpen ? (
            <View style={styles.card}>
              <View style={styles.itemSectionHeader}>
                <Text style={styles.sectionTitle}>Item breakdown</Text>
                <TouchableOpacity style={styles.addItemButton} onPress={addItem} accessibilityRole="button" accessibilityLabel="Add item">
                  <Ionicons name="add" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>
              {items.map((item, index) => (
                <View key={item.observation_key || index} style={styles.itemBlock}>
                  <View style={styles.itemDescriptionRow}>
                    <TextInput
                      style={[styles.textInput, styles.itemDescriptionInput]}
                      value={item.description}
                      onChangeText={(value) => updateItem(index, 'description', value)}
                      placeholder="Item name"
                      placeholderTextColor={colors.textDisabled}
                      autoCorrect
                    />
                    <TouchableOpacity
                      style={styles.removeItemButton}
                      onPress={() => removeItem(index)}
                      accessibilityLabel="Remove item"
                      accessibilityRole="button"
                    >
                      <Ionicons name="trash-outline" size={17} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.itemMetricsRow}>
                    <View style={styles.itemMetricField}>
                      <Text style={styles.itemMetricLabel}>Qty</Text>
                      <TextInput
                        style={styles.itemMetricInput}
                        value={item.quantity}
                        onChangeText={(value) => updateItem(index, 'quantity', value)}
                        keyboardType="decimal-pad"
                        placeholder="1"
                        placeholderTextColor={colors.textDisabled}
                      />
                    </View>
                    <View style={styles.itemMetricField}>
                      <Text style={styles.itemMetricLabel}>Each</Text>
                      <TextInput
                        style={styles.itemMetricInput}
                        value={item.unit_price}
                        onChangeText={(value) => updateItem(index, 'unit_price', value)}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={colors.textDisabled}
                      />
                    </View>
                    <View style={styles.itemMetricField}>
                      <Text style={styles.itemMetricLabel}>Total</Text>
                      <TextInput
                        style={styles.itemMetricInput}
                        value={item.amount}
                        onChangeText={(value) => updateItem(index, 'amount', value)}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={colors.textDisabled}
                      />
                    </View>
                  </View>
                </View>
              ))}
              {items.length > 0 ? (
                <Text style={styles.itemizedSummary}>
                  Itemized ${itemizedTotal.toFixed(2)}
                  {itemizedDifference != null && Math.abs(itemizedDifference) >= 0.01
                    ? ` | $${Math.abs(itemizedDifference).toFixed(2)} ${itemizedDifference > 0 ? 'not itemized' : 'over total'}`
                    : ' | matches expense total'}
                </Text>
              ) : null}
            </View>
          ) : null}

          <TouchableOpacity
            style={styles.expandToggle}
            onPress={() => setAdvancedOpen((value) => !value)}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityLabel={advancedOpen ? 'Hide optional details' : 'Show optional details'}
            accessibilityState={{ expanded: advancedOpen }}
          >
            <View style={styles.expandCopy}>
              <Text style={styles.expandTitle}>More detail</Text>
              <Text style={styles.expandBody}>Payment, privacy, track-only, and notes.</Text>
            </View>
            <Ionicons name={advancedOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSubtle} />
          </TouchableOpacity>

          {advancedOpen ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Optional details</Text>

              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Payment method</Text>
                <View style={styles.segmentRow}>
                  {PAYMENT_METHODS.map((option) => {
                    const active = paymentMethod === option.value;
                    return (
                      <TouchableOpacity
                        key={option.value}
                        style={[styles.segmentChip, active && styles.segmentChipActive]}
                        onPress={() => setPaymentMethod(option.value)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: active }}
                      >
                        <Text style={[styles.segmentChipText, active && styles.segmentChipTextActive]}>{option.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {(paymentMethod === 'credit' || paymentMethod === 'debit') ? (
                <View style={styles.row}>
                  <View style={[styles.fieldBlock, styles.rowField]}>
                    <Text style={styles.fieldLabel}>Card label</Text>
                    <TextInput
                      style={styles.textInput}
                      value={cardLabel}
                      onChangeText={setCardLabel}
                      placeholder="Chase Sapphire"
                      placeholderTextColor={colors.textDisabled}
                    />
                  </View>
                  <View style={[styles.fieldBlock, styles.rowField]}>
                    <Text style={styles.fieldLabel}>Last 4</Text>
                    <TextInput
                      style={styles.textInput}
                      value={cardLast4}
                      onChangeText={(value) => setCardLast4(value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="4242"
                      placeholderTextColor={colors.textDisabled}
                      keyboardType="number-pad"
                    />
                  </View>
                </View>
              ) : null}

              <View style={styles.toggleBlock}>
                <View style={styles.toggleCopy}>
                  <Text style={styles.toggleTitle}>Private</Text>
                  <Text style={styles.toggleBody}>Hide this from shared household views.</Text>
                </View>
                <Switch value={isPrivate} onValueChange={setIsPrivate} />
              </View>

              <View style={styles.toggleBlock}>
                <View style={styles.toggleCopy}>
                  <Text style={styles.toggleTitle}>Track only</Text>
                  <Text style={styles.toggleBody}>Keep it in your history without counting it toward the budget.</Text>
                </View>
                <Switch
                  value={excludeFromBudget}
                  onValueChange={(value) => {
                    setExcludeFromBudget(value);
                    if (!value) setBudgetExclusionReason(null);
                    if (value && !budgetExclusionReason) setBudgetExclusionReason(TRACK_ONLY_REASONS[0].value);
                  }}
                />
              </View>

              {excludeFromBudget ? (
                <View style={styles.chipWrap}>
                  {TRACK_ONLY_REASONS.map((reason) => {
                    const active = budgetExclusionReason === reason.value;
                    return (
                      <TouchableOpacity
                        key={reason.value}
                        style={[styles.categoryChip, active && styles.categoryChipActive]}
                        onPress={() => setBudgetExclusionReason(reason.value)}
                      >
                        <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>{reason.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}

              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Notes</Text>
                <TextInput
                  style={[styles.textInput, styles.notesInput]}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Add context if it helps later"
                  placeholderTextColor={colors.textDisabled}
                  multiline
                />
              </View>
            </View>
          ) : null}

          <View style={styles.footer}>
            {saveHint ? <Text style={styles.saveHint}>{saveHint}</Text> : null}
            <TouchableOpacity
              style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={!canSave}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Save expense"
              accessibilityState={{ disabled: !canSave, busy: saving }}
            >
              {saving ? (
                <ActivityIndicator color={colors.textInverse} size="small" />
              ) : (
                <Text style={styles.saveButtonText}>Save expense</Text>
              )}
            </TouchableOpacity>
          </View>
        </DismissKeyboardScrollView>
      </View>

      <Modal
        visible={categoryPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={closeCategoryPicker}
      >
        <Pressable style={styles.modalBackdrop} onPress={closeCategoryPicker} />
        <SafeAreaView style={styles.categoryModalShell} edges={['bottom']}>
          <View style={styles.categoryModal}>
            <View style={styles.categoryModalHeader}>
              <View style={styles.categoryModalHeaderCopy}>
                <Text style={styles.categoryModalEyebrow}>Category</Text>
                <Text style={styles.categoryModalTitle}>Pick the closest fit</Text>
              </View>
              <TouchableOpacity style={styles.categoryModalClose} onPress={closeCategoryPicker} accessibilityRole="button" accessibilityLabel="Close category picker">
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.categorySearchInput}
              value={categoryQuery}
              onChangeText={setCategoryQuery}
              placeholder="Search categories"
              placeholderTextColor={colors.textDisabled}
              autoCorrect={false}
              autoCapitalize="none"
            />

            <ScrollView
              style={styles.categoryModalScroll}
              contentContainerStyle={styles.categoryModalContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.categorySection}>
                <Text style={styles.categorySectionTitle}>Common choices</Text>
                <View style={styles.categoryGrid}>
                  <TouchableOpacity
                    style={[styles.categoryOptionCard, !categoryId && styles.categoryOptionCardActive]}
                    onPress={() => selectCategory(null)}
                  >
                    <Text style={[styles.categoryOptionCardText, !categoryId && styles.categoryOptionCardTextActive]}>
                      Leave unassigned
                    </Text>
                  </TouchableOpacity>
                  {topCategories.map((category) => {
                    const active = category.id === categoryId;
                    return (
                      <TouchableOpacity
                        key={category.id}
                        style={[styles.categoryOptionCard, active && styles.categoryOptionCardActive]}
                        onPress={() => selectCategory(category.id)}
                      >
                        <Text style={[styles.categoryOptionCardText, active && styles.categoryOptionCardTextActive]} numberOfLines={2}>
                          {category.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.categorySection}>
                <Text style={styles.categorySectionTitle}>
                  {categoryQuery.trim() ? 'Search results' : 'All categories'}
                </Text>
                {categoriesLoading ? (
                  <View style={styles.categoryLoadingRow}>
                    <ActivityIndicator color={colors.text} size="small" />
                    <Text style={styles.categoryLoadingText}>Loading categories...</Text>
                  </View>
                ) : filteredCategories.length ? (
                  <View style={styles.categoryList}>
                    {filteredCategories.map((category) => {
                      const active = category.id === categoryId;
                      return (
                        <TouchableOpacity
                          key={category.id}
                          style={styles.categoryListRow}
                          onPress={() => selectCategory(category.id)}
                        >
                          <Text style={styles.categoryListText}>{category.name}</Text>
                          {active ? <Ionicons name="checkmark" size={18} color={colors.text} /> : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={styles.categoryEmptyText}>No categories matched that search.</Text>
                )}
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.overlaySoft },
  screenBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetShell: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 28,
    paddingBottom: 12,
  },
  sheet: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    maxHeight: '82%',
    minHeight: 420,
  },
  content: { padding: 18, paddingBottom: 32, gap: 14 },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.border,
    marginBottom: 14,
  },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  hero: { flex: 1, gap: 4 },
  eyebrow: { fontSize: 11, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 28, color: colors.text, fontWeight: '700', lineHeight: 32 },
  subtitle: { fontSize: 13, color: colors.textMuted, lineHeight: 19, maxWidth: 320 },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.lg,
    padding: 14,
    gap: 14,
  },
  sectionTitle: { fontSize: 12, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 1.1 },
  itemSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  addItemButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemBlock: { gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  itemDescriptionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemDescriptionInput: { flex: 1 },
  removeItemButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  itemMetricsRow: { flexDirection: 'row', gap: 8 },
  itemMetricField: { flex: 1, gap: 5, minWidth: 0 },
  itemMetricLabel: { color: colors.textSubtle, fontSize: 11, fontWeight: '600' },
  itemMetricInput: {
    minHeight: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  itemizedSummary: { color: colors.textSubtle, fontSize: 12, lineHeight: 17 },
  compactDateRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 2,
  },
  compactDateLabel: { color: colors.textSubtle, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  compactDateValue: { alignItems: 'flex-end', justifyContent: 'center' },
  compactDateText: { color: colors.textMuted, fontSize: 14, fontWeight: '500' },
  fieldBlock: { gap: 6 },
  fieldLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  locationSuggestionStatus: { color: colors.textSubtle, fontSize: 12, lineHeight: 16, marginTop: 2 },
  primaryInput: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    minHeight: 54,
    paddingVertical: 13,
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0,
  },
  textInput: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: colors.text,
    fontSize: 15,
  },
  notesInput: { minHeight: 88, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10 },
  rowField: { flex: 1 },
  dateButton: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  dateButtonText: { color: colors.textMuted, fontSize: 14, fontWeight: '500' },
  selectorButton: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    minHeight: 54,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  selectorButtonText: { color: colors.text, fontSize: 15, flex: 1 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    paddingVertical: 9,
    maxWidth: '100%',
  },
  categoryChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  categoryChipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  categoryChipTextActive: { color: colors.textInverse },
  expandToggle: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  expandCopy: { flex: 1, gap: 4 },
  expandTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  expandBody: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segmentChip: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  segmentChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  segmentChipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  segmentChipTextActive: { color: colors.textInverse },
  toggleBlock: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  toggleCopy: { flex: 1, gap: 3 },
  toggleTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  toggleBody: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  footer: { paddingTop: 4, gap: 8 },
  saveHint: { color: colors.textSubtle, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  saveButton: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: { opacity: 0.45 },
  saveButtonText: { color: colors.textInverse, fontSize: 15, fontWeight: '700' },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  categoryModalShell: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  categoryModal: {
    maxHeight: '84%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    gap: 14,
  },
  categoryModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  categoryModalHeaderCopy: { flex: 1, gap: 4 },
  categoryModalEyebrow: { color: colors.textSubtle, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  categoryModalTitle: { color: colors.text, fontSize: 22, fontWeight: '700' },
  categoryModalClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categorySearchInput: {
    backgroundColor: colors.surfacePressed,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: colors.text,
    fontSize: 15,
  },
  categoryModalScroll: { flexGrow: 0 },
  categoryModalContent: { paddingBottom: 8, gap: 18 },
  categorySection: { gap: 10 },
  categorySectionTitle: { color: colors.textMuted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  categoryOptionCard: {
    minWidth: '47%',
    flexGrow: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  categoryOptionCardActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  categoryOptionCardText: { color: colors.textMuted, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  categoryOptionCardTextActive: { color: colors.textInverse },
  categoryList: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  categoryListRow: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  categoryListText: { color: colors.text, fontSize: 15, flex: 1 },
  categoryEmptyText: { color: colors.textSubtle, fontSize: 13, lineHeight: 18 },
  categoryLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  categoryLoadingText: { color: colors.textMuted, fontSize: 13 },
  provenanceBanner: { marginBottom: 12 },
});
