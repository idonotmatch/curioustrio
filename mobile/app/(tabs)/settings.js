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

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { recurring, loading: recurringLoading, refresh: refreshRecurring } = useRecurring();
  const { user } = useCurrentUser();

  const [budgetLimit, setBudgetLimit] = useState('');
  const [currentBudget, setCurrentBudget] = useState(null);
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetMsg, setBudgetMsg] = useState('');
  const [budgetMsgIsError, setBudgetMsgIsError] = useState(false);
  const [pendingSuggestionsCount, setPendingSuggestionsCount] = useState(0);

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

  async function removeRecurring(id) {
    try {
      await api.delete(`/recurring/${id}`);
      refreshRecurring();
    } catch { /* ignore */ }
  }

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
        <TouchableOpacity style={styles.navRow} onPress={() => router.push('/budget-period')}>
          <View>
            <Text style={styles.navRowText}>Budget period</Text>
            <Text style={styles.navRowSub}>Manage your personal and household reset dates</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#888" />
        </TouchableOpacity>
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

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  rowInfo: { flex: 1, marginRight: 12 },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '500' },
  rowSub: { color: '#999', fontSize: 14, marginTop: 2 },
  removeText: { color: '#e44', fontSize: 14 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  navRowText: { color: '#f5f5f5', fontSize: 15 },
  navRowSub: { color: '#666', fontSize: 13, marginTop: 2 },
  navRowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444' },
});
