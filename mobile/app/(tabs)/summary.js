import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Modal, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useMonth, periodLabel, currentPeriod } from '../../contexts/MonthContext';
import { useState, useCallback, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { useExpenses } from '../../hooks/useExpenses';
import { useHouseholdExpenses } from '../../hooks/useHouseholdExpenses';
import { useBudget } from '../../hooks/useBudget';
import { useHousehold } from '../../hooks/useHousehold';
import { usePendingExpenses } from '../../hooks/usePendingExpenses';
import { useInsights } from '../../hooks/useInsights';
import { api } from '../../services/api';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function getPastMonths() {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const clean = dateStr.slice(0, 10) + 'T12:00:00';
  const date = new Date(clean);
  if (isNaN(date)) return dateStr;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
}

function formatRelativeTime(value) {
  if (!value) return null;
  const diffMs = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diffMs)) return null;
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function insightScopeLabel(insight) {
  if (insight?.metadata?.scope === 'personal') return 'You';
  if (insight?.metadata?.scope === 'household') return 'Household';
  return insight?.entity_type === 'item' ? 'Household' : 'You';
}

function buildMockInsights() {
  return [
    {
      id: 'mock:household-price-spike',
      title: 'Organic bananas cost more than usual',
      body: 'This trip came in 20% above your usual price, mostly from higher produce costs this week.',
      entity_type: 'item',
      metadata: { scope: 'household' },
    },
    {
      id: 'mock:personal-budget-fit',
      title: 'Your personal budget may be too low',
      body: 'You have been outpacing this budget in most recent periods, and this month is trending above your normal pace again.',
      entity_type: 'budget',
      metadata: { scope: 'personal' },
    },
    {
      id: 'mock:household-driver',
      title: 'Groceries are driving the difference',
      body: 'Groceries are running about $86 higher than your usual household pace so far this period.',
      entity_type: 'category',
      metadata: { scope: 'household' },
    },
  ];
}

export default function SummaryScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const { selectedMonth, setSelectedMonth, startDay } = useMonth();
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const { expenses, refresh: refreshExpenses } = useExpenses(selectedMonth);
  const { expenses: householdExpenses, refresh: refreshHouseholdExpenses } = useHouseholdExpenses(selectedMonth);
  const { budget: personalBudget, refresh: refreshPersonalBudget } = useBudget(selectedMonth, 'personal');
  const { budget: householdBudget, refresh: refreshHouseholdBudget } = useBudget(selectedMonth, 'household');
  const { household, memberCount } = useHousehold();
  const isMultiMember = memberCount > 1;
  const householdStartDay = household?.budget_start_day || 1;
  const { expenses: pendingExpenses, refresh: refreshPending } = usePendingExpenses();
  const { insights, refresh: refreshInsights, markSeen, dismiss: dismissInsight } = useInsights(3);
  const [dismissedMockInsightIds, setDismissedMockInsightIds] = useState([]);
  const [recentTab, setRecentTab] = useState('recent');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [gmailImportSummary, setGmailImportSummary] = useState(null);
  const displayInsights = __DEV__ && insights.length === 0
    ? buildMockInsights().filter((insight) => !dismissedMockInsightIds.includes(insight.id))
    : insights;
  const hasMultipleInsights = displayInsights.length > 1;
  const insightCardWidth = displayInsights.length <= 1
    ? Math.max(0, windowWidth - 40)
    : Math.max(280, windowWidth - 88);

  const loadGmailImportSummary = useCallback(async () => {
    try {
      const data = await api.get('/gmail/import-summary?days=30');
      setGmailImportSummary(data);
    } catch {
      setGmailImportSummary(null);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    refreshExpenses();
    refreshPersonalBudget();
    refreshHouseholdExpenses();
    refreshHouseholdBudget();
    refreshPending();
    loadGmailImportSummary();
    refreshInsights();
  }, [
    refreshExpenses,
    refreshPersonalBudget,
    refreshHouseholdExpenses,
    refreshHouseholdBudget,
    refreshPending,
    loadGmailImportSummary,
    refreshInsights,
  ]));

  useEffect(() => {
    if (recentTab === 'queue') loadGmailImportSummary();
  }, [recentTab, loadGmailImportSummary]);

  useEffect(() => {
    if (__DEV__ && insights.length === 0) return;
    const unseenIds = insights
      .filter((insight) => insight.state?.status !== 'seen')
      .map((insight) => insight.id);
    if (unseenIds.length) markSeen(unseenIds);
  }, [insights, markSeen]);

  function handleDismissInsight(id) {
    if (__DEV__ && insights.length === 0) {
      setDismissedMockInsightIds((current) => [...current, id]);
      return;
    }
    dismissInsight(id);
  }

  const spent = (expenses || []).reduce((s, e) => s + Number(e.amount), 0);
  const householdSpent = (householdExpenses || []).reduce((s, e) => s + Number(e.amount), 0);
  const selectedDate = new Date(selectedMonth + '-02');
  const currentMonthStr = currentPeriod(startDay);

  const limit = personalBudget?.total?.limit ?? 0;
  const pct = limit ? Math.min(spent / limit, 1) : 0;
  const over = limit && spent > limit;

  const hLimit = householdBudget?.total?.limit ?? 0;
  const hSpent = householdSpent;
  const hPct = hLimit ? Math.min(hSpent / hLimit, 1) : 0;
  const hOver = hLimit && hSpent > hLimit;
  const recent = (expenses || []).slice(0, 5);

  async function handleQuickAdd() {
    if (!input.trim()) return;
    try {
      setLoading(true);
      const today = new Date().toISOString().split('T')[0];
      const parsed = await api.post('/expenses/parse', { input: input.trim(), today });
      setInput('');
      router.push({ pathname: '/confirm', params: { data: JSON.stringify({ ...parsed, source: 'manual' }) } });
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('Could not parse')) {
        Alert.alert("Couldn't parse that", "Try: '84.50 trader joes' or 'lunch 14'");
      } else {
        Alert.alert('Error', msg || 'Something went wrong. Check your connection.');
      }
    } finally {
      setLoading(false);
    }
  }

  const [displayPending, setDisplayPending] = useState([]);
  useEffect(() => { setDisplayPending(pendingExpenses); }, [pendingExpenses]);
  const removePending = (id) => setDisplayPending(prev => prev.filter(e => e.id !== id));

  async function dismissPending(id) {
    try {
      await api.post(`/expenses/${id}/dismiss`);
      const { invalidateCache } = await import('../../services/cache');
      await invalidateCache('cache:expenses:pending');
      removePending(id);
    } catch { /* ignore */ }
  }

  async function approvePending(id) {
    try {
      await api.post(`/expenses/${id}/approve`);
      removePending(id);
      const { invalidateCache, invalidateCacheByPrefix } = await import('../../services/cache');
      await Promise.all([
        invalidateCache('cache:expenses:pending'),
        invalidateCacheByPrefix('cache:expenses:'),
        invalidateCacheByPrefix('cache:budget:'),
      ]);
      refreshExpenses();
      refreshPersonalBudget();
      refreshHouseholdBudget();
    } catch { /* ignore */ }
  }

  async function deleteExpense(id) {
    try {
      await api.delete(`/expenses/${id}`);
      refreshExpenses();
      refreshPersonalBudget();
      refreshHouseholdBudget();
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
      keyboardDismissMode="on-drag"
    >
      {/* Spend vs Budget */}
      <View style={styles.spendCard}>
        <TouchableOpacity onPress={() => setShowMonthPicker(true)} style={styles.spendMonthRow}>
          <Text style={styles.spendMonth}>
            {periodLabel(selectedMonth, startDay)}
            {selectedMonth !== currentMonthStr ? '  ·  tap to change' : ''}
          </Text>
          {household?.name ? (
            <Text style={styles.householdName}>{household.name}</Text>
          ) : null}
        </TouchableOpacity>

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

      {/* Household budget — shown for multi-member households */}
      {isMultiMember && (
        <View style={styles.householdCard}>
          <View style={styles.householdRow}>
            <View>
              <Text style={styles.householdLabel}>Household</Text>
              <Text style={styles.householdPeriod}>{periodLabel(selectedMonth, householdStartDay)}</Text>
            </View>
            <View style={styles.householdNumbers}>
              <Text style={[styles.householdSpent, hOver && styles.householdOver]}>${hSpent.toFixed(0)}</Text>
              {hLimit > 0 && <Text style={styles.householdLimit}> / ${hLimit.toFixed(0)}</Text>}
            </View>
          </View>
          {hLimit > 0 && (
            <View style={styles.hBarTrack}>
              <View style={[styles.hBarFill, { width: `${hPct * 100}%`, backgroundColor: hOver ? '#ef4444' : '#4ade80' }]} />
            </View>
          )}
          {hOver && <Text style={styles.hOverLabel}>${(hSpent - hLimit).toFixed(0)} over</Text>}
        </View>
      )}

      {displayInsights.length > 0 && (
        <View style={styles.insightsSection}>
          <View style={styles.insightsHeading}>
            <Text style={styles.sectionLabel}>Insights</Text>
            {displayInsights.length > 1 ? (
              <Text style={styles.insightsHint}>Swipe for more</Text>
            ) : null}
          </View>
          <ScrollView
            horizontal
            scrollEnabled={hasMultipleInsights}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[
              styles.insightsRail,
              !hasMultipleInsights && styles.insightsRailSingle,
            ]}
          >
            {displayInsights.map((insight) => (
              <View key={insight.id} style={[styles.insightCard, { width: insightCardWidth }]}>
                <View style={styles.insightHeader}>
                  <View style={styles.insightHeaderTop}>
                    <View style={styles.insightScopeChip}>
                      <Text style={styles.insightScopeText}>{insightScopeLabel(insight)}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleDismissInsight(insight.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Dismiss insight: ${insight.title}`}
                    >
                      <Ionicons name="close" size={16} color="#666" />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.insightTitle}>{insight.title}</Text>
                </View>
                <Text style={styles.insightBody}>{insight.body}</Text>
              </View>
            ))}
          </ScrollView>
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
            placeholderTextColor="#555"
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
          <Ionicons name="camera-outline" size={14} color="#888" />
          <Text style={styles.scanLinkText}>scan a receipt</Text>
        </TouchableOpacity>
      </View>

      {/* Recent / Queue tabs */}
      <View style={styles.recent}>
        <View style={styles.recentHeader}>
          <View style={styles.tabRow}>
            <TouchableOpacity onPress={() => setRecentTab('recent')}>
              <Text style={[styles.tabLabel, recentTab === 'recent' && styles.tabLabelActive]}>Recent</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setRecentTab('queue')}>
              <View style={styles.tabWithBadge}>
                <Text style={[styles.tabLabel, recentTab === 'queue' && styles.tabLabelActive]}>Queue</Text>
                {pendingExpenses.length > 0 && (
                  <View style={styles.queueBadge}><Text style={styles.queueBadgeText}>{pendingExpenses.length}</Text></View>
                )}
              </View>
            </TouchableOpacity>
          </View>
          {recentTab === 'recent' && (
            <TouchableOpacity onPress={() => router.navigate('/')}>
              <Text style={styles.seeAll}>See all</Text>
            </TouchableOpacity>
          )}
        </View>

        {recentTab === 'recent' && recent.map(e => (
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
        {recentTab === 'recent' && recent.length === 0 && (
          <Text style={styles.emptyText}>No confirmed expenses yet.</Text>
        )}

        {recentTab === 'queue' && displayPending.slice(0, 10).map(e => (
          <Swipeable
            key={e.id}
            renderLeftActions={() => (
              <TouchableOpacity style={styles.approveAction} onPress={() => approvePending(e.id)}>
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text style={styles.swipeLabel}>Approve</Text>
              </TouchableOpacity>
            )}
            renderRightActions={() => (
              <TouchableOpacity style={styles.dismissAction} onPress={() => dismissPending(e.id)}>
                <Ionicons name="trash-outline" size={18} color="#fff" />
                <Text style={styles.swipeLabel}>Dismiss</Text>
              </TouchableOpacity>
            )}
            overshootLeft={false}
            overshootRight={false}
          >
            <TouchableOpacity
              style={[styles.recentRow, styles.queueRow]}
              onPress={() => router.push(`/expense/${e.id}`)}
            >
              <Text style={styles.recentMerchant} numberOfLines={1}>{e.merchant || e.description || '—'}</Text>
              <Text style={styles.recentDate}>{formatDate(e.date)}</Text>
              <Text style={styles.recentAmount}>${Math.abs(Number(e.amount)).toFixed(2)}</Text>
            </TouchableOpacity>
          </Swipeable>
        ))}
        {recentTab === 'queue' && (
          <Text style={styles.queueStatus}>
            {gmailImportSummary?.last_synced_at
              ? `Last Gmail refresh ${formatRelativeTime(gmailImportSummary.last_synced_at)}`
              : 'Gmail not refreshed yet'}
          </Text>
        )}
        {recentTab === 'queue' && displayPending.length === 0 && (
          <Text style={styles.emptyText}>Queue is empty.</Text>
        )}
        {recentTab === 'queue' && displayPending.length > 10 && (
          <TouchableOpacity onPress={() => router.push('/(tabs)/pending')}>
            <Text style={styles.seeAll}>+{displayPending.length - 10} more in queue</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>

    <Modal visible={showMonthPicker} transparent animationType="slide" onRequestClose={() => setShowMonthPicker(false)}>
      <View style={styles.monthPickerOverlay}>
        <View style={styles.monthPickerSheet}>
          <Text style={styles.monthPickerTitle}>Select month</Text>
          {getPastMonths().map(m => (
            <TouchableOpacity
              key={m}
              style={[styles.monthOption, m === selectedMonth && styles.monthOptionActive]}
              onPress={() => { setSelectedMonth(m); setShowMonthPicker(false); }}
            >
              <Text style={[styles.monthOptionText, m === selectedMonth && styles.monthOptionTextActive]}>
                {periodLabel(m, startDay)}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.monthPickerClose} onPress={() => setShowMonthPicker(false)}>
            <Text style={styles.monthPickerCloseText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0a0a0a' },
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingTop: 16, paddingBottom: 48 },

  spendCard: { marginBottom: 32 },
  spendMonthRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 },
  spendMonth: { fontSize: 13, color: '#888', letterSpacing: 0.5 },
  householdName: { fontSize: 13, color: '#555', letterSpacing: 0.3 },
  spendNumbers: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 },
  spendLabel: { fontSize: 13, color: '#888', marginBottom: 2 },
  spendAmount: { fontSize: 48, color: '#f5f5f5', fontWeight: '600', letterSpacing: -2 },
  spendOver: { color: '#ef4444' },
  spendRight: { alignItems: 'flex-end' },
  budgetAmount: { fontSize: 22, color: '#999', fontWeight: '500', letterSpacing: -0.5 },
  barTrack: { height: 2, backgroundColor: '#1f1f1f', borderRadius: 1, marginBottom: 8 },
  barFill: { height: 2, borderRadius: 1 },
  barLabel: { fontSize: 13, color: '#888' },
  setBudgetLink: { fontSize: 14, color: '#999', marginTop: 8 },

  householdCard: { marginBottom: 32, backgroundColor: '#111', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#1a1a1a' },
  householdRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  householdLabel: { fontSize: 12, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 },
  householdPeriod: { fontSize: 12, color: '#777', marginTop: 2 },
  householdNumbers: { flexDirection: 'row', alignItems: 'baseline' },
  householdSpent: { fontSize: 16, color: '#f5f5f5', fontWeight: '600', letterSpacing: -0.3 },
  householdOver: { color: '#ef4444' },
  householdLimit: { fontSize: 13, color: '#666' },
  hBarTrack: { height: 2, backgroundColor: '#1f1f1f', borderRadius: 1 },
  hBarFill: { height: 2, borderRadius: 1 },
  hOverLabel: { fontSize: 12, color: '#ef4444', marginTop: 4 },

  insightsSection: { marginBottom: 32 },
  insightsHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  insightsHint: { fontSize: 12, color: '#666' },
  insightsRail: { paddingRight: 20, gap: 12 },
  insightsRailSingle: { paddingRight: 0 },
  insightCard: {
    backgroundColor: '#111',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    minHeight: 132,
  },
  insightHeader: { marginBottom: 8, gap: 10 },
  insightHeaderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  insightScopeChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#1a1a1a',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#262626',
  },
  insightScopeText: { fontSize: 11, color: '#cfcfcf', fontWeight: '600', letterSpacing: 0.3 },
  insightTitle: { fontSize: 16, color: '#f5f5f5', fontWeight: '600', lineHeight: 21 },
  insightBody: { fontSize: 13, color: '#999', lineHeight: 18 },

  quickAdd: { marginBottom: 32 },
  sectionLabel: { fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
  inputRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1, backgroundColor: '#111', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 13,
    color: '#f5f5f5', fontSize: 15,
    borderWidth: 1, borderColor: '#1f1f1f',
  },
  addBtn: {
    backgroundColor: '#f5f5f5', borderRadius: 10,
    width: 46, justifyContent: 'center', alignItems: 'center',
  },
  scanLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  scanLinkText: { fontSize: 14, color: '#888' },

  recent: {},
  recentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  tabRow: { flexDirection: 'row', gap: 16 },
  tabLabel: { fontSize: 12, color: '#555', textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: '600' },
  tabLabelActive: { color: '#f5f5f5' },
  tabWithBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  queueBadge: { backgroundColor: '#f59e0b', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  queueBadgeText: { fontSize: 10, color: '#000', fontWeight: '700' },
  queueStatus: { fontSize: 12, color: '#666', marginBottom: 10 },
  queueRow: { borderLeftWidth: 2, borderLeftColor: '#f59e0b', paddingLeft: 10 },
  approveAction: { backgroundColor: '#22c55e', justifyContent: 'center', alignItems: 'center', width: 72, flexDirection: 'column', gap: 2 },
  dismissAction: { backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', width: 72, flexDirection: 'column', gap: 2 },
  swipeLabel: { color: '#fff', fontSize: 11, fontWeight: '600' },
  emptyText: { color: '#555', fontSize: 14, paddingVertical: 12 },
  seeAll: { fontSize: 14, color: '#999', minWidth: 72, textAlign: 'right', paddingRight: 12 },
  recentRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingRight: 12, borderBottomWidth: 1, borderBottomColor: '#111',
    backgroundColor: '#0a0a0a',
  },
  recentMerchant: { flex: 1, fontSize: 15, color: '#f5f5f5', fontWeight: '500' },
  recentDate: { fontSize: 13, color: '#888', marginRight: 16 },
  recentAmount: { fontSize: 15, color: '#f5f5f5', fontWeight: '600', minWidth: 60, textAlign: 'right' },
  recentRefund: { color: '#4ade80' },

  deleteAction: {
    backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center',
    width: 80, borderBottomWidth: 1, borderBottomColor: '#111',
    flexDirection: 'column', gap: 2,
  },
  deleteActionText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  monthPickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  monthPickerSheet: { backgroundColor: '#111', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 40 },
  monthPickerTitle: { fontSize: 13, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 },
  monthOption: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  monthOptionActive: {},
  monthOptionText: { fontSize: 16, color: '#999' },
  monthOptionTextActive: { color: '#f5f5f5', fontWeight: '600' },
  monthPickerClose: { paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  monthPickerCloseText: { color: '#888', fontSize: 15 },
});
