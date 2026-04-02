import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { useRecurring } from '../../hooks/useRecurring';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useMonth, currentPeriod } from '../../contexts/MonthContext';
import { invalidateCache } from '../../services/cache';

const DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => i + 1);

function ordinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { recurring, loading: recurringLoading, refresh: refreshRecurring } = useRecurring();
  const { user } = useCurrentUser();
  const { setStartDay, setSelectedMonth } = useMonth();

  const [budgetLimit, setBudgetLimit] = useState('');
  const [currentBudget, setCurrentBudget] = useState(null);
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetMsg, setBudgetMsg] = useState('');
  const [budgetMsgIsError, setBudgetMsgIsError] = useState(false);
  const [pendingSuggestionsCount, setPendingSuggestionsCount] = useState(0);

  // Budget period state — local selection before saving
  const [periodType, setPeriodType] = useState('calendar'); // 'calendar' | 'custom'
  const [customDay, setCustomDay] = useState(1);
  const [periodSaving, setPeriodSaving] = useState(false);
  const [showDayPicker, setShowDayPicker] = useState(false);

  // Seed period state from loaded user
  useEffect(() => {
    if (user) {
      const day = user.budget_start_day || 1;
      setPeriodType(day === 1 ? 'calendar' : 'custom');
      setCustomDay(day === 1 ? 15 : day); // default custom suggestion to 15th
    }
  }, [user?.budget_start_day]);

  const loadBudget = useCallback(async () => {
    try {
      const data = await api.get('/budgets?scope=personal');
      setCurrentBudget(data.total);
      if (data.total?.limit) setBudgetLimit(String(data.total.limit));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadBudget();
  }, [loadBudget]);

  useEffect(() => {
    api.get('/categories')
      .then(d => setPendingSuggestionsCount(d.pending_suggestions_count || 0))
      .catch(() => {});
  }, []);

  async function saveBudget() {
    const val = parseFloat(budgetLimit);
    if (!budgetLimit || isNaN(val) || val <= 0) {
      setBudgetMsg('Please enter a valid amount');
      setBudgetMsgIsError(true);
      return;
    }
    setBudgetSaving(true);
    setBudgetMsg('');
    try {
      await api.put('/budgets/total', { monthly_limit: val });
      setBudgetMsg('Saved!');
      setBudgetMsgIsError(false);
      loadBudget();
      setTimeout(() => setBudgetMsg(''), 2000);
    } catch (e) {
      setBudgetMsg(e.message || 'Failed to save');
      setBudgetMsgIsError(true);
    } finally {
      setBudgetSaving(false);
    }
  }

  async function savePeriod() {
    const day = periodType === 'calendar' ? 1 : customDay;
    setPeriodSaving(true);
    try {
      await api.patch('/users/settings', { budget_start_day: day });
      // Update MonthContext immediately
      setStartDay(day);
      setSelectedMonth(currentPeriod(day));
      // Invalidate budget + expense caches so next load reflects new period
      await invalidateCache('cache:current-user');
    } catch (e) {
      // silent — not worth blocking the UI
    } finally {
      setPeriodSaving(false);
    }
  }

  async function removeRecurring(id) {
    try {
      await api.delete(`/recurring/${id}`);
      refreshRecurring();
    } catch { /* ignore */ }
  }

  const currentDay = user?.budget_start_day || 1;
  const pendingDay = periodType === 'calendar' ? 1 : customDay;
  const periodChanged = pendingDay !== currentDay;

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>

      {/* Budget */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>BUDGET</Text>
        {currentBudget && (
          <Text style={styles.subText}>
            Current: ${Math.round(currentBudget.limit)}/mo · Spent: ${Math.round(currentBudget.spent)}
          </Text>
        )}
        <TextInput
          style={styles.input}
          value={budgetLimit}
          onChangeText={setBudgetLimit}
          placeholder="Monthly limit (e.g. 2000)"
          placeholderTextColor="#555"
          keyboardType="numeric"
        />
        <TouchableOpacity
          style={[styles.button, budgetSaving && styles.buttonDisabled]}
          onPress={saveBudget}
          disabled={budgetSaving}
        >
          <Text style={styles.buttonText}>{budgetSaving ? 'Saving...' : 'Save Budget'}</Text>
        </TouchableOpacity>
        {budgetMsg ? <Text style={budgetMsgIsError ? styles.msgError : styles.msgText}>{budgetMsg}</Text> : null}
      </View>

      {/* Budget Period */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>BUDGET PERIOD</Text>
        <Text style={styles.subText}>When does your budget reset each month?</Text>

        <TouchableOpacity
          style={[styles.optionRow, periodType === 'calendar' && styles.optionRowActive]}
          onPress={() => { setPeriodType('calendar'); setShowDayPicker(false); }}
          activeOpacity={0.7}
        >
          <View style={[styles.radio, periodType === 'calendar' && styles.radioActive]} />
          <Text style={styles.optionLabel}>Calendar month</Text>
          <Text style={styles.optionSub}>1st of each month</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.optionRow, periodType === 'custom' && styles.optionRowActive]}
          onPress={() => { setPeriodType('custom'); setShowDayPicker(true); }}
          activeOpacity={0.7}
        >
          <View style={[styles.radio, periodType === 'custom' && styles.radioActive]} />
          <Text style={styles.optionLabel}>Custom day</Text>
          {periodType === 'custom' ? (
            <TouchableOpacity onPress={() => setShowDayPicker(s => !s)} style={styles.dayChip}>
              <Text style={styles.dayChipText}>{ordinal(customDay)}</Text>
              <Ionicons name={showDayPicker ? 'chevron-up' : 'chevron-down'} size={12} color="#888" />
            </TouchableOpacity>
          ) : (
            <Text style={styles.optionSub}>pick a day</Text>
          )}
        </TouchableOpacity>

        {periodType === 'custom' && showDayPicker && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.dayPickerRow}
            contentContainerStyle={{ gap: 6, paddingVertical: 4 }}
          >
            {DAY_OPTIONS.map(d => (
              <TouchableOpacity
                key={d}
                style={[styles.dayOption, customDay === d && styles.dayOptionActive]}
                onPress={() => { setCustomDay(d); setShowDayPicker(false); }}
              >
                <Text style={[styles.dayOptionText, customDay === d && styles.dayOptionTextActive]}>{d}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {periodChanged && (
          <TouchableOpacity
            style={[styles.button, styles.buttonSmall, periodSaving && styles.buttonDisabled]}
            onPress={savePeriod}
            disabled={periodSaving}
          >
            <Text style={styles.buttonText}>{periodSaving ? 'Saving...' : 'Save Period'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Recurring — list only, no manual detect button */}
      {!recurringLoading && recurring.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>RECURRING EXPENSES</Text>
          {recurring.map(item => (
            <View key={item.id} style={styles.row}>
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle}>{item.merchant}</Text>
                <Text style={styles.rowSub}>
                  ${parseFloat(item.expected_amount).toFixed(2)} · {item.frequency} · next {item.next_expected_date}
                </Text>
              </View>
              <TouchableOpacity onPress={() => removeRecurring(item.id)}>
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Accounts */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ACCOUNTS</Text>
        <TouchableOpacity style={styles.navRow} onPress={() => router.push('/accounts')}>
          <Text style={styles.navRowText}>Manage accounts</Text>
          <Ionicons name="chevron-forward" size={16} color="#888" />
        </TouchableOpacity>
      </View>

      {/* Categories */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>CATEGORIES</Text>
        <TouchableOpacity style={styles.navRow} onPress={() => router.push('/categories')}>
          <Text style={styles.navRowText}>Edit category details</Text>
          <View style={styles.navRowRight}>
            {pendingSuggestionsCount > 0 && <View style={styles.badge} />}
            <Ionicons name="chevron-forward" size={16} color="#888" />
          </View>
        </TouchableOpacity>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 40 },
  section: { marginBottom: 32, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', paddingBottom: 24 },
  sectionTitle: { fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  subText: { color: '#666', fontSize: 13, marginBottom: 12 },
  input: { backgroundColor: '#111', borderWidth: 1, borderColor: '#333', borderRadius: 8, color: '#fff', padding: 12, fontSize: 16, marginBottom: 10 },
  button: { backgroundColor: '#fff', borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  buttonSmall: { marginTop: 14 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#0a0a0a', fontWeight: '600', fontSize: 15 },
  msgText: { color: '#bbb', fontSize: 14, marginTop: 6, textAlign: 'center' },
  msgError: { color: '#ef4444', fontSize: 14, marginTop: 6, textAlign: 'center' },

  optionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: '#111' },
  optionRowActive: {},
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#444' },
  radioActive: { borderColor: '#f5f5f5', backgroundColor: '#f5f5f5' },
  optionLabel: { fontSize: 15, color: '#f5f5f5', flex: 1 },
  optionSub: { fontSize: 13, color: '#555' },
  dayChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1a1a1a', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  dayChipText: { fontSize: 13, color: '#f5f5f5', fontWeight: '500' },
  dayPickerRow: { marginTop: 8 },
  dayOption: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#222' },
  dayOptionActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  dayOptionText: { fontSize: 13, color: '#888' },
  dayOptionTextActive: { color: '#000', fontWeight: '600' },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  rowInfo: { flex: 1, marginRight: 12 },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '500' },
  rowSub: { color: '#999', fontSize: 14, marginTop: 2 },
  removeText: { color: '#e44', fontSize: 14 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  navRowText: { color: '#f5f5f5', fontSize: 15 },
  navRowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444' },
});
