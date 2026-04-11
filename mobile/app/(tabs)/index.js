import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity, Modal, LayoutAnimation, UIManager, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect, useCallback } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { useMonth, periodLabel, currentPeriod } from '../../contexts/MonthContext';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { Ionicons } from '@expo/vector-icons';
import { useExpenses } from '../../hooks/useExpenses';
import { useHouseholdExpenses } from '../../hooks/useHouseholdExpenses';
import { useBudget } from '../../hooks/useBudget';
import { usePendingExpenses } from '../../hooks/usePendingExpenses';
import { useHousehold } from '../../hooks/useHousehold';
import { useCategories } from '../../hooks/useCategories';
import { ExpenseItem } from '../../components/ExpenseItem';
import { api } from '../../services/api';
import { GlobalPeriodHeader } from '../../components/GlobalPeriodHeader';
import { removeExpenseSnapshot, saveExpenseSnapshot } from '../../services/expenseLocalStore';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SORT_OPTIONS = [
  { key: 'newest', label: 'Newest' },
  { key: 'amount', label: 'Amount' },
  { key: 'category', label: 'Category' },
  { key: 'user', label: 'User' },
  { key: 'merchant', label: 'Merchant' },
];

function compareText(a, b) {
  return `${a || ''}`.localeCompare(`${b || ''}`, undefined, { sensitivity: 'base' });
}

function compareNewest(a, b) {
  const dateCompare = `${b?.date || ''}`.localeCompare(`${a?.date || ''}`);
  if (dateCompare !== 0) return dateCompare;
  return `${b?.created_at || ''}`.localeCompare(`${a?.created_at || ''}`);
}

function sortExpenses(expenses = [], sortKey = 'newest') {
  const list = [...expenses];
  switch (sortKey) {
    case 'amount':
      return list.sort((a, b) => {
        const diff = Math.abs(Number(b?.amount || 0)) - Math.abs(Number(a?.amount || 0));
        if (diff !== 0) return diff;
        return compareNewest(a, b);
      });
    case 'category':
      return list.sort((a, b) => {
        const diff = compareText(a?.category_parent_name || a?.category_name || 'Uncategorized', b?.category_parent_name || b?.category_name || 'Uncategorized');
        if (diff !== 0) return diff;
        return compareNewest(a, b);
      });
    case 'user':
      return list.sort((a, b) => {
        const diff = compareText(a?.user_name || 'You', b?.user_name || 'You');
        if (diff !== 0) return diff;
        return compareNewest(a, b);
      });
    case 'merchant':
      return list.sort((a, b) => {
        const diff = compareText(a?.merchant || a?.description || '', b?.merchant || b?.description || '');
        if (diff !== 0) return diff;
        return compareNewest(a, b);
      });
    case 'newest':
    default:
      return list.sort(compareNewest);
  }
}

function getPastMonths() {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function BudgetBar({ spent, budget, label, periodText }) {
  const [expanded, setExpanded] = useState(false);
  const limit = budget?.total?.limit;
  const pct = limit ? Math.min(spent / limit, 1) : null;
  const hasLimit = Number(limit) > 0;
  const over = hasLimit && spent > limit;
  const byParent = budget?.by_parent;
  const hasBreakdown = Array.isArray(byParent) && byParent.length > 0;

  function toggle() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(e => !e);
  }

  return (
    <View style={styles.budgetSection}>
      <TouchableOpacity
        style={styles.budgetRow}
        onPress={hasBreakdown ? toggle : undefined}
        activeOpacity={hasBreakdown ? 0.7 : 1}
      >
        <View style={styles.budgetLabelRow}>
          <Text style={styles.budgetLabel}>{label}</Text>
          {periodText ? <Text style={styles.budgetPeriod}> · {periodText}</Text> : null}
          {hasBreakdown && (
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={11}
              color="#555"
              style={{ marginLeft: 4, marginTop: 1 }}
            />
          )}
        </View>
        <Text style={styles.budgetAmount}>${spent.toFixed(0)}</Text>
      </TouchableOpacity>
      {pct !== null && (
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: over ? '#ef4444' : '#4ade80' }]} />
        </View>
      )}
      {hasLimit && (
        <Text style={styles.spendSub}>
          {over
            ? `$${(spent - limit).toFixed(0)} over budget`
            : `$${(limit - spent).toFixed(0)} remaining of $${limit.toFixed(0)}`}
        </Text>
      )}
      {expanded && hasBreakdown && (
        <View style={styles.byParentList}>
          {byParent
            .filter(p => p.spent > 0)
            .sort((a, b) => b.spent - a.spent)
            .map(p => (
              <View key={p.group_id} style={styles.byParentRow}>
                <Text style={styles.byParentName} numberOfLines={1}>{p.name}</Text>
                <View style={styles.byParentRight}>
                  <Text style={styles.byParentSpent}>${p.spent.toFixed(0)}</Text>
                  {p.limit != null && (
                    <Text style={styles.byParentLimit}> / ${p.limit.toFixed(0)}</Text>
                  )}
                </View>
              </View>
            ))}
        </View>
      )}
    </View>
  );
}

function SpendHeader({ myTotal, myBudget, householdTotal, householdBudget, isMultiMember, selectedMonth, transactionStartDay, onMonthPress, householdName }) {
  return (
    <View style={styles.spendHeader}>
      <GlobalPeriodHeader
        periodText={periodLabel(selectedMonth, transactionStartDay)}
        householdName={householdName}
        onPress={onMonthPress}
        style={styles.globalHeader}
      />
      <BudgetBar spent={myTotal} budget={myBudget} label="Mine" />
      {isMultiMember && householdBudget && (
        <BudgetBar spent={householdTotal} budget={householdBudget} label="Household" />
      )}
    </View>
  );
}

function pendingPreviewLabel(expense = {}) {
  if (expense?.review_source === 'gmail' || expense?.source === 'email') {
    const mode = expense?.gmail_review_hint?.review_mode;
    if (mode === 'quick_check') return 'Gmail import · Quick check';
    if (mode === 'items_first') return 'Gmail import · Items first';
    return 'Gmail import · Review';
  }
  return 'Pending review';
}

function pendingGuidance(expense = {}) {
  const mode = expense?.gmail_review_hint?.review_mode;
  if (mode === 'quick_check') return 'Check merchant, amount, and date.';
  if (mode === 'items_first') return 'Review extracted items before approving.';
  return 'Check merchant, date, and category.';
}

function isQuickCheckPending(expense = {}) {
  if (expense?.gmail_review_hint?.review_mode !== 'quick_check') return false;
  if (Array.isArray(expense?.duplicate_flags) && expense.duplicate_flags.length > 0) return false;
  const likelyChangedFields = Array.isArray(expense?.gmail_review_hint?.likely_changed_fields)
    ? expense.gmail_review_hint.likely_changed_fields.filter(Boolean)
    : [];
  return likelyChangedFields.length <= 1;
}

function pendingModeSummary(expenses = []) {
  const counts = { quickCheck: 0, itemsFirst: 0, review: 0 };
  for (const expense of expenses) {
    const mode = expense?.gmail_review_hint?.review_mode;
    if (mode === 'quick_check') counts.quickCheck += 1;
    else if (mode === 'items_first') counts.itemsFirst += 1;
    else counts.review += 1;
  }

  return [
    counts.quickCheck > 0 ? `${counts.quickCheck} quick check` : null,
    counts.itemsFirst > 0 ? `${counts.itemsFirst} items first` : null,
    counts.review > 0 ? `${counts.review} review` : null,
  ].filter(Boolean).join(' · ');
}

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState('mine');
  const [sortKey, setSortKey] = useState('newest');
  const { startDay } = useMonth();
  const { household, memberCount, refresh: refreshHousehold } = useHousehold();
  const householdStartDay = household?.budget_start_day || 1;
  const isMultiMember = memberCount > 1;
  const transactionStartDay = isMultiMember ? householdStartDay : startDay;
  const [selectedMonth, setSelectedMonth] = useState(() => currentPeriod(transactionStartDay));
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showSortPicker, setShowSortPicker] = useState(false);
  const { expenses: myExpenses, loading: myLoading, refresh: refreshMine } = useExpenses(selectedMonth, transactionStartDay);
  const { expenses: householdExpenses, loading: householdLoading, refresh: refreshHouseholdExpenses } = useHouseholdExpenses(selectedMonth, transactionStartDay, { enabled: isMultiMember });
  const { budget: personalBudget, refresh: refreshPersonalBudget } = useBudget(selectedMonth, 'personal', { startDayOverride: transactionStartDay });
  const { budget: householdBudget, refresh: refreshHouseholdBudget } = useBudget(selectedMonth, 'household', { startDayOverride: transactionStartDay, enabled: isMultiMember });
  const { expenses: pending, refresh: refreshPending, isUsingMockData: isUsingMockPending, resolveMockExpense } = usePendingExpenses();
  const { categories } = useCategories();
  const router = useRouter();

  useEffect(() => {
    setSelectedMonth(currentPeriod(transactionStartDay));
  }, [transactionStartDay]);

  const expenses = mode === 'mine' ? myExpenses : householdExpenses;
  const loading = mode === 'mine' ? myLoading : householdLoading;
  const currentSortLabel = SORT_OPTIONS.find((option) => option.key === sortKey)?.label || 'Newest';

  const [displayExpenses, setDisplayExpenses] = useState([]);
  useEffect(() => { setDisplayExpenses(sortExpenses(expenses, sortKey)); }, [expenses, sortKey]);

  const refresh = useCallback(() => {
    refreshMine();
    if (isMultiMember) refreshHouseholdExpenses();
    refreshPersonalBudget();
    if (isMultiMember) refreshHouseholdBudget();
    refreshPending();
    refreshHousehold();
  }, [refreshMine, refreshHouseholdExpenses, refreshPersonalBudget, refreshHouseholdBudget, refreshPending, refreshHousehold, isMultiMember]);

  useFocusEffect(useCallback(() => {
    if (isMultiMember) refreshHouseholdExpenses();
    if (isMultiMember) refreshHouseholdBudget();
    refreshPersonalBudget();
    refreshPending();
  }, [refreshHouseholdExpenses, refreshHouseholdBudget, refreshPersonalBudget, refreshPending, isMultiMember]));

  async function dismissPending(id) {
    if (isUsingMockPending) {
      resolveMockExpense(id);
      return;
    }
    try {
      await api.post(`/expenses/${id}/dismiss`);
      await removeExpenseSnapshot(id);
      const { invalidateCache } = await import('../../services/cache');
      await invalidateCache('cache:expenses:pending');
      refreshPending();
    } catch { /* ignore */ }
  }

  async function approvePending(id) {
    if (isUsingMockPending) {
      resolveMockExpense(id);
      return;
    }
    try {
      const approved = await api.post(`/expenses/${id}/approve`);
      if (approved?.id) await saveExpenseSnapshot(approved);
      refreshPending();
      const { invalidateCache, invalidateCacheByPrefix } = await import('../../services/cache');
      await Promise.all([
        invalidateCache('cache:expenses:pending'),
        invalidateCacheByPrefix('cache:expenses:'),
        invalidateCacheByPrefix('cache:budget:'),
        invalidateCacheByPrefix('cache:household-expenses:'),
      ]);
      refreshMine();
      refreshHouseholdExpenses();
      refreshPersonalBudget();
      refreshHouseholdBudget();
    } catch { /* ignore */ }
  }

  const handleDelete = (id) => setDisplayExpenses(prev => prev.filter(e => e.id !== id));

  const selectedDate = new Date(selectedMonth + '-02');
  const myTotal = myExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const householdTotal = householdExpenses.reduce((sum, e) => sum + Number(e.amount), 0);

  const listData = [
    ...(pending?.length > 0 ? [{ _type: 'pending_section', items: pending }] : []),
    ...displayExpenses.map(e => ({ _type: 'expense', ...e })),
  ];

  const renderItem = ({ item }) => {
    if (item._type === 'pending_section') {
      const modeSummary = pendingModeSummary(item.items);
      return (
        <View style={styles.pendingSection}>
          <Text style={styles.pendingLabel}>Needs your review · {item.items.length}</Text>
          {modeSummary ? (
            <Text style={styles.pendingModeSummary}>{modeSummary}</Text>
          ) : null}
          {isUsingMockPending ? (
            <Text style={styles.pendingPreviewNote}>Dev preview queue</Text>
          ) : null}
          {item.items.slice(0, 3).map(e => (
            <Swipeable
              key={e.id}
              renderLeftActions={() => (
                <TouchableOpacity style={styles.approveAction} onPress={() => approvePending(e.id)}>
                  <Ionicons name="checkmark" size={16} color="#fff" />
                  <Text style={styles.swipeLabel}>Approve</Text>
                </TouchableOpacity>
              )}
              renderRightActions={() => (
                <TouchableOpacity style={styles.dismissAction} onPress={() => dismissPending(e.id)}>
                  <Ionicons name="trash-outline" size={16} color="#fff" />
                  <Text style={styles.swipeLabel}>Dismiss</Text>
                </TouchableOpacity>
              )}
              overshootLeft={false}
              overshootRight={false}
            >
              <TouchableOpacity
                style={styles.pendingRow}
                onPress={() => router.push({
                  pathname: '/expense/[id]',
                  params: {
                    id: e.id,
                    expense: JSON.stringify(e),
                  },
                })}
                activeOpacity={0.85}
              >
                <View style={styles.pendingRowMain}>
                  <Text style={styles.pendingMerchant} numberOfLines={1}>{e.merchant || e.description || '—'}</Text>
                  <Text style={styles.pendingMeta} numberOfLines={1}>{pendingPreviewLabel(e)}</Text>
                  <Text style={styles.pendingGuidance} numberOfLines={1}>{pendingGuidance(e)}</Text>
                </View>
                <View style={styles.pendingRowRight}>
                  <Text style={styles.pendingAmount}>${Number(e.amount).toFixed(2)}</Text>
                  {isQuickCheckPending(e) ? (
                    <TouchableOpacity
                      style={styles.pendingConfirmChip}
                      onPress={(event) => {
                        event.stopPropagation?.();
                        approvePending(e.id);
                      }}
                      activeOpacity={0.82}
                    >
                      <Text style={styles.pendingConfirmChipText}>Confirm</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.pendingReviewChip}>
                      <Text style={styles.pendingReviewChipText}>Review</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            </Swipeable>
          ))}
          {item.items.length > 3 && (
            <TouchableOpacity
              style={styles.pendingMoreButton}
              onPress={() => router.push('/(tabs)/pending')}
              activeOpacity={0.8}
            >
              <Text style={styles.pendingMore}>+{item.items.length - 3} more</Text>
              <Ionicons name="chevron-forward" size={14} color="#888" />
            </TouchableOpacity>
          )}
        </View>
      );
    }
    return <ExpenseItem expense={item} categories={categories} onDelete={handleDelete} showUser={mode === 'household'} />;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <SpendHeader
        myTotal={myTotal}
        myBudget={personalBudget}
        householdTotal={householdTotal}
        householdBudget={householdBudget}
        isMultiMember={isMultiMember}
        selectedMonth={selectedMonth}
        transactionStartDay={transactionStartDay}
        onMonthPress={() => setShowMonthPicker(true)}
        householdName={isMultiMember ? (household?.name || '') : ''}
      />

      {/* Mine / Household toggle — filters the expense list only */}
      <View style={styles.controlsRow}>
      {isMultiMember ? (
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleChip, mode === 'mine' && styles.toggleChipActive]}
            onPress={() => setMode('mine')}
          >
            <Text style={[styles.toggleText, mode === 'mine' && styles.toggleTextActive]}>Mine</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleChip, mode === 'household' && styles.toggleChipActive]}
            onPress={() => setMode('household')}
          >
            <Text style={[styles.toggleText, mode === 'household' && styles.toggleTextActive]}>Household</Text>
          </TouchableOpacity>
        </View>
      ) : <View />}
        <TouchableOpacity style={styles.sortChip} onPress={() => setShowSortPicker(true)}>
          <Ionicons name="swap-vertical-outline" size={13} color="#888" />
          <Text style={styles.sortChipText}>Sort: {currentSortLabel}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={listData}
        keyExtractor={(item, i) => item.id || `section-${i}`}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#fff" />}
        contentContainerStyle={styles.list}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          !loading && <Text style={styles.empty}>No expenses yet. Tap + to get started.</Text>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/(tabs)/add')}
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

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
                  {periodLabel(m, transactionStartDay)}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.monthPickerClose} onPress={() => setShowMonthPicker(false)}>
              <Text style={styles.monthPickerCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showSortPicker} transparent animationType="slide" onRequestClose={() => setShowSortPicker(false)}>
        <View style={styles.monthPickerOverlay}>
          <View style={styles.monthPickerSheet}>
            <Text style={styles.monthPickerTitle}>Sort transactions</Text>
            {SORT_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.key}
                style={[styles.monthOption, option.key === sortKey && styles.monthOptionActive]}
                onPress={() => {
                  setSortKey(option.key);
                  setShowSortPicker(false);
                }}
              >
                <Text style={[styles.monthOptionText, option.key === sortKey && styles.monthOptionTextActive]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.monthPickerClose} onPress={() => setShowSortPicker(false)}>
              <Text style={styles.monthPickerCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },

  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 12,
  },
  toggleRow: { flexDirection: 'row', gap: 8 },
  toggleChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: '#111', borderWidth: 1, borderColor: '#222' },
  toggleChipActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  toggleText: { fontSize: 14, color: '#999', fontWeight: '500' },
  toggleTextActive: { color: '#000' },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#222',
  },
  sortChipText: { fontSize: 13, color: '#999', fontWeight: '500' },

  spendHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: '#111' },
  globalHeader: { marginBottom: 10 },
  budgetSection: { marginBottom: 12 },
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  budgetLabelRow: { flexDirection: 'row', alignItems: 'center' },
  budgetLabel: { fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 },
  budgetPeriod: { fontSize: 11, color: '#555' },
  budgetAmount: { fontSize: 22, color: '#f5f5f5', fontWeight: '600', letterSpacing: -0.5 },
  byParentList: { marginTop: 8, gap: 6 },
  byParentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  byParentName: { fontSize: 13, color: '#888', flex: 1, marginRight: 8 },
  byParentRight: { flexDirection: 'row', alignItems: 'baseline' },
  byParentSpent: { fontSize: 13, color: '#ccc', fontWeight: '500' },
  byParentLimit: { fontSize: 11, color: '#555' },
  barTrack: { height: 2, backgroundColor: '#1f1f1f', borderRadius: 1, marginBottom: 4 },
  barFill: { height: 2, borderRadius: 1 },
  spendSub: { fontSize: 12, color: '#666' },

  list: { padding: 16 },
  empty: { color: '#999', textAlign: 'center', marginTop: 40, fontSize: 15 },

  pendingSection: { backgroundColor: '#111', borderRadius: 10, overflow: 'hidden', marginBottom: 12, borderWidth: 1, borderColor: '#1f1f1f' },
  pendingLabel: { fontSize: 12, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, fontWeight: '600', paddingHorizontal: 12, paddingTop: 12 },
  pendingModeSummary: { fontSize: 11, color: '#7f8da4', paddingHorizontal: 12, paddingBottom: 2 },
  pendingPreviewNote: { fontSize: 11, color: '#8ab4ff', paddingHorizontal: 12, paddingBottom: 4 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  pendingRowMain: { flex: 1, marginRight: 8 },
  pendingMerchant: { fontSize: 14, color: '#f5f5f5' },
  pendingMeta: { fontSize: 11, color: '#8faed8', marginTop: 3, fontWeight: '600' },
  pendingGuidance: { fontSize: 12, color: '#8a8a8a', marginTop: 4 },
  pendingRowRight: { alignItems: 'flex-end', gap: 6 },
  pendingAmount: { fontSize: 14, color: '#f5f5f5', fontWeight: '600' },
  pendingConfirmChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(134,239,172,0.3)',
    backgroundColor: 'rgba(134,239,172,0.08)',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  pendingConfirmChipText: { color: '#bbf7d0', fontSize: 11, fontWeight: '700' },
  pendingReviewChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2b3442',
    backgroundColor: '#141920',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  pendingReviewChipText: { color: '#c8d7ec', fontSize: 11, fontWeight: '700' },
  pendingMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  pendingMore: { color: '#888', fontSize: 14, textAlign: 'center' },
  approveAction: { backgroundColor: '#22c55e', justifyContent: 'center', alignItems: 'center', width: 72, flexDirection: 'column', gap: 2 },
  dismissAction: { backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', width: 72, flexDirection: 'column', gap: 2 },
  swipeLabel: { color: '#fff', fontSize: 11, fontWeight: '600' },

  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 5,
  },
  fabText: { fontSize: 28, color: '#000', lineHeight: 32, fontWeight: '300' },

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
