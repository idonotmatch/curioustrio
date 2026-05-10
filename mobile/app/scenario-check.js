import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useMonth, currentPeriod, periodLabel } from '../contexts/MonthContext';
import { useHousehold } from '../hooks/useHousehold';
import { api } from '../services/api';
import { FRESHNESS_DOMAINS, markFreshnessStale } from '../services/freshnessRegistry';
import { DismissKeyboardScrollView } from '../components/DismissKeyboardScrollView';
import { consumeNavigationPayload } from '../services/navigationPayloadStore';
import {
  planningActionSummary,
  planningSnapshot,
  planningSuggestionAmounts,
  planningFeedbackSummary,
  recentPlanDecisionSummary,
  recentPlanResolutionSummary,
} from '../services/planningPresentation';
import { colors } from '../theme/tokens';
import {
  confidenceCopy,
  formatAmountInput,
  formatScenarioCurrency as formatCurrency,
  optionMetricCopy,
  optionTradeoffCopy,
  projectionDeltaCopy,
  reasonCopy,
  recommendationButtonLabel,
  recentPlanChangeCopy,
  recentPlanMetaCopy,
  recentPlanStatusCopy,
  recentPlanWhyChangedCopy,
  scopeContextCopy,
  scopeLabel,
  statusConfig,
  timingModeLabel,
} from '../services/scenarioCheckPresentation';

export default function ScenarioCheckScreen() {
  const params = useLocalSearchParams();
  const payloadKey = typeof params.payload_key === 'string' ? params.payload_key : Array.isArray(params.payload_key) ? params.payload_key[0] : '';
  const preloadedPayload = useMemo(() => consumeNavigationPayload(payloadKey, null), [payloadKey]);
  const planningInsight = preloadedPayload?.planningInsight || null;
  const planningSeed = planningInsight?.metadata || {};
  const planningSeedSummary = planningActionSummary(planningSeed);
  const planningSeedSnapshot = planningSnapshot(planningSeed);
  const starterAmounts = planningSuggestionAmounts(planningSeed);
  const { selectedMonth, startDay } = useMonth();
  const { memberCount } = useHousehold();
  const isMultiMember = memberCount > 1;
  const targetMonth = `${params.month || selectedMonth || currentPeriod(startDay)}`;
  const [amount, setAmount] = useState(typeof params.amount === 'string' ? params.amount : '');
  const [label, setLabel] = useState(typeof params.label === 'string' ? params.label : '');
  const [scope, setScope] = useState(
    params.scope === 'household' && isMultiMember ? 'household' : 'personal'
  );
  const [timingMode, setTimingMode] = useState(
    ['next_period', 'spread_3_periods'].includes(params.timing_mode) ? params.timing_mode : 'now'
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [scenarioMemory, setScenarioMemory] = useState(null);
  const [recentPlans, setRecentPlans] = useState([]);
  const [intentLoading, setIntentLoading] = useState('');
  const [watchLoading, setWatchLoading] = useState(false);
  const [resolutionLoading, setResolutionLoading] = useState('');
  const [showComposer, setShowComposer] = useState(false);
  const [plannerFeedback, setPlannerFeedback] = useState(null);
  const autoRanRef = useRef(false);
  const bootstrappedInitialResultRef = useRef(false);

  const parsedAmount = Number(amount);
  const canSubmit = Number.isFinite(parsedAmount) && parsedAmount > 0 && !loading;
  const scenario = result?.scenario || null;
  const isAutoRunning = `${params.auto_run}` === '1' && !scenario && loading;
  const projection = result?.projection?.overall || null;
  const timingOptions = Array.isArray(scenario?.options) ? scenario.options : [];
  const currentHeadroom = Number(scenario?.projected_headroom_amount || 0);
  const postPurchaseHeadroom = Number(scenario?.post_purchase_headroom_amount || 0);
  const recurringPressure = Number(scenario?.recurring_pressure_amount || 0);
  const riskAdjustedHeadroom = Number(scenario?.risk_adjusted_headroom_amount || 0);
  const status = useMemo(() => statusConfig(scenario?.status), [scenario?.status]);
  const displayLabel = scenario?.label || label.trim() || 'purchase';
  const displayAmount = scenario?.proposed_amount != null ? Number(scenario.proposed_amount) : parsedAmount;
  const amountShareOfRoom = currentHeadroom > 0 ? Math.round((displayAmount / currentHeadroom) * 100) : null;
  const plannerFeedbackNote = useMemo(
    () => planningFeedbackSummary(
      plannerFeedback?.summary || {},
      plannerFeedback?.timing_preferences || {},
      scenario?.recommendation || null
    ),
    [plannerFeedback, scenario?.recommendation]
  );
  const currentPlanDecisionNote = useMemo(
    () => recentPlanDecisionSummary(scenarioMemory || {}),
    [scenarioMemory]
  );
  const currentPlanResolutionNote = useMemo(
    () => recentPlanResolutionSummary(scenarioMemory || {}),
    [scenarioMemory]
  );
  const recommendationHeadline = scenario?.recommendation?.headline || status.headline;
  const recommendationBody = scenario?.recommendation?.tradeoff_focus || reasonCopy(result);
  const recommendationSummary = [
    `${scopeLabel(scope)} · ${timingModeLabel(scenario?.timing_mode || timingMode)}`,
    currentHeadroom > 0 ? `${formatCurrency(currentHeadroom)} room before this` : null,
    postPurchaseHeadroom !== currentHeadroom ? `${formatCurrency(postPurchaseHeadroom)} after` : null,
  ].filter(Boolean).join('  ·  ');

  function applyStarterAmount(nextAmount) {
    if (!Number.isFinite(Number(nextAmount)) || Number(nextAmount) <= 0) return;
    setAmount(`${Number(nextAmount)}`);
  }

  function renderConsiderationRows() {
    const rows = [
      {
        label: 'Purchase size',
        value: formatCurrency(displayAmount),
        copy: currentHeadroom > 0
          ? `${formatCurrency(displayAmount)} would use about ${amountShareOfRoom}% of the room you had left.`
          : `${formatCurrency(displayAmount)} is being evaluated against a tight starting outlook.`,
      },
      {
        label: 'Timing',
        value: timingModeLabel(scenario?.timing_mode || timingMode),
        copy: scenario?.timing_mode === 'spread_3_periods'
          ? `Adlo is spreading this across ${scenario.horizon_periods?.length || 3} periods instead of treating it as one immediate hit.`
          : scenario?.timing_mode === 'next_period'
            ? 'Adlo is checking whether waiting until the next period creates more breathing room.'
            : `Landing this now would leave about ${formatCurrency(postPurchaseHeadroom)} before recurring pressure.`,
      },
      {
        label: 'Recurring pressure',
        value: recurringPressure > 0 ? formatCurrency(recurringPressure) : 'Light',
        copy: recurringPressure > 0
          ? `${formatCurrency(recurringPressure)} of expected recurring pressure is still ahead in this horizon.`
          : 'No major recurring pressure is currently tightening this horizon.',
      },
      {
        label: 'Confidence',
        value: statusConfig(scenario?.status).label,
        copy: confidenceCopy(scenario?.projection_confidence),
      },
    ];

    return rows.map((row) => (
      <View key={row.label} style={styles.considerationRow}>
        <View style={styles.considerationText}>
          <Text style={styles.considerationLabel}>{row.label}</Text>
          <Text style={styles.considerationCopy}>{row.copy}</Text>
        </View>
        <Text style={styles.considerationValue}>{row.value}</Text>
      </View>
    ));
  }

  async function handleSubmit(nextTimingMode = timingMode) {
    if (!canSubmit) return;
    try {
      setLoading(true);
      setError('');
      const selectedOption = timingOptions.find((option) => option.timing_mode === nextTimingMode) || null;
      const data = await api.post('/trends/scenario-check', {
        scope,
        month: targetMonth,
        proposed_amount: parsedAmount,
        label: label.trim() || 'purchase',
        timing_mode: nextTimingMode,
        scenario_memory_id: scenarioMemory?.id || null,
        choice_source: scenarioMemory?.id ? 'compare_option' : 'initial',
        followed_recommendation: selectedOption ? Boolean(selectedOption.is_recommended) : null,
      });
      setResult(data);
      setScenarioMemory(data?.scenario_memory || null);
      setTimingMode(nextTimingMode);
    } catch (err) {
      setError(err?.message || 'Could not run this scenario right now.');
    } finally {
      setLoading(false);
    }
  }

  async function rerunPlan(nextPlan) {
    if (!nextPlan?.amount || loading) return;
    const nextScope = nextPlan.scope === 'household' && isMultiMember ? 'household' : 'personal';
    const nextLabel = nextPlan.label || 'purchase';
    const nextAmount = Number(nextPlan.amount);
    const nextMonth = nextPlan.month || targetMonth;
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) return;

    try {
      setLoading(true);
      setError('');
      setAmount(`${nextAmount}`);
      setLabel(nextLabel);
      setScope(nextScope);
      const data = await api.post('/trends/scenario-check', {
        scope: nextScope,
        month: nextMonth,
        proposed_amount: nextAmount,
        label: nextLabel,
        timing_mode: nextPlan.timing_mode || 'now',
        scenario_memory_id: nextPlan.id || null,
        choice_source: 'recent_plan',
      });
      setResult(data);
      setScenarioMemory(data?.scenario_memory || null);
      setTimingMode(nextPlan.timing_mode || 'now');
      loadRecentPlans();
    } catch (err) {
      setError(err?.message || 'Could not re-check this plan right now.');
    } finally {
      setLoading(false);
    }
  }

  async function loadRecentPlans() {
    try {
      const data = await api.get('/trends/scenario-memory/recent?limit=3');
      setRecentPlans(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setRecentPlans([]);
    }
  }

  async function handleIntent(intentSignal) {
    if (!scenarioMemory?.id || intentLoading) return;
    try {
      setIntentLoading(intentSignal);
      const data = await api.post(`/trends/scenario-memory/${scenarioMemory.id}/intent`, {
        intent_signal: intentSignal,
      });
      setScenarioMemory(data?.scenario_memory || scenarioMemory);
      loadRecentPlans();
    } catch {
      // non-fatal
    } finally {
      setIntentLoading('');
    }
  }

  async function handleWatchToggle(enabled) {
    if (!scenarioMemory?.id || watchLoading) return;
    try {
      setWatchLoading(true);
      setError('');
      const data = await api.post(`/trends/scenario-memory/${scenarioMemory.id}/watch`, {
        enabled,
      });
      markFreshnessStale([FRESHNESS_DOMAINS.watchedPlans], { reason: 'watched_plan_updated' });
      setScenarioMemory(data?.scenario_memory || scenarioMemory);
      loadRecentPlans();
    } catch (err) {
      setError(err?.message || 'Could not update this watch right now.');
    } finally {
      setWatchLoading(false);
    }
  }

  async function handleResolve(action) {
    if (!scenarioMemory?.id || resolutionLoading) return;
    const endpoint = action === 'revisit_next_month'
      ? `/trends/scenario-memory/${scenarioMemory.id}/defer`
      : `/trends/scenario-memory/${scenarioMemory.id}/resolve`;
    const payload = action === 'revisit_next_month' ? {} : { action };

    try {
      setResolutionLoading(action);
      setError('');
      const data = await api.post(endpoint, payload);
      markFreshnessStale([FRESHNESS_DOMAINS.watchedPlans], { reason: 'watched_plan_resolved' });
      setScenarioMemory(data?.scenario_memory || scenarioMemory);
      loadRecentPlans();
    } catch (err) {
      setError(err?.message || 'Could not save what happened next right now.');
    } finally {
      setResolutionLoading('');
    }
  }

  async function applyTimingOption(mode) {
    if (!mode || loading) return;
    await handleSubmit(mode);
    loadRecentPlans();
  }

  useEffect(() => {
    if (bootstrappedInitialResultRef.current) return;
    if (!params.initial_result) return;
    try {
      const parsed = JSON.parse(`${params.initial_result}`);
      setResult(parsed);
      setScenarioMemory(parsed?.scenario_memory || null);
      bootstrappedInitialResultRef.current = true;
    } catch {
      // ignore malformed navigation payloads
    }
  }, [params.initial_result]);

  useEffect(() => {
    loadRecentPlans();
  }, []);

  useEffect(() => {
    if (`${params.auto_run}` !== '1') return;
    if (params.initial_result) return;
    if (autoRanRef.current || !canSubmit) return;
    autoRanRef.current = true;
    handleSubmit();
  }, [params.auto_run, canSubmit, params.initial_result]);

  useEffect(() => {
    if (!scenario) {
      setShowComposer(true);
      return;
    }
    setShowComposer(false);
  }, [scenario]);

  useEffect(() => {
    let cancelled = false;
    api.get('/trends/planner-feedback-summary')
      .then((data) => {
        if (!cancelled) setPlannerFeedback(data || null);
      })
      .catch(() => {
        if (!cancelled) setPlannerFeedback(null);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <DismissKeyboardScrollView style={styles.container} contentContainerStyle={styles.content}>
        {isAutoRunning ? (
          <View style={styles.loadingHero}>
            <ActivityIndicator color={colors.text} />
            <Text style={styles.loadingTitle}>Checking your plan...</Text>
            <Text style={styles.heroCopy}>Adlo is comparing it against your current spending outlook.</Text>
          </View>
        ) : !scenario ? (
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>Pressure-test a purchase</Text>
            <Text style={styles.heroCopy}>
              See how a one-off expense fits into your current spending outlook for {periodLabel(targetMonth, startDay)}.
            </Text>
            {planningInsight ? (
              <View style={styles.seedCard}>
                <Text style={styles.seedEyebrow}>From your planning insight</Text>
                <Text style={styles.seedTitle}>{planningSeedSummary.title}</Text>
                <Text style={styles.seedBody}>{planningSeedSummary.body}</Text>
                <Text style={styles.seedMeta}>
                  {planningSeedSnapshot.confidence === 'directional' ? 'Directional read' : 'Baseline read'}
                  {planningSeedSnapshot.daysRemaining != null ? ` • ${planningSeedSnapshot.daysRemaining} days left` : ''}
                  {planningSeedSnapshot.headroom > 0 ? ` • About ${formatCurrency(planningSeedSnapshot.headroom)} room` : ''}
                </Text>
                {starterAmounts.length > 0 ? (
                  <View style={styles.starterRow}>
                    {starterAmounts.map((option) => (
                      <TouchableOpacity
                        key={`${option.amount}`}
                        style={styles.starterChip}
                        onPress={() => applyStarterAmount(option.amount)}
                      >
                        <Text style={styles.starterChipText}>{option.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : (
          <>
            <View style={styles.hero}>
              <View style={styles.heroRow}>
                <Text style={styles.scopeChip}>{scopeLabel(scope)}</Text>
                <View style={[styles.statusChip, { backgroundColor: status.chipBg }]}>
                  <Text style={[styles.statusChipText, { color: status.tone }]}>{status.label}</Text>
                </View>
              </View>
              <Text style={styles.resultTitle}>{status.headline}</Text>
              <Text style={styles.heroCopy}>{reasonCopy(result)}</Text>
              <Text style={styles.scopeContextCopy}>{scopeContextCopy(scope, isMultiMember)}</Text>
            </View>

            <View style={styles.recommendationLeadCard}>
              <View style={styles.recommendationLeadTop}>
                <View style={styles.recommendationLeadText}>
                  <Text style={styles.recommendationLeadEyebrow}>Recommended path</Text>
                  <Text style={styles.recommendationLeadTitle}>{recommendationHeadline}</Text>
                  <Text style={styles.recommendationLeadBody}>{recommendationBody}</Text>
                  <Text style={styles.recommendationLeadMeta}>{recommendationSummary}</Text>
                </View>
                <Text style={styles.recommendationLeadAmount}>{formatCurrency(displayAmount)}</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Why this landed here</Text>
              <Text style={styles.bodyRow}>Current month outlook: {projectionDeltaCopy(projection?.projected_budget_delta)}</Text>
              <Text style={styles.bodyRow}>After this purchase, risk-adjusted room: {formatCurrency(riskAdjustedHeadroom)}</Text>
              <Text style={styles.bodyRow}>Recurring pressure still ahead: {formatCurrency(recurringPressure)}</Text>
              <Text style={styles.bodyRow}>{confidenceCopy(scenario.projection_confidence)}</Text>
              {Array.isArray(scenario.caveats) && scenario.caveats.length > 0 ? (
                <View style={styles.caveatsBlock}>
                  {scenario.caveats.map((caveat, index) => (
                    <Text key={`${caveat}-${index}`} style={styles.caveatRow}>• {caveat}</Text>
                  ))}
                </View>
              ) : null}
            </View>

            {timingOptions.length > 0 ? (
              <View style={styles.card}>
                <View style={styles.composerHeader}>
                  <Text style={styles.cardTitle}>Compare timing</Text>
                  <Text style={styles.composerMeta}>Same purchase, different landing points.</Text>
                  {scenario?.recommendation?.personalization_note ? (
                    <Text style={styles.preferenceNote}>{scenario.recommendation.personalization_note}</Text>
                  ) : null}
                </View>
                <View style={styles.optionsList}>
                  {timingOptions.map((option) => (
                    <View
                      key={option.timing_mode}
                      style={[
                        styles.optionCard,
                        option.is_selected && styles.optionCardSelected,
                        option.is_recommended && !option.is_selected && styles.optionCardRecommended,
                      ]}
                    >
                      <View style={styles.optionTopRow}>
                        <View style={styles.optionTitleWrap}>
                          <Text style={styles.optionTitle}>{option.timing_label}</Text>
                          <Text style={styles.optionStatus}>
                            {option.status_label}
                            {option.is_selected ? ' · Current' : option.is_recommended ? ' · Best bet' : ''}
                          </Text>
                        </View>
                        <Text style={styles.optionMetric}>{optionMetricCopy(option)}</Text>
                      </View>
                      <Text style={styles.optionHeadline}>{option.headline}</Text>
                      <Text style={styles.optionReason}>{option.reason}</Text>
                      {!option.is_selected ? (
                        <Text style={styles.optionTradeoff}>{optionTradeoffCopy(option)}</Text>
                      ) : null}
                      <TouchableOpacity
                        style={[
                          styles.optionButton,
                          option.is_selected && styles.optionButtonSelected,
                        ]}
                        onPress={() => applyTimingOption(option.timing_mode)}
                        disabled={loading || option.is_selected}
                      >
                        {loading && !option.is_selected ? (
                          <ActivityIndicator color={colors.textInverse} size="small" />
                        ) : (
                          <Text
                            style={[
                              styles.optionButtonText,
                              option.is_selected && styles.optionButtonTextSelected,
                            ]}
                          >
                            {option.is_selected ? 'Selected' : recommendationButtonLabel(option.timing_mode)}
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
                {plannerFeedbackNote ? (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>{plannerFeedbackNote.title}</Text>
                    <Text style={styles.bodyRow}>{plannerFeedbackNote.body}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {Array.isArray(scenario.horizon_periods) && scenario.horizon_periods.length > 1 ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Across the horizon</Text>
                {scenario.horizon_periods.map((period) => (
                  <View key={`${period.month}-${period.applied_amount}`} style={styles.horizonRow}>
                    <View style={styles.horizonText}>
                      <Text style={styles.horizonLabel}>{period.label}</Text>
                      <Text style={styles.horizonMeta}>{formatCurrency(period.applied_amount)} applied</Text>
                    </View>
                    <View style={styles.horizonRight}>
                      <Text style={styles.horizonStatus}>{statusConfig(period.status).label}</Text>
                      <Text style={styles.horizonAmount}>{formatCurrency(period.risk_adjusted_headroom_amount)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>How should Adlo treat this?</Text>
              <Text style={styles.bodyRow}>
                This helps Adlo decide whether to keep this plan lightly in mind or let it fade out.
              </Text>
              <View style={styles.intentRow}>
                {[
                  { key: 'considering', label: 'Still considering it' },
                  { key: 'not_right_now', label: 'Not right now' },
                  { key: 'just_exploring', label: 'Just exploring' },
                ].map((option) => {
                  const isActive = scenarioMemory?.intent_signal === option.key;
                  const isBusy = intentLoading === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.intentChip, isActive && styles.intentChipActive]}
                      onPress={() => handleIntent(option.key)}
                      disabled={Boolean(intentLoading)}
                    >
                      <Text style={[styles.intentChipText, isActive && styles.intentChipTextActive]}>
                        {isBusy ? 'Saving...' : option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {Array.isArray(scenario.recurring_candidates) && scenario.recurring_candidates.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>What Adlo is accounting for</Text>
                {scenario.recurring_candidates.map((candidate) => (
                  <View key={candidate.group_key} style={styles.candidateRow}>
                    <View style={styles.candidateText}>
                      <Text style={styles.candidateName}>{candidate.item_name || 'Recurring purchase'}</Text>
                      <Text style={styles.candidateMeta}>
                        {candidate.days_until_due <= 0 ? 'Due now' : `Due in ${candidate.days_until_due}d`}
                      </Text>
                    </View>
                    <Text style={styles.candidateAmount}>{formatCurrency(candidate.median_amount)}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.watchCard}>
              <Text style={styles.watchTitle}>
                {scenarioMemory?.watch_enabled
                  ? (scope === 'household' ? 'Keeping an eye on this for the household' : 'Keeping an eye on this')
                  : (scope === 'household' ? 'Keep an eye on this for the household' : 'Keep an eye on this')}
              </Text>
              <Text style={styles.watchMeta}>
                {scenarioMemory?.watch_enabled
                  ? (scope === 'household'
                    ? 'Adlo will keep checking the shared household outlook to see whether this gets easier or tighter.'
                    : 'Adlo will hold onto this plan longer and keep checking whether it gets easier or tighter.')
                  : (scope === 'household'
                    ? 'Watched household plans stick around so Adlo can keep checking the shared budget room.'
                    : 'Only watched plans stick around longer for ongoing re-checks.')}
              </Text>
              <TouchableOpacity
                style={[styles.watchButton, scenarioMemory?.watch_enabled && styles.watchButtonActive]}
                onPress={() => handleWatchToggle(!scenarioMemory?.watch_enabled)}
                disabled={watchLoading || !scenarioMemory?.id}
              >
                {watchLoading ? (
                  <ActivityIndicator color={scenarioMemory?.watch_enabled ? colors.text : colors.textInverse} size="small" />
                ) : (
                  <Text style={[styles.watchButtonText, scenarioMemory?.watch_enabled && styles.watchButtonTextActive]}>
                    {scenarioMemory?.watch_enabled ? 'Stop watching' : 'Watch this plan'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {scenarioMemory?.id ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>What happened next?</Text>
                <Text style={styles.bodyRow}>
                  This closes the loop so Adlo can learn whether the recommendation was useful in real life, not just on paper.
                </Text>
                {currentPlanDecisionNote ? (
                  <Text style={styles.followUpMeta}>{currentPlanDecisionNote}</Text>
                ) : null}
                {currentPlanResolutionNote ? (
                  <Text style={styles.followUpMeta}>{currentPlanResolutionNote}</Text>
                ) : null}
                <View style={styles.followUpRow}>
                  {[
                    { key: 'bought', label: 'I bought it' },
                    { key: 'revisit_next_month', label: 'Next month instead' },
                    { key: 'not_buying', label: 'Skipping it' },
                  ].map((option) => {
                    const isActive = scenarioMemory?.resolution_action === option.key;
                    const isBusy = resolutionLoading === option.key;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        style={[styles.intentChip, isActive && styles.intentChipActive]}
                        onPress={() => handleResolve(option.key)}
                        disabled={Boolean(resolutionLoading)}
                      >
                        <Text style={[styles.intentChipText, isActive && styles.intentChipTextActive]}>
                          {isBusy ? 'Saving...' : option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </>
        )}

        {scenario ? (
          <View style={styles.card}>
            <View style={styles.composerHeader}>
              <Text style={styles.cardTitle}>Considerations</Text>
              <Text style={styles.composerMeta}>What drove this answer and what you could adjust.</Text>
            </View>
            <View style={styles.considerationsList}>
              {renderConsiderationRows()}
            </View>
            <TouchableOpacity style={styles.secondaryLinkButton} onPress={() => setShowComposer((value) => !value)}>
              <Text style={styles.secondaryLinkText}>{showComposer ? 'Hide adjustments' : 'Adjust this plan'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {(!scenario || showComposer) ? (
          <View style={styles.card}>
            <View style={styles.composerHeader}>
              <Text style={styles.cardTitle}>{scenario ? 'Adjustments' : 'Scenario'}</Text>
              <Text style={styles.composerMeta}>{periodLabel(targetMonth, startDay)}</Text>
            </View>

            <View style={styles.composerRow}>
              <View style={styles.amountPill}>
                <Text style={styles.amountPillDollar}>$</Text>
                <TextInput
                  value={amount}
                  onChangeText={(value) => setAmount(formatAmountInput(value))}
                  placeholder="180"
                  placeholderTextColor={colors.textDisabled}
                  keyboardType="decimal-pad"
                  style={styles.amountPillInput}
                />
              </View>
              <View style={styles.inlineInputWrap}>
                <TextInput
                  value={label}
                  onChangeText={setLabel}
                  placeholder="running shoes"
                  placeholderTextColor={colors.textDisabled}
                  style={styles.inlineInput}
                />
              </View>
            </View>

            <View style={styles.composerFooter}>
              <View style={styles.composerControls}>
                {isMultiMember ? (
                  <View style={styles.toggleRow}>
                    <TouchableOpacity
                      style={[styles.toggleChip, scope === 'personal' && styles.toggleChipActive]}
                      onPress={() => setScope('personal')}
                    >
                      <Text style={[styles.toggleChipText, scope === 'personal' && styles.toggleChipTextActive]}>Mine</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.toggleChip, scope === 'household' && styles.toggleChipActive]}
                      onPress={() => setScope('household')}
                    >
                      <Text style={[styles.toggleChipText, scope === 'household' && styles.toggleChipTextActive]}>Household</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.periodMiniBadge}>
                    <Text style={styles.periodMiniBadgeText}>{periodLabel(targetMonth, startDay)}</Text>
                  </View>
                )}

                <View style={styles.timingRow}>
                  <TouchableOpacity
                    style={[styles.timingChip, timingMode === 'now' && styles.timingChipActive]}
                    onPress={() => setTimingMode('now')}
                  >
                    <Text style={[styles.timingChipText, timingMode === 'now' && styles.timingChipTextActive]}>Now</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.timingChip, timingMode === 'next_period' && styles.timingChipActive]}
                    onPress={() => setTimingMode('next_period')}
                  >
                    <Text style={[styles.timingChipText, timingMode === 'next_period' && styles.timingChipTextActive]}>Next</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.timingChip, timingMode === 'spread_3_periods' && styles.timingChipActive]}
                    onPress={() => setTimingMode('spread_3_periods')}
                  >
                    <Text style={[styles.timingChipText, timingMode === 'spread_3_periods' && styles.timingChipTextActive]}>3 periods</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, !canSubmit && styles.primaryButtonDisabled]}
                onPress={() => handleSubmit()}
                disabled={!canSubmit}
              >
                {loading ? (
                  <ActivityIndicator color={colors.textInverse} size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>{scenario ? 'Update' : 'Run it'}</Text>
                )}
              </TouchableOpacity>
            </View>

            {isMultiMember ? (
              <View style={styles.periodBadge}>
                <Text style={styles.periodBadgeTitle}>{periodLabel(targetMonth, startDay)}</Text>
                <Text style={styles.periodBadgeCopy}>Uses your active budget period and current spend projection.</Text>
              </View>
            ) : null}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
        ) : null}

        {recentPlans.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Recent plans</Text>
            {recentPlans.map((plan) => {
              const isCurrent = scenarioMemory?.id && scenarioMemory.id === plan.id;
              const changeCopy = recentPlanChangeCopy(plan);
              const whyChangedCopy = recentPlanWhyChangedCopy(plan);
              const statusCopy = recentPlanStatusCopy(plan);
              const decisionCopy = recentPlanDecisionSummary(plan);
              const resolutionCopy = recentPlanResolutionSummary(plan);
              return (
                <TouchableOpacity
                  key={plan.id}
                  style={[styles.recentPlanRow, isCurrent && styles.recentPlanRowActive]}
                  activeOpacity={0.85}
                  onPress={() => rerunPlan(plan)}
                >
                  <View style={styles.recentPlanText}>
                    <Text style={styles.recentPlanLabel}>{plan.label}</Text>
                    <Text style={styles.recentPlanMeta}>{recentPlanMetaCopy(plan)}</Text>
                    {changeCopy ? (
                      <Text style={styles.recentPlanChange}>{changeCopy}</Text>
                    ) : null}
                    {whyChangedCopy ? (
                      <Text style={styles.recentPlanWhy}>{whyChangedCopy}</Text>
                    ) : null}
                    {decisionCopy ? (
                      <Text style={styles.recentPlanWhy}>{decisionCopy}</Text>
                    ) : null}
                    {resolutionCopy ? (
                      <Text style={styles.recentPlanChange}>{resolutionCopy}</Text>
                    ) : null}
                  </View>
                  <View style={styles.recentPlanRight}>
                    {statusCopy ? (
                      <Text style={styles.recentPlanStatus}>{statusCopy}</Text>
                    ) : null}
                    <Text style={styles.recentPlanAmount}>{formatCurrency(plan.amount)}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
      </DismissKeyboardScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 48, gap: 18 },
  loadingHero: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingTitle: { fontSize: 20, color: colors.text, fontWeight: '600' },
  hero: { gap: 8 },
  heroRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  scopeChip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    color: colors.textMuted,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
    fontSize: 12,
    fontWeight: '600',
  },
  heroTitle: { fontSize: 30, color: colors.text, fontWeight: '600', letterSpacing: -0.8 },
  resultTitle: { fontSize: 28, color: colors.text, fontWeight: '600', letterSpacing: -0.6, lineHeight: 34 },
  heroCopy: { fontSize: 15, color: colors.textMuted, lineHeight: 22 },
  seedCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.infoMuted,
    backgroundColor: colors.infoMuted,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  seedEyebrow: { fontSize: 11, color: colors.info, textTransform: 'uppercase', letterSpacing: 1.1 },
  seedTitle: { fontSize: 17, color: colors.text, fontWeight: '600', lineHeight: 22 },
  seedBody: { fontSize: 14, color: colors.text, lineHeight: 20 },
  seedMeta: { fontSize: 12, color: colors.text, lineHeight: 17 },
  starterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  starterChip: {
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoMuted,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  starterChipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  scopeContextCopy: { fontSize: 13, color: colors.info, lineHeight: 18 },
  recommendationLeadCard: {
    backgroundColor: colors.infoMuted,
    borderWidth: 1,
    borderColor: colors.infoMuted,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  recommendationLeadTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  recommendationLeadText: { flex: 1, gap: 6 },
  recommendationLeadEyebrow: { fontSize: 11, color: colors.info, textTransform: 'uppercase', letterSpacing: 1.1 },
  recommendationLeadTitle: { fontSize: 20, color: colors.text, fontWeight: '700', lineHeight: 25 },
  recommendationLeadBody: { fontSize: 14, color: colors.text, lineHeight: 20 },
  recommendationLeadMeta: { fontSize: 12, color: colors.text, lineHeight: 17 },
  recommendationLeadAmount: { fontSize: 24, color: colors.text, fontWeight: '700', letterSpacing: -0.6 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  cardTitle: { fontSize: 12, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 1.2 },
  composerHeader: { gap: 4 },
  composerMeta: { color: colors.textDisabled, fontSize: 12, lineHeight: 16 },
  preferenceNote: { color: colors.info, fontSize: 12, lineHeight: 17 },
  composerRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  amountPill: {
    minWidth: 94,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  amountPillDollar: { color: colors.textSubtle, fontSize: 17, fontWeight: '600' },
  amountPillInput: {
    flex: 1,
    color: colors.text,
    fontSize: 19,
    fontWeight: '600',
    letterSpacing: -0.3,
    padding: 0,
  },
  inlineInputWrap: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  inlineInput: { color: colors.text, fontSize: 15, padding: 0 },
  composerFooter: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  composerControls: { flex: 1, gap: 10 },
  considerationsList: { gap: 0 },
  optionsList: { gap: 10 },
  optionCard: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  optionCardSelected: {
    borderColor: colors.info,
    backgroundColor: colors.infoMuted,
  },
  optionCardRecommended: {
    borderColor: colors.successMuted,
    backgroundColor: colors.successMuted,
  },
  optionTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  optionTitleWrap: { flex: 1, gap: 2 },
  optionTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  optionStatus: { color: colors.info, fontSize: 12 },
  optionMetric: { color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'right' },
  optionHeadline: { color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  optionReason: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  optionTradeoff: { color: colors.info, fontSize: 12, lineHeight: 17 },
  optionButton: {
    alignSelf: 'flex-start',
    minWidth: 138,
    backgroundColor: colors.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionButtonSelected: {
    backgroundColor: colors.infoMuted,
    borderWidth: 1,
    borderColor: colors.info,
  },
  optionButtonText: { color: colors.textInverse, fontSize: 13, fontWeight: '700' },
  optionButtonTextSelected: { color: colors.text },
  considerationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  considerationText: { flex: 1, gap: 3 },
  considerationLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  considerationCopy: { color: colors.textSubtle, fontSize: 13, lineHeight: 18 },
  considerationValue: { color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'right', maxWidth: 118 },
  secondaryLinkButton: {
    alignSelf: 'flex-start',
    marginTop: 2,
    paddingVertical: 4,
  },
  secondaryLinkText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', gap: 10, flex: 1 },
  toggleChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 82,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  toggleChipActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  toggleChipText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  toggleChipTextActive: { color: colors.textInverse },
  timingRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  timingChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  timingChipActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  timingChipText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  timingChipTextActive: { color: colors.textInverse, fontSize: 12, fontWeight: '700' },
  periodBadge: {
    backgroundColor: colors.infoMuted,
    borderWidth: 1,
    borderColor: colors.infoMuted,
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  periodBadgeTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  periodBadgeCopy: { color: colors.info, fontSize: 13, lineHeight: 18 },
  periodMiniBadge: {
    backgroundColor: colors.infoMuted,
    borderWidth: 1,
    borderColor: colors.infoMuted,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  periodMiniBadgeText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  primaryButton: {
    backgroundColor: colors.text,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
    minWidth: 76,
    paddingHorizontal: 14,
  },
  primaryButtonDisabled: { opacity: 0.45 },
  primaryButtonText: { color: colors.textInverse, fontSize: 13, fontWeight: '700' },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  statusChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusChipText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  bodyRow: { fontSize: 14, color: colors.textMuted, lineHeight: 21 },
  caveatsBlock: { gap: 4, marginTop: 2 },
  caveatRow: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  horizonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  horizonText: { flex: 1 },
  horizonLabel: { fontSize: 15, color: colors.text, fontWeight: '500' },
  horizonMeta: { fontSize: 12, color: colors.textSubtle, marginTop: 2 },
  horizonRight: { alignItems: 'flex-end', gap: 4 },
  horizonStatus: { fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  horizonAmount: { fontSize: 14, color: colors.text, fontWeight: '600' },
  intentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  followUpRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  followUpMeta: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  intentChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfacePressed,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  intentChipActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  intentChipText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  intentChipTextActive: {
    color: colors.textInverse,
  },
  recentPlanRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  recentPlanRowActive: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  recentPlanText: { flex: 1 },
  recentPlanRight: { alignItems: 'flex-end', gap: 5 },
  recentPlanLabel: { fontSize: 15, color: colors.text, fontWeight: '500' },
  recentPlanMeta: { fontSize: 12, color: colors.textSubtle, marginTop: 2 },
  recentPlanChange: { fontSize: 12, color: colors.info, marginTop: 4, fontWeight: '500' },
  recentPlanWhy: { fontSize: 12, color: colors.text, marginTop: 2, lineHeight: 16 },
  recentPlanStatus: { fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  recentPlanAmount: { fontSize: 14, color: colors.text, fontWeight: '600' },
  candidateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  candidateText: { flex: 1 },
  candidateName: { fontSize: 15, color: colors.text, fontWeight: '500' },
  candidateMeta: { fontSize: 12, color: colors.textSubtle, marginTop: 2 },
  candidateAmount: { fontSize: 14, color: colors.text, fontWeight: '600' },
  watchCard: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    padding: 14,
    gap: 10,
    backgroundColor: colors.infoMuted,
  },
  watchTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  watchMeta: { color: colors.textSubtle, fontSize: 13, lineHeight: 18 },
  watchButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.text,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 130,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchButtonActive: {
    backgroundColor: colors.infoMuted,
    borderWidth: 1,
    borderColor: colors.info,
  },
  watchButtonText: { color: colors.textInverse, fontSize: 13, fontWeight: '700' },
  watchButtonTextActive: { color: colors.text },
});
