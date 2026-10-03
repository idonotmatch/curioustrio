import { View, Text, ScrollView, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useMonth, periodLabel, currentPeriod } from '../../contexts/MonthContext';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useSummaryBundle } from '../../hooks/useSummaryBundle';
import { useInsights } from '../../hooks/useInsights';
import { GlobalPeriodHeader } from '../../components/GlobalPeriodHeader';
import { SummaryInsightsRail } from '../../components/SummaryInsightsRail';
import { SummaryMonthPicker } from '../../components/SummaryMonthPicker';
import { requestGlobalAddLauncher } from '../../services/globalAddLauncherBus';
import { stashNavigationPayload } from '../../services/navigationPayloadStore';
import { saveInsightDetailSnapshot } from '../../services/insightLocalStore';
import { loadSummarySnapshot, saveSummarySnapshot } from '../../services/summarySnapshot';
import {
  getPastMonths,
  insightEventMetadata,
  buildRecurringItemPreload,
  buildPreloadedCategoryExpenses,
  buildPreloadedInsightEvidence,
} from '../../services/summaryScreenHelpers';
import { buildMockInsights } from '../../fixtures/mockInsights';
import { INTERNAL_TOOLS_ENABLED } from '../../services/internalTools';
import { colors } from '../../theme/tokens';

const TREND_INSIGHT_TYPES = new Set([
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
const EARLY_DEVELOPING_INSIGHT_TYPES = new Set([
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

export default function SummaryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { width: windowWidth } = useWindowDimensions();
  const { selectedMonth, setSelectedMonth, startDay } = useMonth();
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const currentMonthStr = selectedMonth || currentPeriod(startDay);
  const [summarySnapshot, setSummarySnapshot] = useState(null);
  const { summary, loading: summaryLoading, refresh: refreshSummary } = useSummaryBundle(currentMonthStr, startDay);
  const household = summary?.household || null;
  const memberCount = Number(summary?.member_count || 0);
  const isMultiMember = memberCount > 1;
  const personalBudget = summary?.personal_budget || null;
  const householdBudget = summary?.household_budget || null;
  const expenses = summary?.expenses || summarySnapshot?.expenses || [];
  const householdExpenses = summary?.household_expenses || summarySnapshot?.household_expenses || [];
  const watchedPlans = summary?.watched_plans || summarySnapshot?.watched_plans || [];
  const {
    insights,
    loading: insightsLoading,
    error: insightsError,
    refresh: refreshInsights,
    markSeen,
    dismiss: dismissInsight,
    logEvents,
  } = useInsights(5, { freezeFirstPaint: true });
  const [dismissedMockInsightIds, setDismissedMockInsightIds] = useState([]);
  const [allowMockInsights, setAllowMockInsights] = useState(__DEV__);
  const hasSnapshot = !!summarySnapshot;
  const usingSnapshotBudget = hasSnapshot && summaryLoading && !personalBudget;
  const usingSnapshotExpenses = hasSnapshot && summaryLoading && (expenses || []).length === 0;
  const usingSnapshotHouseholdExpenses = hasSnapshot && summaryLoading && (householdExpenses || []).length === 0;
  const usingSnapshotWatchedPlans = hasSnapshot && summaryLoading && watchedPlans.length === 0;
  const displayPersonalBudget = personalBudget || summarySnapshot?.personal_budget || null;
  const displayHouseholdBudget = householdBudget || summarySnapshot?.household_budget || null;
  const displayExpensesForSummary = usingSnapshotExpenses ? (summarySnapshot?.expenses || []) : (expenses || []);
  const displayHouseholdExpensesForSummary = usingSnapshotHouseholdExpenses ? (summarySnapshot?.household_expenses || []) : (householdExpenses || []);
  const displayWatchedPlans = usingSnapshotWatchedPlans ? (summarySnapshot?.watched_plans || []) : watchedPlans;
  const watchedHouseholdCount = displayWatchedPlans.filter((plan) => plan.scope === 'household').length;
  const watchedPersonalCount = displayWatchedPlans.filter((plan) => plan.scope !== 'household').length;
  const watchedPreferenceNote = displayWatchedPlans.find((plan) => plan?.timing_preference_note)?.timing_preference_note || '';
  const displayInsights = useMemo(() => (
    allowMockInsights && !insightsLoading && insights.length === 0
      ? buildMockInsights(currentMonthStr).filter((insight) => !dismissedMockInsightIds.includes(insight.id))
      : insights
  ), [allowMockInsights, currentMonthStr, dismissedMockInsightIds, insights, insightsLoading]);
  const hasMultipleInsights = displayInsights.length > 1;
  const insightCardWidth = displayInsights.length <= 1
    ? Math.max(0, windowWidth - 40)
    : Math.max(280, windowWidth - 88);
  const loggedShownInsightIds = useRef(new Set());
  const insightNavigationResetRef = useRef(null);
  const [openingInsightId, setOpeningInsightId] = useState('');
  const [showWelcomeAddCard, setShowWelcomeAddCard] = useState(params.welcome === 'add_expense');

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

  useFocusEffect(useCallback(() => {
    releaseInsightNavigationLock();
    refreshSummary();
    refreshInsights({ reason: 'summary_focus' });
  }, [
    refreshSummary,
    refreshInsights,
    releaseInsightNavigationLock,
  ]));

  useEffect(() => {
    let active = true;
    setSummarySnapshot(null);
    loadSummarySnapshot(currentMonthStr, startDay).then((snapshot) => {
      if (!active) return;
      setSummarySnapshot(snapshot);
    });
    return () => {
      active = false;
    };
  }, [currentMonthStr, startDay]);

  useEffect(() => {
    const hasLiveData = summary
      || personalBudget
      || householdBudget
      || (expenses || []).length > 0
      || (householdExpenses || []).length > 0
      || watchedPlans.length > 0
      || displayInsights.length > 0;
    if (!hasLiveData) return;
    saveSummarySnapshot(currentMonthStr, startDay, {
      personalBudget,
      householdBudget,
      expenses,
      householdExpenses,
      watchedPlans,
      insights: displayInsights,
    }).then((snapshot) => {
      if (snapshot) setSummarySnapshot(snapshot);
    });
  }, [
    currentMonthStr,
    startDay,
    personalBudget,
    householdBudget,
    expenses,
    householdExpenses,
    watchedPlans,
    displayInsights,
    summary,
  ]);

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

  useEffect(() => {
    if (params.welcome === 'add_expense') {
      setShowWelcomeAddCard(true);
    }
  }, [params.welcome]);

  const handleRetryInsights = useCallback(() => {
    refreshInsights({ force: true, reason: 'manual_retry' });
  }, [refreshInsights]);

  const handleDismissInsight = useCallback((insight) => {
    if (__DEV__ && insights.length === 0) {
      setDismissedMockInsightIds((current) => [...current, insight.id]);
      return;
    }
    dismissInsight(insight.id, insightEventMetadata(insight));
  }, [dismissInsight, insights.length]);

  const handlePressInsight = useCallback(async (insight) => {
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

    if (TREND_INSIGHT_TYPES.has(insight?.type) && insight?.metadata?.month) {
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

    if (EARLY_DEVELOPING_INSIGHT_TYPES.has(insight?.type)) {
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
  }, [
    currentMonthStr,
    expenses,
    householdExpenses,
    insights.length,
    lockInsightNavigation,
    logEvents,
    openingInsightId,
    router,
  ]);

  const handleActionInsight = useCallback((insight, cardAction) => {
    if (!insight?.id || openingInsightId) return;
    if (!cardAction?.route) {
      handlePressInsight(insight);
      return;
    }
    lockInsightNavigation(insight.id);
    if (!(__DEV__ && insights.length === 0)) {
      logEvents([{
        insight_id: insight.id,
        event_type: 'acted',
        metadata: {
          ...insightEventMetadata(insight),
          action_label: cardAction.label || null,
          action_target: typeof cardAction.route === 'string' ? cardAction.route : cardAction.route.pathname,
        },
      }]).catch(() => {});
    }
    router.push(cardAction.route);
  }, [handlePressInsight, insights.length, lockInsightNavigation, logEvents, openingInsightId, router]);

  const spent = Number(displayPersonalBudget?.total?.spent || 0);
  const householdSpent = Number(displayHouseholdBudget?.total?.spent || 0);
  const limit = displayPersonalBudget?.total?.limit ?? 0;
  const pct = limit ? Math.min(spent / limit, 1) : 0;
  const over = limit > 0 && spent > limit;

  const hLimit = displayHouseholdBudget?.total?.limit ?? 0;
  const hSpent = householdSpent;
  const hPct = hLimit ? Math.min(hSpent / hLimit, 1) : 0;
  const hOver = hLimit > 0 && hSpent > hLimit;
  const hasAnyLoggedExpenses = (displayExpensesForSummary || []).length > 0 || (displayHouseholdExpensesForSummary || []).length > 0;
  const hasBudget = Number(limit || 0) > 0 || Number(hLimit || 0) > 0;
  const watchedImprovedCount = displayWatchedPlans.filter((plan) => plan.last_material_change === 'improved').length;
  const watchedWorsenedCount = displayWatchedPlans.filter((plan) => plan.last_material_change === 'worsened').length;

  function openQuickAddWelcome() {
    setShowWelcomeAddCard(false);
    requestGlobalAddLauncher();
  }

  function openBudgetSetup() {
    router.push('/budget-period');
  }

  function openGmailSetup() {
    router.push('/gmail-import');
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
              <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: over ? colors.danger : colors.success }]} />
            </View>
            <Text style={styles.barLabel}>
              {over
                ? `$${(spent - limit).toFixed(0)} over budget`
                : `$${(limit - spent).toFixed(0)} left · ${Math.round(pct * 100)}% used`}
            </Text>
          </>
        )}

        {!limit && (
          <TouchableOpacity style={styles.setBudgetLinkRow} onPress={() => router.push('/(tabs)/settings')} activeOpacity={0.82}>
            <Text style={styles.setBudgetLink}>Set a monthly budget</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {showWelcomeAddCard ? (
        <View style={styles.welcomeCard}>
          <View style={styles.welcomeTopRow}>
            <Text style={styles.welcomeEyebrow}>Start here</Text>
            <TouchableOpacity onPress={() => setShowWelcomeAddCard(false)} hitSlop={8}>
              <Ionicons name="close" size={16} color={colors.textSubtle} />
            </TouchableOpacity>
          </View>
          <Text style={styles.welcomeTitle}>Log one thing you spent.</Text>
          <Text style={styles.welcomeBody}>
            That first expense is enough to make the rest of Adlo start feeling useful.
          </Text>
          <TouchableOpacity style={styles.welcomeButton} onPress={openQuickAddWelcome} activeOpacity={0.86}>
            <Text style={styles.welcomeButtonText}>Open quick add</Text>
          </TouchableOpacity>
        </View>
      ) : null}

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
              <View style={[styles.hBarFill, { width: `${hPct * 100}%`, backgroundColor: hOver ? colors.danger : colors.success }]} />
            </View>
          )}
          {hOver && <Text style={styles.hOverLabel}>${(hSpent - hLimit).toFixed(0)} over</Text>}
        </View>
      )}

      <SummaryInsightsRail
        styles={styles}
        displayInsights={displayInsights}
        loading={insightsLoading}
        insightsError={insightsError}
        refreshInsights={handleRetryInsights}
        hasMultipleInsights={hasMultipleInsights}
        insightCardWidth={insightCardWidth}
        handlePressInsight={handlePressInsight}
        handleActionInsight={handleActionInsight}
        handleDismissInsight={handleDismissInsight}
        openingInsightId={openingInsightId}
        title="What matters now"
        hint="Swipe for more"
      />

      {displayInsights.length === 0 && !insightsError && !showWelcomeAddCard ? (
        <View style={styles.insightEmptyCard}>
          <Text style={styles.insightEmptyEyebrow}>What matters now</Text>
          <Text style={styles.insightEmptyTitle}>
            {hasAnyLoggedExpenses ? 'Nothing strong enough is surfacing yet' : 'Give Adlo one more signal'}
          </Text>
          <Text style={styles.insightEmptyBody}>
            {INTERNAL_TOOLS_ENABLED
              ? 'That can mean Adlo does not have any strong signals yet, or that current candidates are being filtered out. Open diagnostics to see which one it is.'
              : hasAnyLoggedExpenses
                ? 'That usually means the current patterns are still too quiet or too mixed to deserve a card. A little more activity will usually make this area sharper.'
                : 'The fastest ways to make this area useful are to log an expense, set a budget, or connect Gmail so Adlo has something real to learn from.'}
          </Text>
          {!INTERNAL_TOOLS_ENABLED ? (
            <View style={styles.insightEmptyActions}>
              <TouchableOpacity activeOpacity={0.88} style={styles.insightEmptyPrimaryButton} onPress={openQuickAddWelcome}>
                <Text style={styles.insightEmptyPrimaryButtonText}>Open quick add</Text>
              </TouchableOpacity>
              <View style={styles.insightEmptySecondaryRow}>
                {!hasBudget ? (
                  <TouchableOpacity activeOpacity={0.88} style={styles.insightEmptySecondaryButton} onPress={openBudgetSetup}>
                    <Text style={styles.insightEmptySecondaryText}>Set budget</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity activeOpacity={0.88} style={styles.insightEmptySecondaryButton} onPress={openGmailSetup}>
                  <Text style={styles.insightEmptySecondaryText}>Connect Gmail</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
          {INTERNAL_TOOLS_ENABLED ? (
            <TouchableOpacity activeOpacity={0.88} onPress={() => router.push('/diagnostics')}>
              <Text style={styles.insightEmptyAction}>Open diagnostics</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {displayWatchedPlans.length > 0 ? (
        <TouchableOpacity
          style={styles.watchingCard}
          activeOpacity={0.88}
          onPress={() => router.push('/watching-plans')}
        >
          <View style={styles.watchingText}>
            <Text style={styles.watchingTitle}>Watching</Text>
            <Text style={styles.watchingMeta}>
              {displayWatchedPlans.length} active {displayWatchedPlans.length === 1 ? 'plan' : 'plans'}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingTop: 16, paddingBottom: 48 },

  spendCard: { marginBottom: 18 },
  globalHeader: { marginBottom: 12 },
  spendNumbers: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 },
  spendLabel: { fontSize: 13, color: colors.textSubtle, marginBottom: 2 },
  spendAmount: { fontSize: 48, color: colors.text, fontWeight: '600', letterSpacing: -2 },
  spendOver: { color: colors.danger },
  spendRight: { alignItems: 'flex-end' },
  budgetAmount: { fontSize: 22, color: colors.textSubtle, fontWeight: '500', letterSpacing: -0.5 },
  barTrack: { height: 2, backgroundColor: colors.textInverse, borderRadius: 1, marginBottom: 8 },
  barFill: { height: 2, borderRadius: 1 },
  barLabel: { fontSize: 13, color: colors.textSubtle },
  setBudgetLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, alignSelf: 'flex-start' },
  setBudgetLink: { fontSize: 14, color: colors.textMuted, fontWeight: '600' },
  welcomeCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 22,
  },
  welcomeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  welcomeEyebrow: {
    color: colors.textSubtle,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  welcomeTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  welcomeBody: {
    color: colors.textSubtle,
    fontSize: 14,
    lineHeight: 20,
  },
  welcomeButton: {
    marginTop: 14,
    alignSelf: 'flex-start',
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeButtonText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '700',
  },

  householdCard: { marginBottom: 24 },
  householdRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  householdLabel: { fontSize: 12, color: colors.textDisabled, textTransform: 'uppercase', letterSpacing: 0.5 },
  householdNumbers: { flexDirection: 'row', alignItems: 'baseline' },
  householdSpent: { fontSize: 16, color: colors.text, fontWeight: '600', letterSpacing: -0.3 },
  householdOver: { color: colors.danger },
  householdLimit: { fontSize: 13, color: colors.textDisabled },
  hBarTrack: { height: 2, backgroundColor: colors.textInverse, borderRadius: 1 },
  hBarFill: { height: 2, borderRadius: 1 },
  hOverLabel: { fontSize: 12, color: colors.danger, marginTop: 4 },

  insightsSection: { marginBottom: 32 },
  insightsHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  insightsHint: { fontSize: 12, color: colors.textDisabled },
  insightsErrorCard: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
    gap: 4,
  },
  insightsErrorTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  insightsErrorBody: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  insightsErrorAction: { color: colors.textMuted, fontSize: 12, fontWeight: '600', marginTop: 4 },
  insightsRail: { paddingRight: 20, gap: 12 },
  insightsRailSingle: { paddingRight: 0 },
  insightsDots: { flexDirection: 'row', gap: 6, marginTop: 12, alignSelf: 'center' },
  insightsDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.borderStrong,
  },
  insightsDotActive: {
    width: 18,
    backgroundColor: colors.accent,
  },
  insightSkeletonCard: {
    minHeight: 184,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    paddingHorizontal: 17,
    paddingVertical: 14,
    gap: 10,
  },
  insightSkeletonMetaRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  insightSkeletonChip: { width: 86, height: 24, borderRadius: 999, backgroundColor: colors.surfaceRaised },
  insightSkeletonChipShort: { width: 58, height: 24, borderRadius: 999, backgroundColor: colors.surfaceRaised },
  insightSkeletonTitle: { width: '76%', height: 18, borderRadius: 5, backgroundColor: colors.surfaceRaised },
  insightSkeletonTitleShort: { width: '58%', height: 18, borderRadius: 5, backgroundColor: colors.surfaceRaised },
  insightSkeletonBody: { width: '88%', height: 12, borderRadius: 5, backgroundColor: colors.surfaceMuted, marginTop: 8 },
  insightSkeletonBodyShort: { width: '64%', height: 12, borderRadius: 5, backgroundColor: colors.surfaceMuted },
  insightSkeletonFooter: { width: '38%', height: 14, borderRadius: 5, backgroundColor: colors.surfaceRaised, marginTop: 'auto' },
  insightEmptyCard: {
    marginBottom: 28,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  insightEmptyEyebrow: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  insightEmptyTitle: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
  },
  insightEmptyBody: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  insightEmptyAction: {
    color: colors.info,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  insightEmptyActions: {
    gap: 10,
    marginTop: 8,
  },
  insightEmptyPrimaryButton: {
    alignSelf: 'flex-start',
    minHeight: 40,
    borderRadius: 8,
    paddingHorizontal: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightEmptyPrimaryButtonText: {
    color: colors.textInverse,
    fontSize: 13,
    fontWeight: '800',
  },
  insightEmptySecondaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  insightEmptySecondaryButton: {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.infoMuted,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  insightEmptySecondaryText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  watchingCard: {
    marginTop: 12,
    marginBottom: 28,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.infoMuted,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
  },
  watchingText: { flex: 1, gap: 4 },
  watchingTitle: { color: colors.textMuted, fontSize: 16, fontWeight: '700' },
  watchingMeta: { color: colors.textSubtle, fontSize: 13 },
  watchingBody: { color: colors.text, fontSize: 14, lineHeight: 19, marginTop: 4 },
  watchingNote: { color: colors.info, fontSize: 12, lineHeight: 17, marginTop: 4 },
  watchingCTA: {
    backgroundColor: colors.surfacePressed,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  watchingCTAText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  sectionLabel: { fontSize: 12, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
  sectionLabelCompact: { fontSize: 12, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: '600' },
  inputRow: { flexDirection: 'row', gap: 8 },
  entryModeToggle: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.textInverse,
    padding: 2,
    marginBottom: 10,
  },
  entryModeChip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  entryModeChipActive: {
    backgroundColor: colors.accent,
  },
  entryModeChipText: {
    fontSize: 13,
    color: colors.textSubtle,
    fontWeight: '700',
  },
  entryModeChipTextActive: {
    color: colors.textInverse,
  },
  entryModeMeta: { fontSize: 13, color: colors.textSubtle, marginBottom: 12, lineHeight: 18 },
  input: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 13,
    color: colors.text, fontSize: 15,
    borderWidth: 1, borderColor: colors.textInverse,
  },
  addBtn: {
    backgroundColor: colors.accent, borderRadius: 10,
    width: 46, justifyContent: 'center', alignItems: 'center',
  },
  scanLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  scanLinkText: { fontSize: 14, color: colors.textSubtle },
  quickEntryProcessing: {
    marginTop: 10,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quickEntryProcessingText: { color: colors.textMuted, fontSize: 12, flex: 1, lineHeight: 17 },
  entryModeSpacer: { height: 24, marginTop: 10 },

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
