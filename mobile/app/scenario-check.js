import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useMonth, currentPeriod, periodLabel } from '../contexts/MonthContext';
import { useHousehold } from '../hooks/useHousehold';
import { api } from '../services/api';

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `$${Math.abs(amount).toFixed(0)}`;
}

function formatAmountInput(value) {
  return value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
}

function statusConfig(status) {
  switch (status) {
    case 'comfortable':
      return {
        label: 'Comfortable',
        headline: 'Yes, this looks comfortably absorbable.',
        tone: '#166534',
        chipBg: '#e6f7ed',
      };
    case 'absorbable':
      return {
        label: 'Absorbable',
        headline: 'Yes, but this uses a meaningful share of your remaining room.',
        tone: '#1d4ed8',
        chipBg: '#e8f0ff',
      };
    case 'tight':
      return {
        label: 'Tight',
        headline: 'Maybe, but the rest of the month would get tight.',
        tone: '#b45309',
        chipBg: '#fff4e5',
      };
    case 'risky':
      return {
        label: 'Risky',
        headline: 'This would likely push the month into a riskier range.',
        tone: '#b91c1c',
        chipBg: '#ffe8e8',
      };
    case 'not_absorbable':
      return {
        label: 'Not absorbable',
        headline: 'This does not look absorbable in the current month.',
        tone: '#991b1b',
        chipBg: '#ffe0e0',
      };
    default:
      return {
        label: 'Unknown',
        headline: 'There is not enough history yet to answer this confidently.',
        tone: '#475569',
        chipBg: '#e5e7eb',
      };
  }
}

function reasonCopy(result) {
  const scenario = result?.scenario || {};
  const label = scenario.label || 'purchase';
  switch (scenario.reason) {
    case 'projected_headroom_remains':
      return `${label} still leaves room after expected recurring spend later in the period.`;
    case 'limited_but_positive_headroom':
      return `${label} still fits, but it would use a noticeable share of your remaining room.`;
    case 'limited_headroom_after_recurring_pressure':
      return `${label} technically fits, but upcoming recurring purchases make the rest of the period tighter.`;
    case 'headroom_consumed':
      return `${label} would likely consume the remaining headroom and push the period into a higher-risk range.`;
    case 'projected_over_budget_after_purchase':
      return `${label} would push the current projection above budget by period end.`;
    case 'insufficient_history':
      return 'Adlo does not have enough historical periods yet to answer this with confidence.';
    default:
      return 'This is based on your current projection, recent period shape, and expected recurring pressure.';
  }
}

function confidenceCopy(confidence) {
  if (confidence === 'high') return 'High confidence from a stable spending pattern.';
  if (confidence === 'medium') return 'Moderate confidence based on your recent spending history.';
  if (confidence === 'low') return 'Lower confidence because this period is still early or more variable than usual.';
  return 'Confidence is still building as Adlo learns your period shape.';
}

function scopeLabel(scope) {
  return scope === 'household' ? 'Household' : 'You';
}

function projectionDeltaCopy(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'Projection still building';
  const amount = Number(value);
  if (amount > 0) return `${formatCurrency(amount)} over budget`;
  if (amount < 0) return `${formatCurrency(amount)} under budget`;
  return 'Right on budget';
}

function recentPlanMetaCopy(plan) {
  return `${scopeLabel(plan.scope)} · ${plan.memory_state === 'considering' ? 'Still considering' : 'Recent check'}`;
}

function recentPlanChangeCopy(plan) {
  if (plan?.memory_state !== 'considering') return '';
  if (plan?.last_material_change === 'improved') return 'Looks easier now';
  if (plan?.last_material_change === 'worsened') return 'Tighter than before';
  return '';
}

function recentPlanStatusCopy(plan) {
  if (!plan?.last_affordability_status) return '';
  return statusConfig(plan.last_affordability_status).label;
}

export default function ScenarioCheckScreen() {
  const params = useLocalSearchParams();
  const { selectedMonth, startDay } = useMonth();
  const { memberCount } = useHousehold();
  const isMultiMember = memberCount > 1;
  const targetMonth = `${params.month || selectedMonth || currentPeriod(startDay)}`;
  const [amount, setAmount] = useState(typeof params.amount === 'string' ? params.amount : '');
  const [label, setLabel] = useState(typeof params.label === 'string' ? params.label : '');
  const [scope, setScope] = useState(
    params.scope === 'household' && isMultiMember ? 'household' : 'personal'
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [scenarioMemory, setScenarioMemory] = useState(null);
  const [recentPlans, setRecentPlans] = useState([]);
  const [intentLoading, setIntentLoading] = useState('');
  const autoRanRef = useRef(false);
  const bootstrappedInitialResultRef = useRef(false);
  const isAutoRunning = `${params.auto_run}` === '1' && !scenario && loading;

  const parsedAmount = Number(amount);
  const canSubmit = Number.isFinite(parsedAmount) && parsedAmount > 0 && !loading;
  const scenario = result?.scenario || null;
  const projection = result?.projection?.overall || null;
  const currentHeadroom = Number(scenario?.projected_headroom_amount || 0);
  const postPurchaseHeadroom = Number(scenario?.post_purchase_headroom_amount || 0);
  const recurringPressure = Number(scenario?.recurring_pressure_amount || 0);
  const riskAdjustedHeadroom = Number(scenario?.risk_adjusted_headroom_amount || 0);
  const status = useMemo(() => statusConfig(scenario?.status), [scenario?.status]);
  const displayLabel = scenario?.label || label.trim() || 'purchase';
  const displayAmount = scenario?.proposed_amount != null ? Number(scenario.proposed_amount) : parsedAmount;

  async function handleSubmit() {
    if (!canSubmit) return;
    try {
      setLoading(true);
      setError('');
      const data = await api.post('/trends/scenario-check', {
        scope,
        month: targetMonth,
        proposed_amount: parsedAmount,
        label: label.trim() || 'purchase',
      });
      setResult(data);
      setScenarioMemory(data?.scenario_memory || null);
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
      });
      setResult(data);
      setScenarioMemory(data?.scenario_memory || null);
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {isAutoRunning ? (
          <View style={styles.loadingHero}>
            <ActivityIndicator color="#f5f5f5" />
            <Text style={styles.loadingTitle}>Checking your plan...</Text>
            <Text style={styles.heroCopy}>Adlo is comparing it against your current spending outlook.</Text>
          </View>
        ) : !scenario ? (
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>Pressure-test a purchase</Text>
            <Text style={styles.heroCopy}>
              See how a one-off expense fits into your current spending outlook for {periodLabel(targetMonth, startDay)}.
            </Text>
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
            </View>

            <View style={styles.planSummaryCard}>
              <View style={styles.planSummaryText}>
                <Text style={styles.planSummaryLabel}>{displayLabel}</Text>
                <Text style={styles.planSummaryMeta}>
                  {scopeLabel(scope)} · {periodLabel(targetMonth, startDay)}
                </Text>
              </View>
              <Text style={styles.planSummaryAmount}>{formatCurrency(displayAmount)}</Text>
            </View>

            <View style={styles.metricGrid}>
              <View style={[styles.metricCard, styles.metricCardHalf]}>
                <Text style={styles.metricLabel}>Current room</Text>
                <Text style={styles.metricValue}>{formatCurrency(currentHeadroom)}</Text>
              </View>
              <View style={[styles.metricCard, styles.metricCardHalf]}>
                <Text style={styles.metricLabel}>After purchase</Text>
                <Text style={styles.metricValue}>{formatCurrency(postPurchaseHeadroom)}</Text>
              </View>
              <View style={[styles.metricCard, styles.metricCardFull]}>
                <Text style={styles.metricLabel}>Recurring pressure still ahead</Text>
                <Text style={styles.metricValue}>{formatCurrency(recurringPressure)}</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>What changed</Text>
              <Text style={styles.bodyRow}>Current month outlook: {projectionDeltaCopy(projection?.projected_budget_delta)}</Text>
              <Text style={styles.bodyRow}>After this purchase, risk-adjusted room: {formatCurrency(riskAdjustedHeadroom)}</Text>
              <Text style={styles.bodyRow}>{confidenceCopy(scenario.projection_confidence)}</Text>
            </View>

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

            <View style={styles.watchPlaceholder}>
              <Text style={styles.watchPlaceholderText}>Watch this scenario</Text>
              <Text style={styles.watchPlaceholderMeta}>Reserved for the next step: keep monitoring this purchase over time.</Text>
            </View>
          </>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{scenario ? 'Try another amount' : 'Scenario'}</Text>
          <Text style={styles.fieldLabel}>Amount</Text>
          <TextInput
            value={amount}
            onChangeText={(value) => setAmount(formatAmountInput(value))}
            placeholder="180"
            placeholderTextColor="#6f6f6f"
            keyboardType="decimal-pad"
            style={styles.amountInput}
          />

          <Text style={styles.fieldLabel}>Label</Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="running shoes"
            placeholderTextColor="#6f6f6f"
            style={styles.input}
          />

          {isMultiMember ? (
            <>
              <Text style={styles.fieldLabel}>Scope</Text>
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
            </>
          ) : null}

          <View style={styles.periodBadge}>
            <Text style={styles.periodBadgeTitle}>{periodLabel(targetMonth, startDay)}</Text>
            <Text style={styles.periodBadgeCopy}>Uses your active budget period and current spend projection.</Text>
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, !canSubmit && styles.primaryButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            {loading ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>Check this purchase</Text>
            )}
          </TouchableOpacity>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        {recentPlans.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Recent plans</Text>
            {recentPlans.map((plan) => {
              const isCurrent = scenarioMemory?.id && scenarioMemory.id === plan.id;
              const changeCopy = recentPlanChangeCopy(plan);
              const statusCopy = recentPlanStatusCopy(plan);
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0a0a0a' },
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 48, gap: 18 },
  loadingHero: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingTitle: { fontSize: 20, color: '#f5f5f5', fontWeight: '600' },
  hero: { gap: 8 },
  heroRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  scopeChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#161616',
    color: '#d4d4d4',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
    fontSize: 12,
    fontWeight: '600',
  },
  heroTitle: { fontSize: 30, color: '#f5f5f5', fontWeight: '600', letterSpacing: -0.8 },
  resultTitle: { fontSize: 28, color: '#f5f5f5', fontWeight: '600', letterSpacing: -0.6, lineHeight: 34 },
  heroCopy: { fontSize: 15, color: '#b5b5b5', lineHeight: 22 },
  planSummaryCard: {
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: '#181818',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  planSummaryText: { flex: 1, gap: 4 },
  planSummaryLabel: { fontSize: 18, color: '#f5f5f5', fontWeight: '600' },
  planSummaryMeta: { fontSize: 13, color: '#8f8f8f' },
  planSummaryAmount: { fontSize: 24, color: '#f5f5f5', fontWeight: '600', letterSpacing: -0.6 },
  card: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  cardTitle: { fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1.2 },
  fieldLabel: { fontSize: 12, color: '#a3a3a3', textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 2 },
  amountInput: {
    backgroundColor: '#151515',
    borderColor: '#262626',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: '#f5f5f5',
    fontSize: 30,
    fontWeight: '600',
    letterSpacing: -0.8,
  },
  input: {
    backgroundColor: '#151515',
    borderColor: '#262626',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: '#f5f5f5',
    fontSize: 16,
  },
  toggleRow: { flexDirection: 'row', gap: 10 },
  toggleChip: {
    flex: 1,
    backgroundColor: '#171717',
    borderColor: '#2a2a2a',
    borderWidth: 1,
    borderRadius: 999,
    alignItems: 'center',
    paddingVertical: 12,
  },
  toggleChipActive: {
    backgroundColor: '#f5f5f5',
    borderColor: '#f5f5f5',
  },
  toggleChipText: { color: '#d4d4d4', fontSize: 14, fontWeight: '600' },
  toggleChipTextActive: { color: '#000' },
  periodBadge: {
    backgroundColor: '#101b24',
    borderWidth: 1,
    borderColor: '#1a2f40',
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  periodBadgeTitle: { color: '#dfefff', fontSize: 16, fontWeight: '600' },
  periodBadgeCopy: { color: '#8ca7bf', fontSize: 13, lineHeight: 18 },
  primaryButton: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryButtonDisabled: { opacity: 0.45 },
  primaryButtonText: { color: '#000', fontSize: 15, fontWeight: '700' },
  errorText: { color: '#fca5a5', fontSize: 13, lineHeight: 18 },
  statusChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusChipText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  metricCardHalf: {
    width: '48%',
  },
  metricCardFull: {
    width: '100%',
  },
  metricLabel: { fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1.2 },
  metricValue: { fontSize: 28, color: '#f5f5f5', fontWeight: '600', letterSpacing: -0.8 },
  bodyRow: { fontSize: 14, color: '#d4d4d4', lineHeight: 21 },
  intentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  intentChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2b2b2b',
    backgroundColor: '#181818',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  intentChipActive: {
    backgroundColor: '#f5f5f5',
    borderColor: '#f5f5f5',
  },
  intentChipText: {
    color: '#d7d7d7',
    fontSize: 13,
    fontWeight: '600',
  },
  intentChipTextActive: {
    color: '#000',
  },
  recentPlanRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  recentPlanRowActive: {
    backgroundColor: '#151515',
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  recentPlanText: { flex: 1 },
  recentPlanRight: { alignItems: 'flex-end', gap: 5 },
  recentPlanLabel: { fontSize: 15, color: '#f5f5f5', fontWeight: '500' },
  recentPlanMeta: { fontSize: 12, color: '#888', marginTop: 2 },
  recentPlanChange: { fontSize: 12, color: '#b8c8ff', marginTop: 4, fontWeight: '500' },
  recentPlanStatus: { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8 },
  recentPlanAmount: { fontSize: 14, color: '#e5e5e5', fontWeight: '600' },
  candidateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  candidateText: { flex: 1 },
  candidateName: { fontSize: 15, color: '#f5f5f5', fontWeight: '500' },
  candidateMeta: { fontSize: 12, color: '#888', marginTop: 2 },
  candidateAmount: { fontSize: 14, color: '#e5e5e5', fontWeight: '600' },
  watchPlaceholder: {
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  watchPlaceholderText: { color: '#d4d4d4', fontSize: 15, fontWeight: '600' },
  watchPlaceholderMeta: { color: '#7b7b7b', fontSize: 13, lineHeight: 18 },
});
