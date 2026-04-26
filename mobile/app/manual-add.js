import { useMemo, useState } from 'react';
import { Alert, Platform, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native';
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
  const { categories } = useCategories();
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState(draft.merchant || '');
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const topCategories = categories.slice(0, 10);
  const selectedCategory = categories.find((category) => category.id === categoryId) || null;
  const canSave = Number(amount) > 0 && merchant.trim().length > 0 && !saving;

  function onDateChange(_, selectedDate) {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selectedDate) setDate(toLocalDateString(selectedDate));
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
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <DismissKeyboardScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Manual add</Text>
          <Text style={styles.title}>Log it quickly</Text>
          <Text style={styles.subtitle}>Start with the few things you always care about. Add the rest only if it helps.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Core details</Text>

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Amount</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={(value) => setAmount(moneyInput(value))}
              placeholder="62.05"
              placeholderTextColor="#555"
              keyboardType="decimal-pad"
            />
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Merchant or description</Text>
            <TextInput
              style={styles.textInput}
              value={merchant}
              onChangeText={setMerchant}
              placeholder="Amazon, lunch, hair clips..."
              placeholderTextColor="#555"
              autoCorrect={false}
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.fieldBlock, styles.rowField]}>
              <Text style={styles.fieldLabel}>Date</Text>
              {Platform.OS === 'ios' ? (
                <DateTimePicker
                  value={new Date(`${date}T12:00:00`)}
                  mode="date"
                  display="compact"
                  maximumDate={new Date()}
                  onChange={onDateChange}
                  themeVariant="dark"
                />
              ) : (
                <TouchableOpacity style={styles.dateButton} onPress={() => setShowDatePicker(true)}>
                  <Text style={styles.dateButtonText}>{date}</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={[styles.fieldBlock, styles.rowField]}>
              <Text style={styles.fieldLabel}>Category</Text>
              <Text style={styles.selectedMeta} numberOfLines={1}>
                {selectedCategory?.name || 'Optional'}
              </Text>
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

          <View style={styles.chipWrap}>
            <TouchableOpacity
              style={[styles.categoryChip, !categoryId && styles.categoryChipActive]}
              onPress={() => setCategoryId(null)}
            >
              <Text style={[styles.categoryChipText, !categoryId && styles.categoryChipTextActive]}>Unassigned</Text>
            </TouchableOpacity>
            {topCategories.map((category) => {
              const active = category.id === categoryId;
              return (
                <TouchableOpacity
                  key={category.id}
                  style={[styles.categoryChip, active && styles.categoryChipActive]}
                  onPress={() => setCategoryId(category.id)}
                >
                  <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]} numberOfLines={1}>
                    {category.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

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

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Location</Text>
              <LocationPicker onLocation={setLocationData} locationData={locationData} merchant={merchant} />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0a0a0a' },
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 42, gap: 16 },
  hero: { gap: 6 },
  eyebrow: { fontSize: 11, color: '#8a8a8a', textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 30, color: '#f5f5f5', fontWeight: '700', lineHeight: 34 },
  subtitle: { fontSize: 14, color: '#a3a3a3', lineHeight: 20 },
  card: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1c1c1c',
    borderRadius: 14,
    padding: 14,
    gap: 14,
  },
  sectionTitle: { fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1.1 },
  fieldBlock: { gap: 6 },
  fieldLabel: { fontSize: 12, color: '#999', fontWeight: '600' },
  amountInput: {
    backgroundColor: '#181818',
    borderWidth: 1,
    borderColor: '#282828',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.6,
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
    backgroundColor: '#181818',
    borderWidth: 1,
    borderColor: '#282828',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  dateButtonText: { color: '#fff', fontSize: 15 },
  selectedMeta: { color: '#cfcfcf', fontSize: 15, lineHeight: 20 },
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
});
