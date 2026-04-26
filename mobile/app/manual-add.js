import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { DismissKeyboardScrollView } from '../components/DismissKeyboardScrollView';
import { LocationPicker } from '../components/LocationPicker';
import { useCategories } from '../hooks/useCategories';
import { createManualExpenseDraft } from '../services/manualExpenseDraft';
import { toLocalDateString } from '../services/date';
import { api } from '../services/api';
import { insertExpenseIntoCachedLists, patchExpenseInCachedLists, saveExpenseSnapshot } from '../services/expenseLocalStore';
import { invalidateCacheByPrefix } from '../services/cache';
import { getCoords } from '../services/locationService';
import {
  normalizeMerchant,
  selectSuggestedLocationCandidate,
  shouldSuggestLocationFromMerchant,
} from '../services/manualAddSuggestions';

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

function moneyInput(value = '') {
  return `${value || ''}`.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
}

export default function ManualAddScreen() {
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
  const [paymentMethod, setPaymentMethod] = useState(draft.payment_method || 'unknown');
  const [cardLabel, setCardLabel] = useState(draft.card_label || '');
  const [cardLast4, setCardLast4] = useState(draft.card_last4 || '');
  const [isPrivate, setIsPrivate] = useState(false);
  const [excludeFromBudget, setExcludeFromBudget] = useState(false);
  const [budgetExclusionReason, setBudgetExclusionReason] = useState(null);
  const [locationData, setLocationData] = useState(null);
  const [locationSource, setLocationSource] = useState('empty');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [suggestedLocation, setSuggestedLocation] = useState(null);
  const [suggestingLocation, setSuggestingLocation] = useState(false);
  const [dismissedMerchantSuggestion, setDismissedMerchantSuggestion] = useState('');
  const [lastSuggestedMerchant, setLastSuggestedMerchant] = useState('');
  const [saving, setSaving] = useState(false);

  const topCategories = categories.slice(0, 8);
  const selectedCategory = categories.find((category) => category.id === categoryId) || null;
  const filteredCategories = useMemo(() => {
    const query = categoryQuery.trim().toLowerCase();
    if (!query) return categories;
    return categories.filter((category) => `${category.name || ''}`.toLowerCase().includes(query));
  }, [categories, categoryQuery]);
  const canSave = Number(amount) > 0 && merchant.trim().length > 0 && !saving;

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

    if (normalizedMerchant === lastSuggestedMerchant && suggestedLocation) return undefined;

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

  function onDateChange(_, selectedDate) {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selectedDate) setDate(toLocalDateString(selectedDate));
  }

  function closeCategoryPicker() {
    setCategoryPickerOpen(false);
    setCategoryQuery('');
  }

  function selectCategory(nextCategoryId) {
    setCategoryId(nextCategoryId);
    closeCategoryPicker();
  }

  function acceptSuggestedLocation() {
    if (!suggestedLocation?.value) return;
    setLocationData(suggestedLocation.value);
    setLocationSource('merchant_suggestion');
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
    setLocationSource(nextLocation ? 'manual_search' : 'empty');
    setSuggestedLocation(null);
    setDismissedMerchantSuggestion('');
  }

  async function handleSave() {
    if (!Number(amount) || Number(amount) <= 0) {
      Alert.alert('Add an amount', 'Enter how much the expense was before saving.');
      return;
    }
    if (!merchant.trim()) {
      Alert.alert('Add a merchant or description', 'Give this expense a short name so it is easy to recognize later.');
      return;
    }
    if (excludeFromBudget && !budgetExclusionReason) {
      Alert.alert('Choose a reason', 'Pick why this should be tracked without counting against the budget.');
      return;
    }

    try {
      setSaving(true);
      const result = await api.post('/expenses/confirm', {
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
        payment_method: paymentMethod,
        card_last4: cardLast4.trim() || null,
        card_label: cardLabel.trim() || null,
        is_private: isPrivate,
        exclude_from_budget: excludeFromBudget,
        budget_exclusion_reason: excludeFromBudget ? budgetExclusionReason : null,
      });

      if (result?.expense?.id) {
        await saveExpenseSnapshot(result.expense);
        await insertExpenseIntoCachedLists(result.expense);
        await patchExpenseInCachedLists(result.expense);
      }

      await Promise.all([
        invalidateCacheByPrefix('cache:expenses:'),
        invalidateCacheByPrefix('cache:budget:'),
        invalidateCacheByPrefix('cache:household-expenses:'),
      ]);

      router.back();
    } catch (error) {
      Alert.alert('Could not save expense', error?.message || 'Something went wrong while saving this expense.');
    } finally {
      setSaving(false);
    }
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
              <Ionicons name="close" size={18} color="#f5f5f5" />
            </TouchableOpacity>
          </View>

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
              <Text style={styles.fieldLabel}>Location</Text>
              <LocationPicker onLocation={handleLocationChange} locationData={locationData} merchant={merchant} />
              {!locationData && suggestingLocation ? (
                <Text style={styles.locationSuggestionStatus}>Looking for a nearby match...</Text>
              ) : null}
              {!locationData && suggestedLocation?.value ? (
                <View style={styles.locationSuggestionCard}>
                  <View style={styles.locationSuggestionCopy}>
                    <Text style={styles.locationSuggestionEyebrow}>Suggested location</Text>
                    <Text style={styles.locationSuggestionTitle}>{suggestedLocation.value.place_name}</Text>
                    {suggestedLocation.value.address ? (
                      <Text style={styles.locationSuggestionBody}>{suggestedLocation.value.address}</Text>
                    ) : null}
                  </View>
                  <View style={styles.locationSuggestionActions}>
                    <TouchableOpacity style={styles.locationSuggestionDismiss} onPress={dismissSuggestedLocation}>
                      <Text style={styles.locationSuggestionDismissText}>Dismiss</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.locationSuggestionUse} onPress={acceptSuggestedLocation}>
                      <Text style={styles.locationSuggestionUseText}>Use this</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Amount</Text>
              <TextInput
                style={styles.primaryInput}
                value={amount}
                onChangeText={(value) => setAmount(moneyInput(value))}
                placeholder="62.05"
                placeholderTextColor="#555"
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
                placeholderTextColor="#555"
                autoCorrect={false}
              />
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Category</Text>
              <TouchableOpacity style={styles.selectorButton} onPress={() => setCategoryPickerOpen(true)} activeOpacity={0.82}>
                <Text style={styles.selectorButtonText} numberOfLines={1}>
                  {selectedCategory?.name || 'Choose a category'}
                </Text>
                <Ionicons name="chevron-forward" size={15} color="#8f8f8f" />
              </TouchableOpacity>
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
            onPress={() => setAdvancedOpen((value) => !value)}
            activeOpacity={0.82}
          >
            <View style={styles.expandCopy}>
              <Text style={styles.expandTitle}>More detail</Text>
              <Text style={styles.expandBody}>Payment, privacy, track-only, notes, and location.</Text>
            </View>
            <Ionicons name={advancedOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#9a9a9a" />
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
                      placeholderTextColor="#555"
                    />
                  </View>
                  <View style={[styles.fieldBlock, styles.rowField]}>
                    <Text style={styles.fieldLabel}>Last 4</Text>
                    <TextInput
                      style={styles.textInput}
                      value={cardLast4}
                      onChangeText={(value) => setCardLast4(value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="4242"
                      placeholderTextColor="#555"
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
                  placeholderTextColor="#555"
                  multiline
                />
              </View>
            </View>
          ) : null}

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={!canSave}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color="#000" size="small" />
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
              <TouchableOpacity style={styles.categoryModalClose} onPress={closeCategoryPicker}>
                <Ionicons name="close" size={18} color="#f5f5f5" />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.categorySearchInput}
              value={categoryQuery}
              onChangeText={setCategoryQuery}
              placeholder="Search categories"
              placeholderTextColor="#666"
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
                    <ActivityIndicator color="#f5f5f5" size="small" />
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
                          {active ? <Ionicons name="checkmark" size={18} color="#f5f5f5" /> : null}
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
  safeArea: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  screenBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetShell: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 12,
  },
  sheet: {
    flex: 1,
    backgroundColor: '#0d0d0e',
    borderWidth: 1,
    borderColor: '#202020',
    borderRadius: 24,
  },
  content: { padding: 18, paddingBottom: 42, gap: 14 },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#2f2f31',
    marginBottom: 14,
  },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  hero: { flex: 1, gap: 4 },
  eyebrow: { fontSize: 11, color: '#8a8a8a', textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 28, color: '#f5f5f5', fontWeight: '700', lineHeight: 32 },
  subtitle: { fontSize: 13, color: '#9c9c9c', lineHeight: 19, maxWidth: 320 },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#171717',
    borderWidth: 1,
    borderColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1c1c1c',
    borderRadius: 14,
    padding: 14,
    gap: 14,
  },
  sectionTitle: { fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1.1 },
  compactDateRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 2,
  },
  compactDateLabel: { color: '#7f7f7f', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  compactDateValue: { alignItems: 'flex-end', justifyContent: 'center' },
  compactDateText: { color: '#d7d7d7', fontSize: 14, fontWeight: '500' },
  fieldBlock: { gap: 6 },
  fieldLabel: { fontSize: 12, color: '#999', fontWeight: '600' },
  locationSuggestionStatus: { color: '#7d7d7d', fontSize: 12, lineHeight: 16, marginTop: 2 },
  locationSuggestionCard: {
    marginTop: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#262626',
    backgroundColor: '#151515',
    padding: 12,
    gap: 10,
  },
  locationSuggestionCopy: { gap: 3 },
  locationSuggestionEyebrow: { color: '#8a8a8a', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.9 },
  locationSuggestionTitle: { color: '#f4f4f4', fontSize: 14, fontWeight: '600' },
  locationSuggestionBody: { color: '#8f8f8f', fontSize: 12, lineHeight: 17 },
  locationSuggestionActions: { flexDirection: 'row', gap: 8 },
  locationSuggestionDismiss: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#101010',
  },
  locationSuggestionDismissText: { color: '#bebebe', fontSize: 12, fontWeight: '600' },
  locationSuggestionUse: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#f5f5f5',
  },
  locationSuggestionUseText: { color: '#000', fontSize: 12, fontWeight: '700' },
  primaryInput: {
    backgroundColor: '#181818',
    borderWidth: 1,
    borderColor: '#282828',
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 54,
    paddingVertical: 13,
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0,
  },
  textInput: {
    backgroundColor: '#181818',
    borderWidth: 1,
    borderColor: '#282828',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: '#fff',
    fontSize: 15,
  },
  notesInput: { minHeight: 88, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10 },
  rowField: { flex: 1 },
  dateButton: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  dateButtonText: { color: '#d7d7d7', fontSize: 14, fontWeight: '500' },
  selectorButton: {
    backgroundColor: '#181818',
    borderWidth: 1,
    borderColor: '#282828',
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 54,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  selectorButtonText: { color: '#f5f5f5', fontSize: 15, flex: 1 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#181818',
    paddingHorizontal: 12,
    paddingVertical: 9,
    maxWidth: '100%',
  },
  categoryChipActive: {
    backgroundColor: '#f5f5f5',
    borderColor: '#f5f5f5',
  },
  categoryChipText: { color: '#cfcfcf', fontSize: 13, fontWeight: '600' },
  categoryChipTextActive: { color: '#000' },
  expandToggle: {
    backgroundColor: '#101113',
    borderWidth: 1,
    borderColor: '#1b1d20',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  expandCopy: { flex: 1, gap: 4 },
  expandTitle: { color: '#f5f5f5', fontSize: 15, fontWeight: '600' },
  expandBody: { color: '#8f8f8f', fontSize: 13, lineHeight: 18 },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segmentChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#181818',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  segmentChipActive: {
    backgroundColor: '#f5f5f5',
    borderColor: '#f5f5f5',
  },
  segmentChipText: { color: '#cfcfcf', fontSize: 13, fontWeight: '600' },
  segmentChipTextActive: { color: '#000' },
  toggleBlock: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  toggleCopy: { flex: 1, gap: 3 },
  toggleTitle: { color: '#f5f5f5', fontSize: 15, fontWeight: '600' },
  toggleBody: { color: '#8f8f8f', fontSize: 13, lineHeight: 18 },
  footer: { paddingTop: 4 },
  saveButton: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: { opacity: 0.45 },
  saveButtonText: { color: '#000', fontSize: 15, fontWeight: '700' },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  categoryModalShell: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  categoryModal: {
    maxHeight: '84%',
    backgroundColor: '#0f0f10',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#202020',
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
  categoryModalEyebrow: { color: '#8a8a8a', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  categoryModalTitle: { color: '#f5f5f5', fontSize: 22, fontWeight: '700' },
  categoryModalClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#171717',
    borderWidth: 1,
    borderColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categorySearchInput: {
    backgroundColor: '#181818',
    borderWidth: 1,
    borderColor: '#282828',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: '#fff',
    fontSize: 15,
  },
  categoryModalScroll: { flexGrow: 0 },
  categoryModalContent: { paddingBottom: 8, gap: 18 },
  categorySection: { gap: 10 },
  categorySectionTitle: { color: '#a0a0a0', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  categoryOptionCard: {
    minWidth: '47%',
    flexGrow: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#171717',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  categoryOptionCardActive: {
    backgroundColor: '#f5f5f5',
    borderColor: '#f5f5f5',
  },
  categoryOptionCardText: { color: '#d4d4d4', fontSize: 14, fontWeight: '600', lineHeight: 19 },
  categoryOptionCardTextActive: { color: '#000' },
  categoryList: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#202020',
    backgroundColor: '#151515',
    overflow: 'hidden',
  },
  categoryListRow: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#202020',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  categoryListText: { color: '#f1f1f1', fontSize: 15, flex: 1 },
  categoryEmptyText: { color: '#8f8f8f', fontSize: 13, lineHeight: 18 },
  categoryLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  categoryLoadingText: { color: '#bcbcbc', fontSize: 13 },
});
