import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Modal, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useMonth, periodLabel, currentPeriod } from '../../contexts/MonthContext';
import { useState, useCallback, useEffect, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { useExpenses } from '../../hooks/useExpenses';
import { useHouseholdExpenses } from '../../hooks/useHouseholdExpenses';
import { useBudget } from '../../hooks/useBudget';
import { useHousehold } from '../../hooks/useHousehold';
import { usePendingExpenses } from '../../hooks/usePendingExpenses';
import { useInsights } from '../../hooks/useInsights';
import { api } from '../../services/api';
import { GlobalPeriodHeader } from '../../components/GlobalPeriodHeader';
import { InsightCard } from '../../components/InsightCard';
import { createManualExpenseDraft } from '../../services/manualExpenseDraft';
import { toLocalDateString } from '../../services/date';
import { buildMockInsights } from '../../fixtures/mockInsights';
import { buildMockGmailImportState } from '../../fixtures/mockGmailImport';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MOCK_GMAIL_IMPORT_SUMMARY = buildMockGmailImportState().importSummary;

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
  if (minutes === 1) return '1m ago';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1h ago';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

function insightEventMetadata(insight, surface = 'summary') {
  return {
    surface,
    type: insight?.type || null,
    insight_type: insight?.type || null,
    maturity: insight?.metadata?.maturity || null,
    confidence: insight?.metadata?.confidence || null,
    scope: insight?.metadata?.scope || null,
    entity_type: insight?.entity_type || null,
    entity_id: insight?.entity_id || null,
    category_key: insight?.metadata?.category_key || null,
    merchant_key: insight?.metadata?.merchant_key || null,
    scope_relationship: insight?.metadata?.scope_relationship || null,
    consolidated_scopes: insight?.metadata?.consolidated_scopes || null,
    related_insight_ids: insight?.metadata?.related_insight_ids || null,
  };
}

function parseScenarioInput(raw, { allowHousehold = false } = {}) {
  const trimmed = `${raw || ''}`.trim();
  if (!trimmed) return null;

  let normalized = trimmed.toLowerCase();
  normalized = normalized.replace(/^(can i afford|could i afford|check|scenario)\s+/i, '');
  let timingMode = 'now';

  if (/\b(next month|next period)\b/i.test(normalized)) {
    timingMode = 'next_period';
    normalized = normalized.replace(/\b(next month|next period)\b/gi, ' ');
  } else if (/\b(spread( it)? over (a few|few|3|three) months?|over (a few|few|3|three) months?)\b/i.test(normalized)) {
    timingMode = 'spread_3_periods';
    normalized = normalized.replace(/\b(spread( it)? over (a few|few|3|three) months?|over (a few|few|3|three) months?)\b/gi, ' ');
  }

  let scope = 'personal';
  if (allowHousehold && normalized.startsWith('household ')) {
    scope = 'household';
    normalized = normalized.slice('household '.length);
  } else if (normalized.startsWith('mine ')) {
    scope = 'personal';
    normalized = normalized.slice('mine '.length);
  }

  const amountMatch = normalized.match(/(\d+(?:\.\d{1,2})?)/);
  if (!amountMatch) return null;
  const amount = amountMatch[1];
  const amountIndex = amountMatch.index || 0;
  const before = normalized.slice(0, amountIndex).trim();
  const after = normalized.slice(amountIndex + amount.length).trim();
  const label = `${before} ${after}`.replace(/\s+/g, ' ').trim();

  return {
    amount,
    label,
    scope,
    timingMode,
  };
}

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
  } = useInsights(3);
  const [dismissedMockInsightIds, setDismissedMockInsightIds] = useState([]);
  const [entryMode, setEntryMode] = useState('add');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [gmailImportSummary, setGmailImportSummary] = useState(null);
  const [watchedPlans, setWatchedPlans] = useState([]);
  const currentMonthStr = selectedMonth || currentPeriod(startDay);
  const watchedHouseholdCount = watchedPlans.filter((plan) => plan.scope === 'household').length;
  const watchedPersonalCount = watchedPlans.filter((plan) => plan.scope !== 'household').length;
  const displayInsights = __DEV__ && insights.length === 0
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
  ]));

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
    const isMockInsight = __DEV__ && insights.length === 0;
    if (!isMockInsight) {
      await logEvents([{
        insight_id: insight.id,
        event_type: 'tapped',
        metadata: insightEventMetadata(insight),
      }]);
    }

    if (insight?.entity_type === 'item' && insight?.metadata?.group_key) {
      router.push({
        pathname: '/recurring-item',
        params: {
          group_key: insight.metadata.group_key,
          scope: insight.metadata.scope || 'personal',
          title: insight.metadata.item_name || insight.title,
          insight_id: insight.id,
          insight_type: insight.type,
          body: insight.body,
          metadata: JSON.stringify(insight.metadata || {}),
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
      router.push({
        pathname: '/scenario-check',
        params: {
          scope: insight.metadata?.scope || 'personal',
          month: insight.metadata?.month || currentMonthStr,
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
      router.push({
        pathname: '/trend-detail',
        params: {
          scope: insight.metadata?.scope || 'personal',
          month: insight.metadata?.month,
          insight_type: insight.type,
          category_key: insight.metadata?.category_key || '',
          insight_metadata: JSON.stringify(insight.metadata || {}),
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
          metadata: JSON.stringify(insight.metadata || {}),
        },
      });
      return;
    }

    Alert.alert(insight.title, insight.body);
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

  function startManualEntry() {
    setInput('');
    router.push({
      pathname: '/confirm',
      params: { data: JSON.stringify(createManualExpenseDraft()) },
    });
  }

  async function handleQuickAdd() {
    if (!input.trim()) return;
    try {
      setLoading(true);
      const today = toLocalDateString();
      const parsed = await api.post('/expenses/parse', { input: input.trim(), today });
      setInput('');
      router.push({ pathname: '/confirm', params: { data: JSON.stringify({ ...parsed, source: 'manual' }) } });
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('Could not parse')) {
        Alert.alert(
          "Couldn't parse that",
          "Try: '84.50 trader joes' or 'lunch 14'",
          [
            { text: 'Keep editing', style: 'cancel' },
            { text: 'Start from scratch', onPress: startManualEntry },
          ]
        );
      } else {
        Alert.alert('Error', msg || 'Something went wrong. Check your connection.');
      }
    } finally {
      setLoading(false);
    }
  }

  function handleQuickCheck() {
    return runQuickCheck();
  }

  async function runQuickCheck() {
    const parsed = parseScenarioInput(input, { allowHousehold: isMultiMember });
    if (!parsed?.amount) {
      Alert.alert("Couldn't parse that", "Try: '180 running shoes' or 'household 240 costco run'");
      return false;
    }
    try {
      setLoading(true);
      const data = await api.post('/trends/scenario-check', {
        scope: parsed.scope,
        month: currentMonthStr,
        proposed_amount: Number(parsed.amount),
        label: parsed.label || 'purchase',
        timing_mode: parsed.timingMode || 'now',
      });
      setInput('');
      router.push({
        pathname: '/scenario-check',
        params: {
          month: currentMonthStr,
          scope: parsed.scope,
          amount: parsed.amount,
          label: parsed.label,
          timing_mode: parsed.timingMode || 'now',
          initial_result: JSON.stringify(data),
        },
      });
      return true;
    } catch (err) {
      Alert.alert('Could not run plan', err?.message || 'Something went wrong. Check your connection.');
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handlePrimaryEntry() {
    if (entryMode === 'check') {
      await handleQuickCheck();
      return;
    }
    await handleQuickAdd();
  }

  const quickEntryProcessingMessage = loading
    ? (entryMode === 'check'
      ? 'Checking this plan against your current month...'
      : 'Parsing your expense...')
    : null;

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

      {/* Quick Add */}
      <View style={styles.quickAdd}>
        <Text style={styles.sectionLabel}>Quick entry</Text>
        <View style={styles.entryModeToggle}>
          <TouchableOpacity
            style={[styles.entryModeChip, entryMode === 'add' && styles.entryModeChipActive]}
            onPress={() => setEntryMode('add')}
          >
            <Text style={[styles.entryModeChipText, entryMode === 'add' && styles.entryModeChipTextActive]}>Add</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.entryModeChip, entryMode === 'check' && styles.entryModeChipActive]}
            onPress={() => setEntryMode('check')}
          >
            <Text style={[styles.entryModeChipText, entryMode === 'check' && styles.entryModeChipTextActive]}>Plan</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.entryModeMeta}>
          {entryMode === 'check'
            ? 'Pressure-test a purchase against your current spending outlook.'
            : 'Tell me what you bought.'}
        </Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={entryMode === 'check'
              ? '180 running shoes · can i afford 240 air fryer?'
              : '84.50 trader joes · lunch 14 · gas 60 yesterday'}
            placeholderTextColor="#555"
            onSubmitEditing={handlePrimaryEntry}
            autoCorrect={false}
            returnKeyType={entryMode === 'check' ? 'go' : 'done'}
            editable={!loading}
          />
          <TouchableOpacity style={styles.addBtn} onPress={handlePrimaryEntry} disabled={loading || !input.trim()}>
            {loading
              ? <ActivityIndicator color="#000" size="small" />
              : <Ionicons name="arrow-forward" size={18} color="#000" />}
          </TouchableOpacity>
        </View>
        {quickEntryProcessingMessage ? (
          <View style={styles.quickEntryProcessing}>
            <ActivityIndicator color="#d4d4d4" size="small" />
            <Text style={styles.quickEntryProcessingText}>{quickEntryProcessingMessage}</Text>
          </View>
        ) : null}
        {entryMode === 'add' ? (
          <TouchableOpacity
            style={styles.scanLink}
            onPress={() => router.push({ pathname: '/(tabs)/add', params: { auto_scan: '1' } })}
          >
            <Ionicons name="camera-outline" size={14} color="#888" />
            <Text style={styles.scanLinkText}>scan a receipt</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.entryModeSpacer} />
        )}
      </View>

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
          </View>
          <View style={styles.watchingCTA}>
            <Text style={styles.watchingCTAText}>See plans</Text>
          </View>
        </TouchableOpacity>
      ) : null}

      {(displayInsights.length > 0 || insightsError) && (
        <View style={styles.insightsSection}>
          <View style={styles.insightsHeading}>
            <Text style={styles.sectionLabel}>Insights</Text>
            {displayInsights.length > 1 ? (
              <Text style={styles.insightsHint}>Swipe for more</Text>
            ) : null}
          </View>
          {insightsError ? (
            <TouchableOpacity style={styles.insightsErrorCard} onPress={refreshInsights} activeOpacity={0.85}>
              <Text style={styles.insightsErrorTitle}>Couldn’t load insights</Text>
              <Text style={styles.insightsErrorBody}>{insightsError}</Text>
              <Text style={styles.insightsErrorAction}>Tap to retry</Text>
            </TouchableOpacity>
          ) : null}
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
              <InsightCard
                key={insight.id}
                insight={insight}
                width={insightCardWidth}
                onPress={handlePressInsight}
                onDismiss={handleDismissInsight}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Recent activity */}
      <View style={styles.recent}>
        <View style={styles.recentHeader}>
          <View style={styles.recentHeading}>
            <Text style={styles.sectionLabelCompact}>Recent</Text>
            <Text style={styles.recentMeta}>
              {`${pendingExpenses.length} pending`}
              {gmailRefreshTimestamp ? ` · Gmail ${gmailRefreshVerb} ${formatRelativeTime(gmailRefreshTimestamp)}` : ''}
            </Text>
          </View>
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
        {recent.length === 0 && (
          <Text style={styles.emptyText}>No confirmed expenses yet.</Text>
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
  quickAdd: { marginTop: 18, marginBottom: 32 },
  watchingCard: {
    marginTop: -6,
    marginBottom: 28,
    backgroundColor: '#101216',
    borderWidth: 1,
    borderColor: '#1d2730',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
  },
  watchingText: { flex: 1, gap: 4 },
  watchingTitle: { color: '#dde8f2', fontSize: 16, fontWeight: '700' },
  watchingMeta: { color: '#8fa0b2', fontSize: 13 },
  watchingBody: { color: '#afc0d5', fontSize: 14, lineHeight: 19, marginTop: 4 },
  watchingCTA: {
    backgroundColor: '#f5f5f5',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  watchingCTAText: { color: '#000', fontSize: 13, fontWeight: '700' },
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
