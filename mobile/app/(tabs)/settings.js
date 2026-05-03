import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { useRecurring } from '../../hooks/useRecurring';
import { DismissKeyboardScrollView } from '../../components/DismissKeyboardScrollView';

export default function SettingsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const { recurring, loading: recurringLoading, refresh: refreshRecurring } = useRecurring();

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
    <DismissKeyboardScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      {params.welcome === 'budget' ? (
        <View style={styles.welcomeCard}>
          <Text style={styles.welcomeEyebrow}>Good first move</Text>
          <Text style={styles.welcomeTitle}>Pick a monthly budget.</Text>
          <Text style={styles.welcomeBody}>
            This gives Adlo something concrete to pace against before you have much history.
          </Text>
        </View>
      ) : null}

      {/* Budget */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>BUDGET</Text>
        <View style={styles.budgetRow}>
          <View style={styles.budgetRowLeft}>
            <Text style={styles.navRowText}>Monthly budget</Text>
          </View>
          <View style={styles.budgetRowRight}>
            <View style={styles.budgetInputShell}>
              <Text style={styles.budgetPrefix}>$</Text>
              <TextInput
                style={styles.budgetInput}
                value={budgetLimit}
                onChangeText={setBudgetLimit}
                placeholder="2000"
                placeholderTextColor="#555"
                keyboardType="numeric"
              />
            </View>
            <TouchableOpacity
              style={[styles.inlineSaveButton, budgetSaving && styles.buttonDisabled]}
              onPress={saveBudget}
              disabled={budgetSaving}
            >
              <Text style={styles.inlineSaveText}>{budgetSaving ? '...' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>

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
        <TouchableOpacity style={styles.navRow} onPress={() => router.push('/gmail-import')}>
          <Text style={styles.navRowText}>Manage Gmail import</Text>
          <Ionicons name="chevron-forward" size={16} color="#888" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.navRow} onPress={() => router.push('/payment-methods')}>
          <Text style={styles.navRowText}>Saved card labels</Text>
          <Ionicons name="chevron-forward" size={16} color="#888" />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>NOTIFICATIONS</Text>
        <TouchableOpacity style={styles.navRow} onPress={() => router.push('/notifications')}>
          <View>
            <Text style={styles.navRowText}>Manage notifications</Text>
            <Text style={styles.navRowSub}>Choose which nudges are worth interrupting you for</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#888" />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>INSIGHTS</Text>
        <TouchableOpacity style={styles.navRow} onPress={() => router.push('/insight-diagnostics')}>
          <View>
            <Text style={styles.navRowText}>Insight diagnostics</Text>
            <Text style={styles.navRowSub}>See whether Adlo has surfaced anything, or whether nothing is eligible right now</Text>
          </View>
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

    </DismissKeyboardScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 40 },
  welcomeCard: {
    marginBottom: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#121212',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#202020',
  },
  welcomeEyebrow: {
    color: '#7b7b7b',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  welcomeTitle: { color: '#f5f5f5', fontSize: 21, fontWeight: '700', marginBottom: 8 },
  welcomeBody: { color: '#9a9a9a', fontSize: 14, lineHeight: 20 },
  section: { marginBottom: 32, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', paddingBottom: 24 },
  sectionTitle: { fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  subText: { color: '#666', fontSize: 13, marginBottom: 12 },
  budgetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  budgetRowLeft: { flex: 1, paddingRight: 4 },
  budgetRowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  budgetInputShell: { width: 124, flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 10, paddingHorizontal: 12, minHeight: 42 },
  budgetPrefix: { color: '#666', fontSize: 16, marginRight: 4 },
  budgetInput: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '600', paddingVertical: 8 },
  inlineSaveButton: { minHeight: 42, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#f5f5f5', alignItems: 'center', justifyContent: 'center' },
  inlineSaveText: { color: '#0a0a0a', fontSize: 14, fontWeight: '600' },
  buttonDisabled: { opacity: 0.5 },
  msgText: { color: '#bbb', fontSize: 13, marginTop: 10 },
  msgError: { color: '#ef4444', fontSize: 13, marginTop: 10 },

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
