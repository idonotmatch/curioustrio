import { View, Text, ScrollView, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useMonth, periodLabel, currentPeriod } from '../../contexts/MonthContext';
import { useState, useCallback, useEffect, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useExpenses } from '../../hooks/useExpenses';
import { useHouseholdExpenses } from '../../hooks/useHouseholdExpenses';
import { useBudget } from '../../hooks/useBudget';
import { useHousehold } from '../../hooks/useHousehold';
import { usePendingExpenses } from '../../hooks/usePendingExpenses';
import { useInsights } from '../../hooks/useInsights';
import { api } from '../../services/api';
import { GlobalPeriodHeader } from '../../components/GlobalPeriodHeader';
import { GlobalAddLauncher } from '../../components/GlobalAddLauncher';
import { SummaryInsightsRail } from '../../components/SummaryInsightsRail';
import { SummaryMonthPicker } from '../../components/SummaryMonthPicker';
import { SummaryRecentActivity } from '../../components/SummaryRecentActivity';
import { stashNavigationPayload } from '../../services/navigationPayloadStore';
import { saveInsightDetailSnapshot } from '../../services/insightLocalStore';
import {
  getPastMonths,
  formatDate,
  formatRelativeTime,
  insightEventMetadata,
  buildRecurringItemPreload,
  buildPreloadedCategoryExpenses,
  buildPreloadedInsightEvidence,
} from '../../services/summaryScreenHelpers';
import { buildMockInsights } from '../../fixtures/mockInsights';
import { buildMockGmailImportState } from '../../fixtures/mockGmailImport';

const MOCK_GMAIL_IMPORT_SUMMARY = buildMockGmailImportState().importSummary;

export default function SummaryScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const { selectedMonth, setSelectedMonth, startDay } = useMonth();
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const { household, memberCount } = useHousehold();
  const isMultiMember = memberCount > 1;
  const { expenses, refresh: refreshExpenses } = useExpenses(selectedMonth);
  const { expenses: householdExpenses, refresh: refreshHouseholdExpenses } = useHouseholdExpenses(selectedMonth, null, { enabled: isMultiMember });
  const { budget: personalBudget, refresh: refreshPersonalBudget } = useBudget(selectedMonth, 'personal');
  const { budget: householdBudget, refresh: refreshHouseholdBudget } = useBudget(selectedMonth, 'household', { enabled: isMultiMember });
  const { expenses: pendingExpenses, refresh: refreshPending } = usePendingExpenses();
  const {
    insights,
    error: insightsError,
    refresh: refreshInsights,
    markSeen,
    dismiss: dismissInsight,
    logEvents,
  } = useInsights(1, { fetchLimit: 5 });
  const [dismissedMockInsightIds, setDismissedMockInsightIds] = useState([]);
  const [allowMockInsights, setAllowMockInsights] = useState(__DEV__);
  const [gmailImportSummary, setGmailImportSummary] = useState(null);
  const [watchedPlans, setWatchedPlans] = useState([]);
  const currentMonthStr = selectedMonth || currentPeriod(startDay);
  const watchedHouseholdCount = watchedPlans.filter((plan) => plan.scope === 'household').length;
  const watchedPersonalCount = watchedPlans.filter((plan) => plan.scope !== 'household').length;
  const watchedPreferenceNote = watchedPlans.find((plan) => plan?.timing_preference_note)?.timing_preference_note || '';
  const displayInsights = allowMockInsights && insights.length === 0
    ? buildMockInsights(currentMonthStr).filter((insight) => !dismissedMockInsightIds.includes(insight.id))
    : insights;
  const displayGmailImportSummary = gmailImportSummary || (__DEV__ ? MOCK_GMAIL_IMPORT_SUMMARY : null);
  const gmailRefreshTimestamp = displayGmailImportSummary?.last_synced_at
    || displayGmailImportSummary?.last_sync_attempted_at
    || displayGmailImportSummary?.last_imported_at
    || null;
  const gmailRefreshVerb = displayGmailImportSummary?.last_synced_at ? 'synced' : 'checked';
  const hasMultipleInsights = displayInsights.length > 1;
  const insightCardWidth = displayInsights.length <= 1
    ? Math.max(0, windowWidth - 40)
    : Math.max(280, windowWidth - 88);
  const loggedShownInsightIds = useRef(new Set());
  const insightNavigationResetRef = useRef(null);
  const [openingInsightId, setOpeningInsightId] = useState('');

  const releaseInsightNavigationLock = useCallback(() => {
    if (insightNavigationResetRef.current) {
      clearTimeout(insightNavigationResetRef.current);
      insightNavigationResetRef.current = null;
    }
    setOpeningInsightId('');
  }, []);

  const lockInsightNavigation = useCallback((insightId) => {
    setOpeningInsightId(insightId);
    if (insightNavigationResetRef.current) clearTimeout(insightNavigationResetRef.current);
    insightNavigationResetRef.current = setTimeout(() => {
      insightNavigationResetRef.current = null;
      setOpeningInsightId('');
    }, 4000);
  }, []);

  const loadGmailImportSummary = useCallback(async () => {
    try {
      const data = await api.get('/gmail/import-summary?days=30');
      setGmailImportSummary(data);
    } catch {
      setGmailImportSummary(null);
    }
  }, []);

  const loadWatchedPlans = useCallback(async () => {
    try {
      const data = await api.get('/trends/scenario-memory/watching?limit=5');
      setWatchedPlans(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setWatchedPlans([]);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    releaseInsightNavigationLock();
    refreshExpenses();
    refreshPersonalBudget();
    if (isMultiMember) refreshHouseholdExpenses();
    if (isMultiMember) refreshHouseholdBudget();
    refreshPending();
    loadGmailImportSummary();
    loadWatchedPlans();
    refreshInsights();
  }, [
    refreshExpenses,
    refreshPersonalBudget,
    refreshHouseholdExpenses,
    refreshHouseholdBudget,
    refreshPending,
    loadGmailImportSummary,
    loadWatchedPlans,
    refreshInsights,
    isMultiMember,
    releaseInsightNavigationLock,
  ]));

  useEffect(() => () => {
    if (insightNavigationResetRef.current) {
      clearTimeout(insightNavigationResetRef.current);
      insightNavigationResetRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!__DEV__) return;
    if (insights.length > 0 || insightsError) {
      setAllowMockInsights(false);
    }
  }, [insights.length, insightsError]);

  useEffect(() => {
    if (__DEV__ && insights.length === 0) return;
    const unseenIds = insights
      .filter((insight) => insight.state?.status !== 'seen')
      .map((insight) => insight.id);
    if (unseenIds.length) markSeen(unseenIds);
  }, [insights, markSeen]);

  useEffect(() => {
    if (__DEV__ && insights.length === 0) return;
    const idsToLog = displayInsights
      .map((insight) => insight.id)
      .filter((id) => id && !loggedShownInsightIds.current.has(id));
    if (!idsToLog.length) return;
    idsToLog.forEach((id) => loggedShownInsightIds.current.add(id));
    logEvents(displayInsights
      .filter((insight) => idsToLog.includes(insight.id))
      .map((insight) => ({
      insight_id: insight.id,
      event_type: 'shown',
      metadata: insightEventMetadata(insight),
    })));
  }, [displayInsights, insights.length, logEvents]);

  function handleDismissInsight(insight) {
    if (__DEV__ && insights.length === 0) {
      setDismissedMockInsightIds((current) => [...current, insight.id]);
      return;
    }
    dismissInsight(insight.id, insightEventMetadata(insight));
  }

  async function handlePressInsight(insight) {
    if (!insight?.id) return;
    if (openingInsightId) return;
    lockInsightNavigation(insight.id);
    const isMockInsight = __DEV__ && insights.length === 0;
    if (!isMockInsight) {
      logEvents([{
        insight_id: insight.id,
        event_type: 'tapped',
        metadata: insightEventMetadata(insight),
      }]).catch(() => {});
    }

    if (insight?.entity_type === 'item' && insight?.metadata?.group_key) {
      const preloadHistory = buildRecurringItemPreload(insight);
      const payloadKey = stashNavigationPayload({
        metadata: insight.metadata || {},
        preloadHistory,
      }, 'recurring-item');
      router.push({
        pathname: '/recurring-item',
        params: {
          group_key: insight.metadata.group_key,
          scope: insight.metadata.scope || 'personal',
          title: insight.metadata.item_name || insight.title,
          insight_id: insight.id,
          insight_type: insight.type,
          body: insight.body,
          payload_key: payloadKey,
        },
      });
      return;
    }

    if (insight?.type === 'usage_start_logging') {
      router.push('/(tabs)/add');
      return;
    }

    if (insight?.type === 'usage_set_budget') {
      router.push('/budget-period');
      return;
    }

    if (insight?.type === 'usage_building_history') {
      router.push('/(tabs)/add');
      return;
    }

    if (insight?.type === 'usage_ready_to_plan') {
      const payloadKey = stashNavigationPayload({
        planningInsight: {
          id: insight.id,
          title: insight.title,
          body: insight.body,
          metadata: insight.metadata || {},
        },
      }, 'scenario-check');
      router.push({
        pathname: '/scenario-check',
        params: {
          scope: insight.metadata?.scope || 'personal',
          month: insight.metadata?.month || currentMonthStr,
          payload_key: payloadKey,
        },
      });
      return;
    }

    const trendInsightTypes = new Set([
      'spend_pace_ahead',
      'spend_pace_behind',
      'budget_too_low',
      'budget_too_high',
      'top_category_driver',
      'one_offs_driving_variance',
      'recurring_cost_pressure',
      'projected_month_end_over_budget',
      'projected_month_end_under_budget',
      'projected_category_under_baseline',
      'one_off_expense_skewing_projection',
      'projected_category_surge',
    ]);

    if (trendInsightTypes.has(insight?.type) && insight?.metadata?.month) {
      const preloadedCategoryExpenses = buildPreloadedCategoryExpenses(insight, expenses, householdExpenses);
      const payloadKey = stashNavigationPayload({
        insightMetadata: insight.metadata || {},
        preloadedCategoryExpenses,
      }, 'trend-detail');
      router.push({
        pathname: '/trend-detail',
        params: {
          scope: insight.metadata?.scope || 'personal',
          month: insight.metadata?.month,
          insight_type: insight.type,
          category_key: insight.metadata?.category_key || '',
          payload_key: payloadKey,
          title: insight.title,
          insight_id: insight.id,
          mock: isMockInsight ? '1' : '',
        },
      });
      return;
    }

    const earlyDevelopingInsightTypes = new Set([
      'early_budget_pace',
      'early_top_category',
      'early_repeated_merchant',
      'early_spend_concentration',
      'early_cleanup',
      'early_logging_momentum',
      'developing_weekly_spend_change',
      'developing_category_shift',
      'developing_repeated_merchant',
    ]);

    if (earlyDevelopingInsightTypes.has(insight?.type)) {
      const preloadedEvidence = buildPreloadedInsightEvidence(insight, expenses, householdExpenses);
      saveInsightDetailSnapshot(insight, { preloadEvidence: preloadedEvidence }).catch(() => {});
      const payloadKey = stashNavigationPayload({
        metadata: insight.metadata || {},
        action: insight.action || null,
        preloadEvidence: preloadedEvidence,
      }, 'insight-detail');
      router.push({
        pathname: '/insight-detail',
        params: {
          insight_id: insight.id,
          insight_type: insight.type,
          title: insight.title,
          body: insight.body,
          severity: insight.severity || 'low',
          entity_type: insight.entity_type || '',
          entity_id: insight.entity_id || '',
          action: insight.action ? JSON.stringify(insight.action) : '',
          payload_key: payloadKey,
        },
      });
      return;
    }
    saveInsightDetailSnapshot(insight, { preloadEvidence: [] }).catch(() => {});
    const payloadKey = stashNavigationPayload({
      metadata: insight.metadata || {},
      preloadEvidence: [],
    }, 'insight-detail');
    router.push({
      pathname: '/insight-detail',
      params: {
        insight_id: insight.id,
        insight_type: insight.type,
        title: insight.title,
        body: insight.body,
        severity: insight.severity || 'low',
        entity_type: insight.entity_type || '',
        entity_id: insight.entity_id || '',
        payload_key: payloadKey,
      },
    });
  }

  const spent = Number(personalBudget?.total?.spent || 0);
  const householdSpent = Number(householdBudget?.total?.spent || 0);
  const limit = personalBudget?.total?.limit ?? 0;
  const pct = limit ? Math.min(spent / limit, 1) : 0;
  const over = limit > 0 && spent > limit;

  const hLimit = householdBudget?.total?.limit ?? 0;
  const hSpent = householdSpent;
  const hPct = hLimit ? Math.min(hSpent / hLimit, 1) : 0;
  const hOver = hLimit > 0 && hSpent > hLimit;
  const recent = (expenses || []).slice(0, 5);
  const watchedImprovedCount = watchedPlans.filter((plan) => plan.last_material_change === 'improved').length;
  const watchedWorsenedCount = watchedPlans.filter((plan) => plan.last_material_change === 'worsened').length;

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
        <GlobalPeriodHeader
          periodText={`${periodLabel(selectedMonth, startDay)}${selectedMonth !== currentMonthStr ? ' · tap to change' : ''}`}
          householdName={isMultiMember ? (household?.name || '') : ''}
          onPress={() => setShowMonthPicker(true)}
          style={styles.globalHeader}
        />

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

      <SummaryInsightsRail
        styles={styles}
        displayInsights={displayInsights}
        insightsError={insightsError}
        refreshInsights={refreshInsights}
        hasMultipleInsights={hasMultipleInsights}
        insightCardWidth={insightCardWidth}
        handlePressInsight={handlePressInsight}
        handleDismissInsight={handleDismissInsight}
        openingInsightId={openingInsightId}
        title="What matters now"
        hint="Swipe for more"
      />

      {displayInsights.length === 0 && !insightsError ? (
        <TouchableOpacity
          style={styles.insightEmptyCard}
          activeOpacity={0.88}
          onPress={() => router.push('/insight-diagnostics')}
        >
          <Text style={styles.insightEmptyEyebrow}>What matters now</Text>
          <Text style={styles.insightEmptyTitle}>No insight cards are surfacing right now</Text>
          <Text style={styles.insightEmptyBody}>
            That can mean Adlo does not have any strong signals yet, or that current candidates are being filtered out. Open diagnostics to see which one it is.
          </Text>
          <Text style={styles.insightEmptyAction}>Open insight diagnostics</Text>
        </TouchableOpacity>
      ) : null}

      {watchedPlans.length > 0 ? (
        <TouchableOpacity
          style={styles.watchingCard}
          activeOpacity={0.88}
          onPress={() => router.push('/watching-plans')}
        >
          <View style={styles.watchingText}>
            <Text style={styles.watchingTitle}>Watching</Text>
            <Text style={styles.watchingMeta}>
              {watchedPlans.length} active {watchedPlans.length === 1 ? 'plan' : 'plans'}
            </Text>
            <Text style={styles.watchingBody}>
              {watchedImprovedCount > 0 || watchedWorsenedCount > 0
                ? `${watchedImprovedCount > 0 ? `${watchedImprovedCount} got easier` : ''}${watchedImprovedCount > 0 && watchedWorsenedCount > 0 ? ' · ' : ''}${watchedWorsenedCount > 0 ? `${watchedWorsenedCount} got tighter` : ''}`
                : 'Plans you asked Adlo to keep an eye on.'}
              {(watchedHouseholdCount > 0 || watchedPersonalCount > 0)
                ? ` ${watchedHouseholdCount > 0 ? `${watchedHouseholdCount} shared` : ''}${watchedHouseholdCount > 0 && watchedPersonalCount > 0 ? ' · ' : ''}${watchedPersonalCount > 0 ? `${watchedPersonalCount} personal` : ''}.`
                : ''}
            </Text>
            {watchedPreferenceNote ? (
              <Text style={styles.watchingNote}>{watchedPreferenceNote}</Text>
            ) : null}
          </View>
          <View style={styles.watchingCTA}>
            <Text style={styles.watchingCTAText}>See plans</Text>
          </View>
        </TouchableOpacity>
      ) : null}

      <SummaryRecentActivity
        styles={styles}
        recent={recent}
        pendingExpensesCount={pendingExpenses.length}
        gmailRefreshTimestamp={gmailRefreshTimestamp}
        gmailRefreshVerb={gmailRefreshVerb}
        formatRelativeTime={formatRelativeTime}
        formatDate={formatDate}
        onPressSeeAll={() => router.navigate('/')}
        onPressExpense={(expenseId) => router.push(`/expense/${expenseId}`)}
        onDeleteExpense={deleteExpense}
      />
    </ScrollView>

    <SummaryMonthPicker
      styles={styles}
      visible={showMonthPicker}
      onClose={() => setShowMonthPicker(false)}
      months={getPastMonths()}
      selectedMonth={selectedMonth}
      onSelectMonth={(month) => {
        setSelectedMonth(month);
        setShowMonthPicker(false);
      }}
      periodLabel={periodLabel}
      startDay={startDay}
    />
    <GlobalAddLauncher router={router} bottomOffset={24} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0a0a0a' },
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingTop: 16, paddingBottom: 48 },

  spendCard: { marginBottom: 18 },
  globalHeader: { marginBottom: 12 },
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

  householdCard: { marginBottom: 24 },
  householdRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  householdLabel: { fontSize: 12, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 },
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
  insightsErrorCard: {
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
    gap: 4,
  },
  insightsErrorTitle: { color: '#f5f5f5', fontSize: 15, fontWeight: '600' },
  insightsErrorBody: { color: '#a3a3a3', fontSize: 13, lineHeight: 18 },
  insightsErrorAction: { color: '#d4d4d4', fontSize: 12, fontWeight: '600', marginTop: 4 },
  insightsRail: { paddingRight: 20, gap: 12 },
  insightsRailSingle: { paddingRight: 0 },
  insightEmptyCard: {
    marginBottom: 28,
    backgroundColor: '#111214',
    borderColor: '#20252b',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  insightEmptyEyebrow: {
    color: '#8894a1',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  insightEmptyTitle: {
    color: '#f5f5f5',
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
  },
  insightEmptyBody: {
    color: '#acb7c3',
    fontSize: 14,
    lineHeight: 20,
  },
  insightEmptyAction: {
    color: '#e5eef8',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  watchingCard: {
    marginTop: 12,
    marginBottom: 28,
    backgroundColor: '#0f1114',
    borderWidth: 1,
    borderColor: '#1a2027',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
  },
  watchingText: { flex: 1, gap: 4 },
  watchingTitle: { color: '#dde8f2', fontSize: 16, fontWeight: '700' },
  watchingMeta: { color: '#8fa0b2', fontSize: 13 },
  watchingBody: { color: '#afc0d5', fontSize: 14, lineHeight: 19, marginTop: 4 },
  watchingNote: { color: '#9cc3de', fontSize: 12, lineHeight: 17, marginTop: 4 },
  watchingCTA: {
    backgroundColor: '#171b20',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  watchingCTAText: { color: '#dde8f2', fontSize: 13, fontWeight: '700' },
  sectionLabel: { fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
  sectionLabelCompact: { fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: '600' },
  inputRow: { flexDirection: 'row', gap: 8 },
  entryModeToggle: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: '#111',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 2,
    marginBottom: 10,
  },
  entryModeChip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  entryModeChipActive: {
    backgroundColor: '#f5f5f5',
  },
  entryModeChipText: {
    fontSize: 13,
    color: '#9b9b9b',
    fontWeight: '700',
  },
  entryModeChipTextActive: {
    color: '#000',
  },
  entryModeMeta: { fontSize: 13, color: '#718295', marginBottom: 12, lineHeight: 18 },
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
  quickEntryProcessing: {
    marginTop: 10,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quickEntryProcessingText: { color: '#cfcfcf', fontSize: 12, flex: 1, lineHeight: 17 },
  entryModeSpacer: { height: 24, marginTop: 10 },

  recent: {},
  recentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  recentHeading: { flex: 1, gap: 4, paddingRight: 12 },
  recentMeta: { fontSize: 12, color: '#666' },
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
