import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity, Modal, LayoutAnimation, UIManager, Platform, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useMonth, periodLabel, currentPeriod } from '../../contexts/MonthContext';
import { Ionicons } from '@expo/vector-icons';
import { useExpenses } from '../../hooks/useExpenses';
import { useHouseholdExpenses } from '../../hooks/useHouseholdExpenses';
import { useBudget } from '../../hooks/useBudget';
import { useHousehold } from '../../hooks/useHousehold';
import { useCategories } from '../../hooks/useCategories';
import { ExpenseItem } from '../../components/ExpenseItem';
import { GlobalPeriodHeader } from '../../components/GlobalPeriodHeader';
import { colors } from '../../theme/tokens';
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
              color={colors.textDisabled}
              style={{ marginLeft: 4, marginTop: 1 }}
            />
          )}
        </View>
        <Text style={styles.budgetAmount}>${spent.toFixed(0)}</Text>
      </TouchableOpacity>
      {pct !== null && (
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: over ? colors.danger : colors.success }]} />
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

function SpendHeader({ myBudget, householdBudget, isMultiMember, selectedMonth, transactionStartDay, onMonthPress, householdName }) {
  return (
    <View style={styles.spendHeader}>
      <GlobalPeriodHeader
        periodText={periodLabel(selectedMonth, transactionStartDay)}
        householdName={householdName}
        onPress={onMonthPress}
        style={styles.globalHeader}
      />
      <BudgetBar spent={Number(myBudget?.total?.spent || 0)} budget={myBudget} label="Mine" />
      {isMultiMember && householdBudget && (
        <BudgetBar spent={Number(householdBudget?.total?.spent || 0)} budget={householdBudget} label="Household" />
      )}
    </View>
  );
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
  const { expenses: myExpenses, loading: myLoading, loadingMore: myLoadingMore, hasMore: myHasMore, error: myError, refresh: refreshMine, loadMore: loadMoreMine } = useExpenses(selectedMonth, transactionStartDay);
  const { expenses: householdExpenses, loading: householdLoading, loadingMore: householdLoadingMore, hasMore: householdHasMore, error: householdError, refresh: refreshHouseholdExpenses, loadMore: loadMoreHousehold } = useHouseholdExpenses(selectedMonth, transactionStartDay, { enabled: isMultiMember && mode === 'household' });
  const { budget: personalBudget, error: personalBudgetError, refresh: refreshPersonalBudget } = useBudget(selectedMonth, 'personal', { startDayOverride: transactionStartDay });
  const { budget: householdBudget, error: householdBudgetError, refresh: refreshHouseholdBudget } = useBudget(selectedMonth, 'household', { startDayOverride: transactionStartDay, enabled: isMultiMember });
  const { categories } = useCategories();
  const refreshInFlightRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    setSelectedMonth(currentPeriod(transactionStartDay));
  }, [transactionStartDay]);
  const expenses = mode === 'mine' ? myExpenses : householdExpenses;
  const loading = mode === 'mine' ? myLoading : householdLoading;
  const expenseError = mode === 'mine' ? myError : householdError;
  const budgetError = mode === 'mine' ? personalBudgetError : householdBudgetError;
  const loadingMore = mode === 'mine' ? myLoadingMore : householdLoadingMore;
  const hasMore = mode === 'mine' ? myHasMore : householdHasMore;
  const loadMore = mode === 'mine' ? loadMoreMine : loadMoreHousehold;
  const currentSortLabel = SORT_OPTIONS.find((option) => option.key === sortKey)?.label || 'Newest';

  const [displayExpenses, setDisplayExpenses] = useState([]);
  useEffect(() => { setDisplayExpenses(sortExpenses(expenses, sortKey)); }, [expenses, sortKey]);

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      const activeExpenseRefresh = mode === 'mine'
        ? refreshMine({ forceRefresh: true })
        : refreshHouseholdExpenses({ forceRefresh: true });
      const activeBudgetRefresh = mode === 'mine'
        ? refreshPersonalBudget({ forceRefresh: true })
        : refreshHouseholdBudget({ forceRefresh: true });
      await Promise.all([
        activeExpenseRefresh,
        activeBudgetRefresh,
        isMultiMember ? refreshHousehold({ forceRefresh: true }) : Promise.resolve(),
      ]);
    } finally {
      refreshInFlightRef.current = false;
      setRefreshing(false);
    }
  }, [mode, refreshMine, refreshHouseholdExpenses, refreshPersonalBudget, refreshHouseholdBudget, refreshHousehold, isMultiMember]);

  const handleDelete = (id) => setDisplayExpenses(prev => prev.filter(e => e.id !== id));

  const listData = displayExpenses;

  const renderItem = ({ item }) => {
    return <ExpenseItem expense={item} categories={categories} onDelete={handleDelete} showUser={mode === 'household'} />;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <SpendHeader
        myBudget={personalBudget}
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
          <Ionicons name="swap-vertical-outline" size={13} color={colors.textSubtle} />
          <Text style={styles.sortChipText}>Sort: {currentSortLabel}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={listData}
        keyExtractor={(item, i) => item.id || `expense-${i}`}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={loading || refreshing} onRefresh={refresh} tintColor={colors.text} />}
        contentContainerStyle={styles.list}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onEndReached={() => {
          if (hasMore && !loadingMore) loadMore();
        }}
        onEndReachedThreshold={0.35}
        ListFooterComponent={loadingMore ? (
          <ActivityIndicator style={styles.loadingMore} color={colors.textMuted} />
        ) : null}
        ListHeaderComponent={
          expenseError || budgetError ? (
            <View style={styles.feedErrorState}>
              <Text style={styles.feedErrorTitle}>Could not refresh your transactions</Text>
              <Text style={styles.feedErrorBody}>{expenseError || budgetError}</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          !loading && <Text style={styles.empty}>No expenses yet. Tap + to get started.</Text>
        }
      />

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
  container: { flex: 1, backgroundColor: colors.background },

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
  toggleChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  toggleChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  toggleText: { fontSize: 14, color: colors.textSubtle, fontWeight: '500' },
  toggleTextActive: { color: colors.textInverse },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortChipText: { fontSize: 13, color: colors.textSubtle, fontWeight: '500' },

  spendHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: colors.surface },
  globalHeader: { marginBottom: 10 },
  budgetSection: { marginBottom: 12 },
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  budgetLabelRow: { flexDirection: 'row', alignItems: 'center' },
  budgetLabel: { fontSize: 12, color: colors.textDisabled, textTransform: 'uppercase', letterSpacing: 0.5 },
  budgetPeriod: { fontSize: 11, color: colors.textDisabled },
  budgetAmount: { fontSize: 22, color: colors.text, fontWeight: '600', letterSpacing: -0.5 },
  byParentList: { marginTop: 8, gap: 6 },
  byParentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  byParentName: { fontSize: 13, color: colors.textSubtle, flex: 1, marginRight: 8 },
  byParentRight: { flexDirection: 'row', alignItems: 'baseline' },
  byParentSpent: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  byParentLimit: { fontSize: 11, color: colors.textDisabled },
  barTrack: { height: 2, backgroundColor: colors.textInverse, borderRadius: 1, marginBottom: 4 },
  barFill: { height: 2, borderRadius: 1 },
  spendSub: { fontSize: 12, color: colors.textDisabled },

  list: { padding: 16, paddingBottom: 88 },
  loadingMore: { paddingVertical: 20 },
  empty: { color: colors.textSubtle, textAlign: 'center', marginTop: 40, fontSize: 15 },
  feedErrorState: {
    marginHorizontal: 16,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.dangerMuted,
    backgroundColor: colors.dangerMuted,
    borderRadius: 8,
  },
  feedErrorTitle: { fontSize: 14, color: colors.text, fontWeight: '600', marginBottom: 4 },
  feedErrorBody: { fontSize: 12, color: colors.danger, lineHeight: 18 },
  monthPickerOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  monthPickerSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 40 },
  monthPickerTitle: { fontSize: 13, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 },
  monthOption: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  monthOptionActive: {},
  monthOptionText: { fontSize: 16, color: colors.textSubtle },
  monthOptionTextActive: { color: colors.text, fontWeight: '600' },
  monthPickerClose: { paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  monthPickerCloseText: { color: colors.textSubtle, fontSize: 15 },
});
