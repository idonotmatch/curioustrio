import { View, Text, StyleSheet, TouchableOpacity, Alert, Switch, TextInput, ActivityIndicator, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import * as MediaLibrary from 'expo-media-library';
import DateTimePicker from '@react-native-community/datetimepicker';
import { getCoords } from '../services/locationService';
import { api } from '../services/api';
import { invalidateCache, invalidateCacheByPrefix } from '../services/cache';
import { saveExpenseSnapshot } from '../services/expenseLocalStore';
import { LocationPicker } from '../components/LocationPicker';
import { DismissKeyboardScrollView } from '../components/DismissKeyboardScrollView';
import { useCategories } from '../hooks/useCategories';
import { createManualExpenseDraft } from '../services/manualExpenseDraft';
import { toLocalDateString } from '../services/date';

function parseConfirmData(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function savedCardKey(card = {}) {
  return `${card.payment_method || ''}:${card.card_label || ''}:${card.card_last4 || ''}`;
}

export default function ConfirmScreen() {
  const { data } = useLocalSearchParams();
  const parsed = createManualExpenseDraft(parseConfirmData(data));
  const router = useRouter();
  const { categories, refresh: refreshCategories } = useCategories();
  const isWatchedPlanFlow = Boolean(parsed?.scenario_memory_id);
  const isManualScratchFlow = parsed?.source === 'manual' && !parsed?.merchant && !parsed?.description && !parsed?.scenario_memory_id;

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
  const [savedCards, setSavedCards] = useState([]);
  const [selectedSavedCardKey, setSelectedSavedCardKey] = useState(null);
  const [savedCardMatchNote, setSavedCardMatchNote] = useState(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [catSearch, setCatSearch] = useState('');
  const [catCreating, setCatCreating] = useState(false);
  const [catSuggestion, setCatSuggestion] = useState(null);
  const [catSuggestionLoading, setCatSuggestionLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [items, setItems] = useState(
    Array.isArray(parsed?.items) && parsed.items.length > 0
      ? parsed.items.map(it => ({
          ...it,
          description: it.description || '',
          amount: it.amount != null ? String(it.amount) : '',
        }))
      : []
  );
  const reviewFields = Array.isArray(expense?.review_fields) ? expense.review_fields : [];
  const hasReviewHint = reviewFields.length > 0;
  const fieldConfidence = expense?.field_confidence || {};

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
    if (parsed?.place_name || parsed?.address || parsed?.mapkit_stable_id) {
      setLocationData({
        place_name: parsed.place_name || merchant || '',
        address: parsed.address || null,
        mapkit_stable_id: parsed.mapkit_stable_id || null,
      });
    }
  }, []);

  useEffect(() => {
    if (selectedSavedCard && selectedSavedCard.payment_method !== paymentMethod) {
      setSelectedSavedCardKey(null);
    }
    if (paymentMethod === 'unknown') {
      setSavedCardMatchNote(null);
    }
  }, [paymentMethod, selectedSavedCard, selectedSavedCardKey]);

  useEffect(() => {
    if (!merchant?.trim()) return; // only auto-populate when merchant is known
    if (parsed?.place_name || parsed?.address || parsed?.mapkit_stable_id) return;

    async function autoPopulateLocation() {
      try {
        const coords = await getCoords();
        if (!coords) return;
        const { latitude, longitude } = coords;

        const result = await api.get(
          `/places/search?q=${encodeURIComponent(merchant)}&lat=${latitude}&lng=${longitude}`
        );
        if (result?.result) {
          setLocationData(result.result);
        }
      } catch {
        // Non-fatal — location stays unpopulated, user can add manually
      }
    }

    autoPopulateLocation();
  }, []); // run once on mount; merchant is captured from closure at parse time

  const isCameraSource = parsed.source === 'camera';
  const cardsForMethod = savedCards.filter(c => c.payment_method === paymentMethod);
  const selectedSavedCard = cardsForMethod.find(c => savedCardKey(c) === selectedSavedCardKey) || null;
  const canRenameSavedCard = Boolean(
    selectedSavedCard
      && ((cardLabel || '') !== (selectedSavedCard.card_label || '') || (cardLast4 || '') !== (selectedSavedCard.card_last4 || ''))
      && (cardLabel || cardLast4)
  );

  function handleItemChange(index, field, value) {
    setItems(prev => prev.map((it, i) => i === index ? { ...it, [field]: value } : it));
  }
  function handleAddItem() {
    setItems(prev => [...prev, { description: '', amount: '', upc: null, sku: null, brand: null, product_size: null, pack_size: null, unit: null }]);
  }
  function handleRemoveItem(index) {
    setItems(prev => prev.filter((_, i) => i !== index));
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

      if (isCameraSource && saveToRoll && parsed.image_uri) {
        try {
          const { status } = await MediaLibrary.requestPermissionsAsync();
          if (status === 'granted') {
            await MediaLibrary.saveToLibraryAsync(parsed.image_uri);
          }
        } catch (e) {
          // non-fatal
        }
      }

      const expenseMonth = (expense.date || toLocalDateString()).slice(0, 7);
      const result = await api.post('/expenses/confirm', {
        merchant: merchant.trim() || null,
        description: description.trim() || null,
        amount: expense.amount,
        date: expense.date,
        category_id: expense.category_id || null,
        source: isRefund ? 'refund' : (parsed?.source || 'manual'),
        notes: expense.notes,
        place_name: locationData?.place_name,
        address: locationData?.address,
        mapkit_stable_id: locationData?.mapkit_stable_id,
        payment_method: paymentMethod,
        card_last4: cardLast4 || null,
        card_label: cardLabel || null,
        is_private: isPrivate,
        ingest_attempt_id: parsed?.ingest_attempt_id || null,
        parsed_payment_snapshot: parsed?.parsed_payment_snapshot || {
          payment_method: parsed?.payment_method || null,
          card_label: parsed?.card_label || null,
          card_last4: parsed?.card_last4 || null,
        },
        original_parsed_items: parsed?.source === 'camera' && Array.isArray(parsed?.items)
          ? parsed.items.map((it) => ({
              description: it?.description || '',
              amount: it?.amount ?? null,
            }))
          : undefined,
        items: items.length > 0
          ? items
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
              }))
          : undefined,
      });
      if (result?.expense?.id) {
        await saveExpenseSnapshot(result.expense);
      }
      if (parsed?.scenario_memory_id) {
        try {
          await api.post(`/trends/scenario-memory/${parsed.scenario_memory_id}/resolve`, {
            action: 'bought',
            expense_id: result?.expense?.id || null,
          });
        } catch {
          // non-fatal
        }
      }
      await Promise.all([
        invalidateCache(`cache:expenses:${expenseMonth}`),
        invalidateCache(`cache:budget:${expenseMonth}:personal`),
        // Personal feeds are cache-first and keyed by budget period, which may
        // differ from the expense's calendar month when the user uses a custom
        // budget reset day. Clearing by prefix guarantees "Mine" refetches.
        invalidateCacheByPrefix('cache:expenses:'),
        invalidateCacheByPrefix('cache:budget:'),
        invalidateCacheByPrefix('cache:household-expenses:'),
      ]);
      if (isWatchedPlanFlow) {
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
      {isWatchedPlanFlow ? (
        <View style={styles.watchBanner}>
          <Text style={styles.watchBannerTitle}>Logging a watched plan</Text>
          <Text style={styles.watchBannerBody}>
            Once you save this expense, Adlo will mark the watched plan as bought.
          </Text>
        </View>
      ) : null}
      {hasReviewHint ? (
        <View style={styles.reviewBanner}>
          <Text style={styles.reviewBannerTitle}>Review before saving</Text>
          <Text style={styles.reviewBannerText}>
            Double-check {reviewFields.join(', ')}.
          </Text>
        </View>
      ) : null}
      {/* Merchant / Description — editable */}
      <View style={styles.editableGroup}>
        <View style={styles.editableRow}>
          <Text style={styles.editableLabel}>{merchant.trim() ? 'MERCHANT' : 'DETAILS'}</Text>
          <TextInput
            style={styles.editableInput}
            value={merchant.trim() ? merchant : description}
            onChangeText={merchant.trim() ? setMerchant : setDescription}
            placeholder={merchant.trim() ? 'Merchant name' : 'What was this for?'}
            placeholderTextColor="#444"
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
                placeholderTextColor="#444"
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
            placeholderTextColor="#444"
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
            <TouchableOpacity style={styles.dateButton} onPress={() => setShowDatePicker(true)}>
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

      {/* Category — tappable picker */}
      <View style={styles.editableGroup}>
        <TouchableOpacity
          style={styles.categoryRow}
          onPress={() => setShowCategoryPicker(!showCategoryPicker)}
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
              placeholderTextColor="#444"
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
                  ? <ActivityIndicator size="small" color="#000" />
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
                <ActivityIndicator size="small" color="#666" />
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

      <LocationPicker onLocation={setLocationData} locationData={locationData} merchant={merchant} />

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
          {reviewNote('items', 'Line items may be incomplete or approximate.')}
          {items.map((item, i) => (
            <View key={i} style={styles.itemRow}>
              <TextInput
                style={styles.itemDescInput}
                placeholder="Description"
                placeholderTextColor="#444"
                value={item.description}
                onChangeText={v => handleItemChange(i, 'description', v)}
              />
              <TextInput
                style={styles.itemAmountInput}
                placeholder="0.00"
                placeholderTextColor="#444"
                value={item.amount}
                onChangeText={v => handleItemChange(i, 'amount', v)}
                keyboardType="decimal-pad"
              />
              <TouchableOpacity onPress={() => handleRemoveItem(i)} style={styles.removeItemBtn}>
                <Text style={styles.removeItemText}>×</Text>
              </TouchableOpacity>
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
          trackColor={{ false: '#333', true: '#f97316' }}
          thumbColor={isRefund ? '#fff' : '#888'}
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
                placeholderTextColor="#444"
                value={cardLabel}
                onChangeText={setCardLabel}
              />
              <TextInput
                style={[styles.cardInput, { width: 64 }]}
                placeholder="last 4"
                placeholderTextColor="#444"
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
          trackColor={{ false: '#333', true: '#6366f1' }}
          thumbColor={isPrivate ? '#fff' : '#888'}
        />
      </View>

      {isCameraSource && (
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Save receipt to camera roll</Text>
          <Switch
            value={saveToRoll}
            onValueChange={setSaveToRoll}
            trackColor={{ false: '#333', true: '#fff' }}
            thumbColor={saveToRoll ? '#000' : '#888'}
          />
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.discard} onPress={() => router.back()}>
          <Text style={styles.discardText}>discard</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirm, saving && styles.confirmDisabled]}
          onPress={handleConfirm}
          disabled={saving}
        >
          <Text style={styles.confirmText}>{saving ? 'saving...' : 'confirm →'}</Text>
        </TouchableOpacity>
      </View>
    </DismissKeyboardScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20 },
  watchBanner: {
    backgroundColor: '#101521',
    borderWidth: 1,
    borderColor: '#22314a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  watchBannerTitle: { color: '#f5f5f5', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  watchBannerBody: { color: '#9db2cb', fontSize: 12, lineHeight: 17 },
  reviewBanner: {
    backgroundColor: '#171717',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  reviewBannerTitle: { color: '#f5f5f5', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  reviewBannerText: { color: '#888', fontSize: 12 },
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
    backgroundColor: '#241b0a',
    borderWidth: 1,
    borderColor: '#4a3412',
  },
  confidenceLow: {
    backgroundColor: '#2a1414',
    borderWidth: 1,
    borderColor: '#553030',
  },
  confidencePillText: {
    color: '#d8d8d8',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  confidenceHint: {
    flex: 1,
    color: '#6f6f6f',
    fontSize: 11,
  },

  editableRow: {
    backgroundColor: '#1a1a1a', borderRadius: 8, padding: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  editableLabel: { fontSize: 11, color: '#999', textTransform: 'uppercase', letterSpacing: 1, width: 92 },
  editableInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    textAlign: 'right',
    paddingHorizontal: 6,
    paddingVertical: 4,
    minHeight: 28,
  },
  confirmDatePicker: { marginRight: -2 },
  dateButton: { flex: 1, alignItems: 'flex-end', paddingHorizontal: 6, paddingVertical: 4, minHeight: 28, justifyContent: 'center' },
  dateButtonText: { color: '#fff', fontSize: 15, textAlign: 'right' },

  categoryRow: {
    backgroundColor: '#1a1a1a', borderRadius: 8, padding: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  categoryLabel: { fontSize: 11, color: '#999', textTransform: 'uppercase', letterSpacing: 1, width: 92 },
  categoryRight: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6, minHeight: 28, paddingLeft: 8 },
  categoryValue: { flexShrink: 1, fontSize: 15, color: '#fff', textAlign: 'right' },
  categoryChevron: { fontSize: 11, color: '#888' },
  categoryPicker: {
    backgroundColor: '#111', borderRadius: 8, padding: 10, marginBottom: 8, gap: 8,
  },
  catSearchRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  catSearchInput: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: '#f5f5f5', fontSize: 14, borderWidth: 1, borderColor: '#2a2a2a' },
  catCreateBtn: { backgroundColor: '#f5f5f5', borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center' },
  catCreateText: { color: '#000', fontSize: 14, fontWeight: '600' },
  catSuggestionRow: { minHeight: 18, justifyContent: 'center' },
  catSuggestionText: { color: '#777', fontSize: 12 },
  catChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  catChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  catChipActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  catChipText: { fontSize: 14, color: '#999' },
  catChipTextActive: { color: '#000', fontWeight: '600' },

  toggleRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1a1a1a', borderRadius: 8, padding: 12, marginBottom: 8,
  },
  toggleLabel: { color: '#fff', fontSize: 15 },
  paymentSection: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 12, marginBottom: 8 },
  sectionLabel: { fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  methodRow: { flexDirection: 'row', gap: 6 },
  methodChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: '#111', borderWidth: 1, borderColor: '#2a2a2a' },
  methodChipActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  methodChipText: { fontSize: 14, color: '#999' },
  methodChipTextActive: { color: '#000', fontWeight: '600' },
  savedCardsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  savedCardChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: '#111', borderWidth: 1, borderColor: '#2a2a2a' },
  savedCardChipActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  savedCardChipText: { fontSize: 14, color: '#999' },
  savedCardChipTextActive: { color: '#000', fontWeight: '600' },
  savedCardsHint: { color: '#666', fontSize: 11, marginTop: 8 },
  savedCardsMatchNote: { color: '#8ab4ff', fontSize: 11, marginTop: 6, lineHeight: 16 },
  savedCardUpdateBtn: { marginTop: 10, alignSelf: 'flex-end' },
  savedCardUpdateText: { color: '#8ab4ff', fontSize: 13, fontWeight: '600' },
  cardRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  cardInput: { backgroundColor: '#111', borderRadius: 8, padding: 10, color: '#f5f5f5', fontSize: 14, borderWidth: 1, borderColor: '#2a2a2a' },

  itemsSection: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 12, marginBottom: 8 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  itemDescInput: { flex: 1, backgroundColor: '#111', borderRadius: 6, padding: 8, color: '#f5f5f5', fontSize: 14, borderWidth: 1, borderColor: '#2a2a2a' },
  itemAmountInput: { width: 72, backgroundColor: '#111', borderRadius: 6, padding: 8, color: '#f5f5f5', fontSize: 14, borderWidth: 1, borderColor: '#2a2a2a' },
  removeItemBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  removeItemText: { color: '#999', fontSize: 20, lineHeight: 22 },
  addItemRow: { paddingVertical: 6 },
  addItemText: { color: '#999', fontSize: 14 },
  addItemsPrompt: { backgroundColor: '#151515', borderRadius: 8, borderWidth: 1, borderColor: '#242424', padding: 12, marginBottom: 8 },
  addItemsPromptTitle: { color: '#f5f5f5', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  addItemsPromptBody: { color: '#8b8b8b', fontSize: 12, lineHeight: 17 },

  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  discard: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 16, alignItems: 'center' },
  discardText: { color: '#999', fontSize: 15 },
  confirm: { flex: 2, backgroundColor: '#fff', borderRadius: 10, padding: 16, alignItems: 'center' },
  confirmDisabled: { opacity: 0.5 },
  confirmText: { color: '#000', fontSize: 15, fontWeight: '700' },
});
