import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Switch, TextInput, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import * as MediaLibrary from 'expo-media-library';
import { api } from '../services/api';
import { ConfirmField } from '../components/ConfirmField';
import { LocationPicker } from '../components/LocationPicker';
import { useCategories } from '../hooks/useCategories';

export default function ConfirmScreen() {
  const { data } = useLocalSearchParams();
  const parsed = JSON.parse(data);
  const router = useRouter();
  const { categories, refresh: refreshCategories } = useCategories();

  const [expense, setExpense] = useState(parsed);
  const [merchant, setMerchant] = useState(parsed.merchant || '');
  const [description, setDescription] = useState(parsed.description || '');
  const [saving, setSaving] = useState(false);
  const [locationData, setLocationData] = useState(null);
  const [saveToRoll, setSaveToRoll] = useState(false);
  const [isRefund, setIsRefund] = useState((parsed?.amount ?? 0) < 0);
  const [paymentMethod, setPaymentMethod] = useState(parsed.payment_method || 'unknown');
  const [cardLast4, setCardLast4] = useState('');
  const [cardLabel, setCardLabel] = useState(parsed.card_label || '');
  const [savedCards, setSavedCards] = useState([]);
  const [isPrivate, setIsPrivate] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [catSearch, setCatSearch] = useState('');
  const [catCreating, setCatCreating] = useState(false);
  const [items, setItems] = useState(
    Array.isArray(parsed?.items) && parsed.items.length > 0
      ? parsed.items.map(it => ({ description: it.description || '', amount: it.amount != null ? String(it.amount) : '' }))
      : []
  );

  useEffect(() => {
    api.get('/expenses/cards').then(setSavedCards).catch(() => {});
  }, []);

  const isCameraSource = parsed.source === 'camera';

  function handleItemChange(index, field, value) {
    setItems(prev => prev.map((it, i) => i === index ? { ...it, [field]: value } : it));
  }
  function handleAddItem() {
    setItems(prev => [...prev, { description: '', amount: '' }]);
  }
  function handleRemoveItem(index) {
    setItems(prev => prev.filter((_, i) => i !== index));
  }

  function handleRefundToggle(value) {
    setIsRefund(value);
    setExpense(prev => ({
      ...prev,
      amount: value ? -Math.abs(Number(prev.amount)) : Math.abs(Number(prev.amount)),
    }));
  }

  function selectCategory(cat) {
    setExpense(prev => ({ ...prev, category_id: cat?.id || null, category_name: cat?.name || null }));
    setCatSearch('');
    setShowCategoryPicker(false);
  }

  async function createAndSelectCategory() {
    const name = catSearch.trim();
    if (!name) return;
    setCatCreating(true);
    try {
      const newCat = await api.post('/categories/quick', { name });
      setExpense(prev => ({ ...prev, category_id: newCat.id, category_name: newCat.name }));
      setCatSearch('');
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

      await api.post('/expenses/confirm', {
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
        items: items.length > 0
          ? items
              .filter(it => it.description.trim())
              .map(it => ({ description: it.description.trim(), amount: it.amount ? parseFloat(it.amount) : null }))
          : undefined,
      });
      router.replace('/(tabs)');
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Merchant / Description — editable */}
      <View style={styles.editableRow}>
        <Text style={styles.editableLabel}>{merchant.trim() ? 'MERCHANT' : 'DESCRIPTION'}</Text>
        <TextInput
          style={styles.editableInput}
          value={merchant.trim() ? merchant : description}
          onChangeText={merchant.trim() ? setMerchant : setDescription}
          placeholder={merchant.trim() ? 'Merchant name' : 'What was this for?'}
          placeholderTextColor="#444"
        />
      </View>
      {/* If both merchant and description exist (e.g. from receipt scan), show both */}
      {merchant.trim() && description.trim() ? (
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
      ) : null}

      <ConfirmField label="Amount" value={`$${Number(expense.amount).toFixed(2)}`} />
      <ConfirmField label="Date" value={expense.date} />

      {/* Category — tappable picker */}
      <TouchableOpacity
        style={styles.categoryRow}
        onPress={() => setShowCategoryPicker(!showCategoryPicker)}
      >
        <Text style={styles.categoryLabel}>CATEGORY</Text>
        <View style={styles.categoryRight}>
          <Text style={styles.categoryValue}>{expense.category_name || 'Unassigned'}</Text>
          <Text style={styles.categoryChevron}>{showCategoryPicker ? '▲' : '▼'}</Text>
        </View>
      </TouchableOpacity>
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
                  : <Text style={styles.catCreateText}>+ Create</Text>}
              </TouchableOpacity>
            )}
          </View>
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

      <LocationPicker onLocation={setLocationData} locationData={locationData} />

      {(items.length > 0 || parsed?.source === 'camera' || parsed?.source === 'email') && (
        <View style={styles.itemsSection}>
          <Text style={styles.sectionLabel}>ITEMS</Text>
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
            {savedCards.filter(c => c.payment_method === paymentMethod).length > 0 && (
              <View style={styles.savedCardsRow}>
                {savedCards.filter(c => c.payment_method === paymentMethod).map((c, i) => {
                  const isSelected = cardLabel === (c.card_label || '') && cardLast4 === (c.card_last4 || '');
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[styles.savedCardChip, isSelected && styles.savedCardChipActive]}
                      onPress={() => {
                        setCardLabel(c.card_label || '');
                        setCardLast4(c.card_last4 || '');
                      }}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20 },

  editableRow: {
    backgroundColor: '#1a1a1a', borderRadius: 8, padding: 12,
    marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  editableLabel: { fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: 1, width: 80 },
  editableInput: { flex: 1, color: '#fff', fontSize: 15, textAlign: 'right', padding: 0 },

  categoryRow: {
    backgroundColor: '#1a1a1a', borderRadius: 8, padding: 12,
    marginBottom: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  categoryLabel: { fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: 1 },
  categoryRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  categoryValue: { fontSize: 15, color: '#fff' },
  categoryChevron: { fontSize: 11, color: '#888' },
  categoryPicker: {
    backgroundColor: '#111', borderRadius: 8, padding: 10, marginBottom: 8, gap: 8,
  },
  catSearchRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  catSearchInput: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: '#f5f5f5', fontSize: 14, borderWidth: 1, borderColor: '#2a2a2a' },
  catCreateBtn: { backgroundColor: '#f5f5f5', borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center' },
  catCreateText: { color: '#000', fontSize: 14, fontWeight: '600' },
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

  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  discard: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 16, alignItems: 'center' },
  discardText: { color: '#999', fontSize: 15 },
  confirm: { flex: 2, backgroundColor: '#fff', borderRadius: 10, padding: 16, alignItems: 'center' },
  confirmDisabled: { opacity: 0.5 },
  confirmText: { color: '#000', fontSize: 15, fontWeight: '700' },
});
