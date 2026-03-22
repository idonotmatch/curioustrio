import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import { Ionicons } from '@expo/vector-icons';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { useExpenses } from '../../hooks/useExpenses';
import { useBudget } from '../../hooks/useBudget';
import { api } from '../../services/api';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDate(dateStr) {
  if (!dateStr) return '';
  const clean = dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00';
  const date = new Date(clean);
  if (isNaN(date)) return dateStr;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
}

export default function SummaryScreen() {
  const router = useRouter();
  const { expenses, refresh: refreshExpenses } = useExpenses();
  const { budget, refresh: refreshBudget } = useBudget();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Refresh data when tab gains focus
  useFocusEffect(useCallback(() => {
    refreshExpenses();
    refreshBudget();
  }, [refreshExpenses, refreshBudget]));

  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const monthlyExpenses = (expenses || []).filter(e => {
    const d = e.date ? String(e.date) : '';
    return d.slice(0, 7) === currentMonth;
  });
  const spent = monthlyExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const limit = budget?.total?.limit ?? 0;
  const pct = limit ? Math.min(spent / limit, 1) : 0;
  const over = limit && spent > limit;

  const hLimit = budget?.total?.limit ?? 0;
  const hSpent = budget?.total?.spent ?? 0;
  const hPct = hLimit ? Math.min(hSpent / hLimit, 1) : 0;
  const hOver = hLimit && hSpent > hLimit;
  const showHousehold = hLimit > 0;
  const byParent = budget?.by_parent || [];
  const recent = (expenses || []).slice(0, 5);

  async function handleQuickAdd() {
    if (!input.trim()) return;
    try {
      setLoading(true);
      const today = new Date().toISOString().split('T')[0];
      const parsed = await api.post('/expenses/parse', { input: input.trim(), today });
      setInput('');
      router.push({ pathname: '/confirm', params: { data: JSON.stringify({ ...parsed, source: 'manual' }) } });
    } catch {
      Alert.alert("Couldn't parse", "Try: '84.50 trader joes' or 'lunch 14'");
    } finally {
      setLoading(false);
    }
  }

  async function deleteExpense(id) {
    try {
      await api.delete(`/expenses/${id}`);
      refreshExpenses();
      refreshBudget();
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not delete expense');
    }
  }

  function renderDeleteAction(id) {
    return (
      <TouchableOpacity
        style={styles.deleteAction}
        onPress={() => Alert.alert('Delete expense', 'This cannot be undone.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => deleteExpense(id) },
        ])}
      >
        <Ionicons name="trash-outline" size={18} color="#fff" />
        <Text style={styles.deleteActionText}>Delete</Text>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Spend vs Budget */}
      <View style={styles.spendCard}>
        <Text style={styles.spendMonth}>{MONTH_NAMES[now.getMonth()]} {now.getFullYear()}</Text>

        <View style={styles.spendNumbers}>
          <View>
            <Text style={styles.spendLabel}>spent</Text>
            <Text style={[styles.spendAmount, over && styles.spendOver]}>${spent.toFixed(0)}</Text>
          </View>
          {limit > 0 && (
            <View style={styles.spendRight}>
              <Text style={styles.spendLabel}>budget</Text>
              <Text style={styles.budgetAmount}>${limit.toFixed(0)}</Text>
            </View>
          )}
        </View>

        {limit > 0 && (
          <>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: over ? '#ef4444' : '#4ade80' }]} />
            </View>
            <Text style={styles.barLabel}>
              {over
                ? `$${(spent - limit).toFixed(0)} over budget`
                : `$${(limit - spent).toFixed(0)} left · ${Math.round(pct * 100)}% used`}
            </Text>
          </>
        )}

        {!limit && (
          <TouchableOpacity onPress={() => router.push('/(tabs)/settings')}>
            <Text style={styles.setBudgetLink}>Set a monthly budget →</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Household budget — secondary */}
      {showHousehold && (
        <View style={styles.householdCard}>
          <View style={styles.householdRow}>
            <Text style={styles.householdLabel}>Household</Text>
            <View style={styles.householdNumbers}>
              <Text style={[styles.householdSpent, hOver && styles.householdOver]}>${hSpent.toFixed(0)}</Text>
              <Text style={styles.householdLimit}> / ${hLimit.toFixed(0)}</Text>
            </View>
          </View>
          <View style={styles.hBarTrack}>
            <View style={[styles.hBarFill, { width: `${hPct * 100}%`, backgroundColor: hOver ? '#ef4444' : '#4ade80' }]} />
          </View>
          <Text style={styles.hBarLabel}>
            {hOver
              ? `$${(hSpent - hLimit).toFixed(0)} over household budget`
              : `$${(hLimit - hSpent).toFixed(0)} remaining`}
          </Text>
          {byParent.length > 0 && (
            <View style={styles.byParentSection}>
              {byParent
                .filter(g => Number(g.spent) > 0 || g.limit)
                .map(g => {
                  const pSpent = parseFloat(g.spent) || 0;
                  const pLimit = g.limit ? parseFloat(g.limit) : null;
                  const pProgress = pLimit ? Math.min(pSpent / pLimit, 1) : 0;
                  const pIsOver = pLimit && pSpent > pLimit;
                  return (
                    <View key={g.group_id} style={styles.parentRow}>
                      <View style={styles.parentRowTop}>
                        <Text style={styles.parentName}>{g.name}</Text>
                        <Text style={styles.parentSpend}>
                          ${pSpent.toFixed(0)}{pLimit !== null ? ` / $${pLimit.toFixed(0)}` : ''}
                        </Text>
                      </View>
                      {pLimit !== null && (
                        <View style={styles.miniBarBg}>
                          <View style={[styles.miniBarFill, { width: `${pProgress * 100}%`, backgroundColor: pIsOver ? '#ef4444' : '#4ade80' }]} />
                        </View>
                      )}
                    </View>
                  );
                })}
            </View>
          )}
        </View>
      )}

      {/* Quick Add */}
      <View style={styles.quickAdd}>
        <Text style={styles.sectionLabel}>Quick add</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="84.50 trader joes · lunch 14 · gas 60 yesterday"
            placeholderTextColor="#333"
            onSubmitEditing={handleQuickAdd}
            autoCorrect={false}
            returnKeyType="done"
            editable={!loading}
          />
          <TouchableOpacity style={styles.addBtn} onPress={handleQuickAdd} disabled={loading || !input.trim()}>
            {loading
              ? <ActivityIndicator color="#000" size="small" />
              : <Ionicons name="arrow-forward" size={18} color="#000" />}
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.scanLink} onPress={() => router.push('/(tabs)/add')}>
          <Ionicons name="camera-outline" size={14} color="#444" />
          <Text style={styles.scanLinkText}>scan a receipt</Text>
        </TouchableOpacity>
      </View>

      {/* Recent — swipe left to delete */}
      {recent.length > 0 && (
        <View style={styles.recent}>
          <View style={styles.recentHeader}>
            <Text style={styles.sectionLabel}>Recent · Mine</Text>
            <TouchableOpacity onPress={() => router.navigate('/')}>
              <Text style={styles.seeAll}>See all</Text>
            </TouchableOpacity>
          </View>
          {recent.map(e => (
            <Swipeable
              key={e.id}
              renderRightActions={() => renderDeleteAction(e.id)}
              overshootRight={false}
            >
              <TouchableOpacity
                style={styles.recentRow}
                onPress={() => router.push(`/expense/${e.id}`)}
              >
                <Text style={styles.recentMerchant} numberOfLines={1}>{e.merchant || e.description || '—'}</Text>
                <Text style={styles.recentDate}>{formatDate(e.date)}</Text>
                <Text style={[styles.recentAmount, Number(e.amount) < 0 && styles.recentRefund]}>
                  {Number(e.amount) < 0 ? '−' : ''}${Math.abs(Number(e.amount)).toFixed(2)}
                </Text>
              </TouchableOpacity>
            </Swipeable>
          ))}
        </View>
      )}
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0a0a0a' },
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingTop: 16, paddingBottom: 48 },

  spendCard: { marginBottom: 32 },
  spendMonth: { fontSize: 12, color: '#444', letterSpacing: 0.5, marginBottom: 12 },
  spendNumbers: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 },
  spendLabel: { fontSize: 11, color: '#444', marginBottom: 2 },
  spendAmount: { fontSize: 48, color: '#f5f5f5', fontWeight: '600', letterSpacing: -2 },
  spendOver: { color: '#ef4444' },
  spendRight: { alignItems: 'flex-end' },
  budgetAmount: { fontSize: 22, color: '#555', fontWeight: '500', letterSpacing: -0.5 },
  barTrack: { height: 2, backgroundColor: '#1f1f1f', borderRadius: 1, marginBottom: 8 },
  barFill: { height: 2, borderRadius: 1 },
  barLabel: { fontSize: 11, color: '#444' },
  setBudgetLink: { fontSize: 12, color: '#555', marginTop: 8 },

  householdCard: { marginBottom: 32, backgroundColor: '#111', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#1a1a1a' },
  householdRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  householdLabel: { fontSize: 11, color: '#444', textTransform: 'uppercase', letterSpacing: 0.5 },
  householdNumbers: { flexDirection: 'row', alignItems: 'baseline' },
  householdSpent: { fontSize: 18, color: '#f5f5f5', fontWeight: '600', letterSpacing: -0.5 },
  householdOver: { color: '#ef4444' },
  householdLimit: { fontSize: 13, color: '#444' },
  hBarTrack: { height: 2, backgroundColor: '#1f1f1f', borderRadius: 1, marginBottom: 6 },
  hBarFill: { height: 2, borderRadius: 1 },
  hBarLabel: { fontSize: 11, color: '#444' },
  byParentSection: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#1f1f1f', paddingTop: 10 },
  parentRow: { marginBottom: 8 },
  parentRowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  parentName: { fontSize: 12, color: '#888' },
  parentSpend: { fontSize: 12, color: '#888' },
  miniBarBg: { height: 3, backgroundColor: '#222', borderRadius: 2, overflow: 'hidden' },
  miniBarFill: { height: 3, borderRadius: 2 },

  quickAdd: { marginBottom: 32 },
  sectionLabel: { fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
  inputRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1, backgroundColor: '#111', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 13,
    color: '#f5f5f5', fontSize: 14,
    borderWidth: 1, borderColor: '#1f1f1f',
  },
  addBtn: {
    backgroundColor: '#f5f5f5', borderRadius: 10,
    width: 46, justifyContent: 'center', alignItems: 'center',
  },
  scanLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  scanLinkText: { fontSize: 12, color: '#444' },

  recent: {},
  recentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  seeAll: { fontSize: 12, color: '#555' },
  recentRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#111',
    backgroundColor: '#0a0a0a',
  },
  recentMerchant: { flex: 1, fontSize: 14, color: '#f5f5f5', fontWeight: '500' },
  recentDate: { fontSize: 12, color: '#444', marginRight: 16 },
  recentAmount: { fontSize: 14, color: '#f5f5f5', fontWeight: '600', minWidth: 60, textAlign: 'right' },
  recentRefund: { color: '#4ade80' },

  deleteAction: {
    backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center',
    width: 80, borderBottomWidth: 1, borderBottomColor: '#111',
    flexDirection: 'column', gap: 2,
  },
  deleteActionText: { color: '#fff', fontSize: 11, fontWeight: '600' },
});
