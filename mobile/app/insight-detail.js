import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { selectInsightEvidence } from '../services/insightEvidence';
import {
  getInsightActionDescriptor,
  getPrimaryActionForInsight,
  getInsightScopeLabel,
  getInsightStageDescriptor,
  getInsightSupportRows,
  getInsightTechnicalRows,
  getInsightTechnicalSummary,
} from '../services/insightPresentation';
import { consumeNavigationPayload, stashNavigationPayload } from '../services/navigationPayloadStore';
import { openExpenseDetail } from '../services/openExpenseDetail';
import { planningActionSummary } from '../services/planningPresentation';
import { loadInsightDetailSnapshot, saveInsightDetailSnapshot } from '../services/insightLocalStore';

const FEEDBACK_REASONS = [
  { key: 'wrong_timing', label: 'Wrong timing' },
  { key: 'not_relevant', label: 'Not relevant' },
  { key: 'not_accurate', label: 'Not accurate' },
  { key: 'already_knew', label: 'I already knew this' },
];

function formatLabel(value) {
  return `${value || ''}`
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function firstParam(value, fallback = '') {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

function formatValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return `${value}`;
    return `${Number(value).toFixed(1)}`;
  }
  return `${value}`;
}

function formatCurrency(value) {
  if (value == null || Number.isNaN(Number(value))) return '';
  return `$${Number(value).toFixed(2)}`;
}

function formatPercentFromRatio(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return `${Math.round(Number(value) * 100)}%`;
}

function formatShortDate(value) {
  if (!value) return '';
  const date = new Date(`${`${value}`.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return `${value}`.slice(0, 10);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function metadataHighlights(metadata = {}) {
  const rows = [
    ['Month', metadata.month],
    ['Category', metadata.category_name],
    ['Merchant', metadata.merchant_name],
    ['Current spend', metadata.current_spend_to_date ?? metadata.current_spend],
    ['Previous spend', metadata.previous_spend],
    ['Share of spend', metadata.share_of_spend != null ? `${metadata.share_of_spend}%` : null],
    ['Expense count', metadata.expense_count],
    ['Active days', metadata.active_day_count],
    ['Uncategorized', metadata.uncategorized_count],
    ['Category signal', formatPercentFromRatio(metadata.category_trust_score)],
    ['Combined scopes', Array.isArray(metadata.consolidated_scopes) ? metadata.consolidated_scopes.map(formatLabel).join(' + ') : null],
  ];

  return rows
    .map(([label, value]) => ({ label, value: formatValue(value) }))
    .filter((row) => row.value != null)
    .slice(0, 8);
}

function transparencyRows(metadata = {}) {
  const trustedCount = metadata.category_trusted_count != null ? `${metadata.category_trusted_count}` : null;
  const lowConfidenceCount = metadata.category_low_confidence_count != null ? `${metadata.category_low_confidence_count}` : null;
  const rows = [
    ['Maturity', metadata.maturity],
    ['Confidence', metadata.confidence],
    ['Scope', metadata.scope],
    ['Hierarchy', metadata.hierarchy_level],
    ['Scope origin', metadata.scope_origin],
    ['Scope relationship', metadata.scope_relationship],
    ['Household context', metadata.household_context_included ? 'Included' : null],
    ['Month', metadata.month],
    ['Category signal', formatPercentFromRatio(metadata.category_trust_score)],
    ['Trusted category expenses', trustedCount],
    ['Low-confidence category expenses', lowConfidenceCount],
    ['Combined scopes', Array.isArray(metadata.consolidated_scopes) ? metadata.consolidated_scopes.map(formatLabel).join(' + ') : null],
  ];

  return rows
    .map(([label, value]) => ({ label, value: formatValue(value) }))
    .filter((row) => row.value != null);
}

function transparencySummary(metadata = {}) {
  const parts = [];

  if (metadata.maturity) parts.push(formatLabel(metadata.maturity));
  if (metadata.confidence) parts.push(`${formatLabel(metadata.confidence)} confidence`);
  if (metadata.scope_relationship === 'personal_household_overlap') {
    parts.push('Personal + household overlap');
  } else if (metadata.scope) {
    parts.push(formatLabel(metadata.scope));
  }
  if (metadata.category_trust_score != null) {
    const score = Number(metadata.category_trust_score || 0);
    if (score >= 0.9) parts.push('Strong category signal');
    else if (score >= 0.75) parts.push('Solid category signal');
    else if (score >= 0.55) parts.push('Mixed category signal');
    else parts.push('Weak category signal');
  }
  if (metadata.category_name) parts.push(metadata.category_name);
  else if (metadata.merchant_name) parts.push(metadata.merchant_name);

  if (!parts.length) return 'Scoring context and hierarchy for this card.';
  return parts.slice(0, 4).join(' • ');
}

function categorySignalCopy(metadata = {}) {
  if (metadata.category_trust_score == null) return null;
  const trustScore = Number(metadata.category_trust_score || 0);
  const trustedCount = Number(metadata.category_trusted_count || 0);
  const lowConfidenceCount = Number(metadata.category_low_confidence_count || 0);

  if (trustScore >= 0.9) {
    return `This card is leaning on strong category history${trustedCount > 0 ? ` across ${trustedCount} trusted expense${trustedCount === 1 ? '' : 's'}` : ''}.`;
  }
  if (trustScore >= 0.75) {
    return `Most of the supporting expenses were categorized with stable signals${trustedCount > 0 ? ` (${trustedCount} trusted)` : ''}.`;
  }
  if (trustScore >= 0.55) {
    return `This is directionally useful, but some of the supporting expenses still have mixed category quality${lowConfidenceCount > 0 ? ` (${lowConfidenceCount} low-confidence)` : ''}.`;
  }
  return `This pattern is built on weak category quality right now${lowConfidenceCount > 0 ? ` (${lowConfidenceCount} low-confidence)` : ''}, so it should be treated as a softer read.`;
}

function whatChangedCopy(metadata = {}, body = '') {
  const headline = body || 'This signal stands out in your recent activity.';
  const facts = [];
  if (metadata.category_name && metadata.current_spend_to_date != null) {
    facts.push(`${metadata.category_name} is at ${formatCurrency(metadata.current_spend_to_date)}`);
  } else if (metadata.merchant_name && metadata.current_spend != null) {
    facts.push(`${metadata.merchant_name} is at ${formatCurrency(metadata.current_spend)}`);
  } else if (metadata.current_spend != null) {
    facts.push(`Current spend is ${formatCurrency(metadata.current_spend)}`);
  }
  if (metadata.previous_spend != null) {
    facts.push(`previously ${formatCurrency(metadata.previous_spend)}`);
  }
  if (metadata.expense_count != null) {
    facts.push(`${metadata.expense_count} ${metadata.expense_count === 1 ? 'expense' : 'expenses'}`);
  }
  if (metadata.active_day_count != null) {
    facts.push(`${metadata.active_day_count} active days`);
  }

  return {
    headline,
    facts: facts.slice(0, 3).join(' • ') || null,
  };
}

function whyItMattersCopy(insightType, metadata = {}) {
  if (`${insightType}`.startsWith('early_')) {
    return 'This is meant to catch a direction early, while there is still time to adjust before it becomes a bigger pattern.';
  }
  if (`${insightType}`.startsWith('developing_')) {
    return 'This pattern is forming, but it is still early enough to steer with a small change.';
  }
  if (metadata.scope_relationship === 'personal_household_overlap') {
    return 'Your own spending is driving part of the shared household picture, so a personal change can have a visible household effect.';
  }
  if (metadata.scope === 'household') {
    return 'This affects the shared budget, so it is useful for planning together instead of reacting later.';
  }
  return 'This is a useful pressure point because it changes how your month is trending right now.';
}

function nextStepCopy(descriptor, primaryAction) {
  return {
    title: primaryAction?.title || descriptor.label,
    body: primaryAction?.body || descriptor.reason,
    cta: primaryAction?.cta || null,
  };
}

function contextCopy(type) {
  if (`${type}`.startsWith('early_')) {
    return 'This is an early read. It is meant to be useful before there is enough history for a mature trend.';
  }
  if (`${type}`.startsWith('developing_')) {
    return 'This is a developing read from short-term activity. It should get more tailored as the pattern either repeats or fades.';
  }
  return 'This card is based on the current insight signal and your recent activity.';
}

function consolidatedCopy(metadata = {}) {
  if (metadata.scope_relationship !== 'personal_household_overlap') return null;
  const foldedCount = Array.isArray(metadata.related_insight_ids) ? metadata.related_insight_ids.length : 0;
  if (foldedCount > 0) {
    return 'A similar household card was folded into this one, so you can start from your own spending pattern and then see how it carries into the shared picture.';
  }
  return 'This card starts with your personal signal and layers in the overlapping household impact.';
}

function consolidatedRows(metadata = {}) {
  const rows = Array.isArray(metadata.consolidated_from) ? metadata.consolidated_from : [];
  return rows
    .map((row) => ({
      id: row.id || `${row.scope || 'scope'}:${row.type || 'insight'}`,
      scope: row.scope ? formatLabel(row.scope) : 'Unknown',
      type: row.type ? formatLabel(row.type) : 'Insight',
      maturity: row.maturity ? formatLabel(row.maturity) : null,
      severity: row.severity ? formatLabel(row.severity) : null,
    }))
    .slice(0, 4);
}

function evidenceModeForInsight(insightType, metadata = {}) {
  const type = `${insightType || ''}`;
  if (type === 'early_cleanup') return 'cleanup';
  if (metadata.category_key) return 'category';
  if (metadata.merchant_key || metadata.merchant_name) return 'merchant';
  if (metadata.largest_expense) return 'largest_expense';
  return null;
}

function evidenceTitle(mode, metadata = {}) {
  if (mode === 'cleanup') return 'Expenses to clean up';
  if (mode === 'category') return `${metadata.category_name || 'Category'} activity`;
  if (mode === 'merchant') return `${metadata.merchant_name || 'Merchant'} activity`;
  if (mode === 'largest_expense') return 'Purchase behind the read';
  return 'Recent evidence';
}

function merchantComparisonRows(metadata = {}) {
  const rows = Array.isArray(metadata.merchant_breakdown) ? metadata.merchant_breakdown : [];
  return rows
    .filter((row) => row?.merchant)
    .map((row) => ({
      merchant: row.merchant,
      occurrence_count: Number(row.occurrence_count || 0),
      median_amount: row.median_amount == null ? null : Number(row.median_amount),
      median_unit_price: row.median_unit_price == null ? null : Number(row.median_unit_price),
      last_purchased_at: row.last_purchased_at || null,
    }));
}

function purchaseHistoryRows(metadata = {}) {
  const rows = Array.isArray(metadata.purchases) ? metadata.purchases : [];
  return rows
    .filter(Boolean)
    .map((row, index) => ({
      id: `${row.date || 'date'}:${row.merchant || 'merchant'}:${index}`,
      date: row.date || null,
      merchant: row.merchant || null,
      amount: row.amount == null ? null : Number(row.amount),
      estimated_unit_price: row.estimated_unit_price == null ? null : Number(row.estimated_unit_price),
      normalized_total_size_value: row.normalized_total_size_value == null ? null : Number(row.normalized_total_size_value),
      normalized_total_size_unit: row.normalized_total_size_unit || null,
    }));
}

function parseJsonParam(value, fallback = null) {
  if (!value) return fallback;
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return fallback;
  try {
    return JSON.parse(`${raw}`);
  } catch {
    return fallback;
  }
}

export default function InsightDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const payloadKey = firstParam(params.payload_key);
  const navPayload = useMemo(() => consumeNavigationPayload(payloadKey, null), [payloadKey]);
  const insightId = firstParam(params.insight_id);
  const insightType = firstParam(params.insight_type);
  const title = firstParam(params.title, 'Insight detail');
  const body = firstParam(params.body);
  const severity = firstParam(params.severity, 'low');
  const entityType = firstParam(params.entity_type);
  const entityId = firstParam(params.entity_id);
  const metadataParam = firstParam(params.metadata);
  const preloadEvidenceParam = firstParam(params.preload_evidence);
  const actionParam = firstParam(params.action);
  const [storedSnapshot, setStoredSnapshot] = useState(null);
  const [remoteInsight, setRemoteInsight] = useState(null);
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [showFeedbackSheet, setShowFeedbackSheet] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState('');
  const [feedbackNote, setFeedbackNote] = useState('');
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!insightId) return undefined;
    loadInsightDetailSnapshot(insightId)
      .then((snapshot) => {
        if (!cancelled) setStoredSnapshot(snapshot);
      })
      .catch(() => {
        if (!cancelled) setStoredSnapshot(null);
      });
    return () => { cancelled = true; };
  }, [insightId]);

  useEffect(() => {
    let cancelled = false;
    if (!insightId) return undefined;
    api.get(`/insights/${encodeURIComponent(insightId)}`)
      .then((freshInsight) => {
        if (cancelled || !freshInsight) return;
        setRemoteInsight(freshInsight);
        saveInsightDetailSnapshot(freshInsight, { preloadEvidence: [] }).catch(() => {});
      })
      .catch(() => {
        if (!cancelled) setRemoteInsight(null);
      });
    return () => { cancelled = true; };
  }, [insightId]);

  const metadata = useMemo(
    () => remoteInsight?.metadata || navPayload?.metadata || storedSnapshot?.insight?.metadata || parseJsonParam(metadataParam, {}),
    [metadataParam, navPayload, remoteInsight, storedSnapshot]
  );
  const preloadedEvidence = useMemo(() => {
    const rows = navPayload?.preloadEvidence
      || storedSnapshot?.extras?.preloadEvidence
      || parseJsonParam(preloadEvidenceParam, []);
    return Array.isArray(rows) ? rows : [];
  }, [navPayload, preloadEvidenceParam, storedSnapshot]);
  const actionPayload = useMemo(
    () => remoteInsight?.action || navPayload?.action || storedSnapshot?.insight?.action || parseJsonParam(actionParam, null),
    [actionParam, navPayload, remoteInsight, storedSnapshot]
  );

  const insight = useMemo(() => ({
    id: `${insightId}`,
    type: `${remoteInsight?.type || insightType}`,
    title: `${remoteInsight?.title || title}`,
    body: `${remoteInsight?.body || body}`,
    severity: `${remoteInsight?.severity || severity}`,
    entity_type: `${remoteInsight?.entity_type || entityType}`,
    entity_id: `${remoteInsight?.entity_id || entityId}`,
    metadata,
    action: actionPayload,
  }), [insightId, remoteInsight, insightType, title, body, severity, entityType, entityId, metadata, actionPayload]);

  const primaryAction = useMemo(() => {
    if (insight?.action) return insight.action;
    return getPrimaryActionForInsight({
      insightType: `${insightType}`,
      scope: metadata.scope || 'personal',
      month: metadata.month || '',
      categoryKey: metadata.category_key || '',
      metadata,
      trend: null,
    });
  }, [insight?.action, insightType, metadata]);
  const descriptor = getInsightActionDescriptor(insight);
  const scopeLabel = getInsightScopeLabel(insight);
  const stage = getInsightStageDescriptor(insight);
  const supportRows = getInsightSupportRows(insight, { limit: 4 });
  const technicalRows = getInsightTechnicalRows(insight);
  const technicalSummary = getInsightTechnicalSummary(insight);
  const categorySignal = categorySignalCopy(metadata);
  const consolidationNote = consolidatedCopy(metadata);
  const consolidationRows = consolidatedRows(metadata);
  const evidenceMode = evidenceModeForInsight(insightType, metadata);
  const changed = whatChangedCopy(metadata, body);
  const whyItMatters = whyItMattersCopy(insightType, metadata);
  const nextStep = nextStepCopy(descriptor, primaryAction);
  const planningNextStep = `${insightType}` === 'usage_ready_to_plan'
    ? planningActionSummary(metadata)
    : null;
  const merchantComparisons = merchantComparisonRows(metadata);
  const purchaseHistory = purchaseHistoryRows(metadata);
  const hasSupportingDetail = merchantComparisons.length > 0 || purchaseHistory.length > 0 || !!evidenceMode;
  const hasBehindRead = technicalRows.length > 0 || !!categorySignal || !!consolidationNote || consolidationRows.length > 0;
  function handleOpenExpense(expense) {
    openExpenseDetail(router, expense);
  }
  const [evidenceRows, setEvidenceRows] = useState(() => {
    if (evidenceMode === 'largest_expense') {
      return metadata.largest_expense ? [metadata.largest_expense] : [];
    }
    return preloadedEvidence;
  });
  const [evidenceLoading, setEvidenceLoading] = useState(() => {
    if (!evidenceMode || evidenceMode === 'largest_expense') return false;
    return !preloadedEvidence.length;
  });

  useEffect(() => {
    let cancelled = false;

    async function loadEvidence() {
      if (!evidenceMode || evidenceMode === 'largest_expense') {
        const largest = metadata.largest_expense;
        setEvidenceRows(largest ? [largest] : []);
        setEvidenceLoading(false);
        return;
      }
      if (!metadata.month) {
        setEvidenceRows([]);
        setEvidenceLoading(false);
        return;
      }

      try {
        if (!preloadedEvidence.length) setEvidenceLoading(true);
        const cacheKey = `cache:insight-evidence:${metadata.scope === 'household' ? 'household' : 'personal'}:${metadata.month}:${evidenceMode}:${metadata.category_key || metadata.merchant_key || metadata.merchant_name || insightType}`;
        await loadWithCache(
          cacheKey,
          async () => {
            const endpoint = metadata.scope === 'household' ? '/expenses/household' : '/expenses';
            const params = new URLSearchParams({ month: `${metadata.month}` });
            if (evidenceMode === 'category' && metadata.category_key) {
              params.set('category_id', `${metadata.category_key}`);
            }
            if (evidenceMode === 'cleanup') {
              params.set('category_id', 'uncategorized');
            }
            const rows = await api.get(`${endpoint}?${params.toString()}`);
            const cleanRows = Array.isArray(rows) ? rows : [];
            return selectInsightEvidence(cleanRows, evidenceMode, metadata, 5);
          },
          (rows) => {
            if (!cancelled) {
              setEvidenceRows(Array.isArray(rows) ? rows : []);
              setEvidenceLoading(false);
            }
          },
          () => {
            if (!cancelled) {
              if (!preloadedEvidence.length) setEvidenceRows([]);
              setEvidenceLoading(false);
            }
          }
        );
      } catch {
        if (!cancelled) {
          if (!preloadedEvidence.length) setEvidenceRows([]);
          setEvidenceLoading(false);
        }
      } finally {
        if (!cancelled && preloadedEvidence.length) setEvidenceLoading(false);
      }
    }

    loadEvidence();
    return () => { cancelled = true; };
  }, [evidenceMode, metadata, insightType, preloadedEvidence]);

  async function submitFeedback(eventType) {
    if (!insightId || !eventType || feedbackStatus === eventType) return;
    try {
      await api.post('/insights/events', {
        events: [{
          insight_id: `${insightId}`,
          event_type: eventType,
          metadata: {
            surface: 'insight_detail',
            insight_type: `${insightType}`,
            type: `${insightType}`,
            maturity: metadata.maturity || null,
            confidence: metadata.confidence || null,
            scope: metadata.scope || null,
            entity_type: `${entityType}` || null,
            entity_id: `${entityId}` || null,
            category_key: metadata.category_key || null,
            merchant_key: metadata.merchant_key || null,
            scope_relationship: metadata.scope_relationship || null,
            scope_origin: metadata.scope_origin || null,
            rolls_up_from_personal: metadata.rolls_up_from_personal ?? null,
            household_context_included: metadata.household_context_included ?? null,
            hierarchy_level: metadata.hierarchy_level || null,
            consolidated_scopes: metadata.consolidated_scopes || null,
            related_insight_ids: metadata.related_insight_ids || null,
          },
        }],
      });
      setFeedbackStatus(eventType);
    } catch {
      // Non-fatal
    }
  }

  async function submitNegativeFeedback() {
    if (!insightId || !feedbackReason) return;
    try {
      await api.post('/insights/events', {
        events: [{
          insight_id: `${insightId}`,
          event_type: 'not_helpful',
          metadata: {
            surface: 'insight_detail',
            insight_type: `${insightType}`,
            type: `${insightType}`,
            maturity: metadata.maturity || null,
            confidence: metadata.confidence || null,
            scope: metadata.scope || null,
            entity_type: `${entityType}` || null,
            entity_id: `${entityId}` || null,
            category_key: metadata.category_key || null,
            merchant_key: metadata.merchant_key || null,
            scope_relationship: metadata.scope_relationship || null,
            scope_origin: metadata.scope_origin || null,
            rolls_up_from_personal: metadata.rolls_up_from_personal ?? null,
            household_context_included: metadata.household_context_included ?? null,
            hierarchy_level: metadata.hierarchy_level || null,
            consolidated_scopes: metadata.consolidated_scopes || null,
            related_insight_ids: metadata.related_insight_ids || null,
            reason: feedbackReason,
            note: feedbackNote.trim() || null,
          },
        }],
      });
      setFeedbackStatus('not_helpful');
      setFeedbackReason('');
      setFeedbackNote('');
      setShowFeedbackSheet(false);
    } catch {
      // Non-fatal
    }
  }

  function openPrimaryAction() {
    if (insight?.action?.route) {
      router.push(insight.action.route);
      return;
    }
    if (`${insightType}` === 'usage_ready_to_plan') {
      const payloadKey = stashNavigationPayload({
        planningInsight: {
          id: insightId,
          title,
          body,
          metadata,
        },
      }, 'scenario-check');
      router.push({
        pathname: '/scenario-check',
        params: {
          scope: metadata.scope || 'personal',
          month: metadata.month || '',
          payload_key: payloadKey,
        },
      });
      return;
    }
    if (primaryAction?.route) router.push(primaryAction.route);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Insight detail', headerBackTitle: 'Summary' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.chipRow}>
            <Text style={styles.scopeChip}>{scopeLabel}</Text>
          </View>
          <Text style={styles.heroTitle}>{title}</Text>
          <Text style={styles.heroCopy}>{changed.headline}</Text>
          {changed.facts ? <Text style={styles.heroFacts}>{changed.facts}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardEyebrow}>Why this matters</Text>
          <Text style={styles.cardTitle}>Why this matters</Text>
          <Text style={styles.cardCopy}>{whyItMatters}</Text>
          <Text style={styles.cardSupportTitle}>What this is picking up</Text>
          <Text style={styles.cardCopy}>{contextCopy(insightType)}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardEyebrow}>What to do</Text>
          <Text style={styles.cardTitle}>{planningNextStep?.title || nextStep.title}</Text>
          <Text style={styles.cardCopy}>{planningNextStep?.body || nextStep.body || descriptor.reason}</Text>
          {primaryAction?.route && nextStep.cta ? (
            <>
              <Text style={styles.cardSupportTitle}>Suggested move</Text>
              <Text style={styles.cardCopy}>{nextStep.cta}</Text>
            </>
          ) : null}
          {primaryAction?.route && nextStep.cta ? (
            <TouchableOpacity style={styles.primaryButton} onPress={openPrimaryAction}>
              <Text style={styles.primaryButtonText}>{nextStep.cta}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardEyebrow}>How strong the read is</Text>
          <Text style={styles.cardTitle}>{stage.label}</Text>
          <Text style={styles.cardCopy}>
            {technicalSummary || stage.detail || 'This is the current read strength behind the card.'}
          </Text>
          {technicalRows.length > 0 ? (
            <View style={styles.metricList}>
              {technicalRows.slice(0, 4).map((row) => (
                <View key={row.label} style={styles.metricRow}>
                  <Text style={styles.metricLabel}>{row.label}</Text>
                  <Text style={styles.metricValue}>{row.value}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {categorySignal ? <Text style={styles.technicalHint}>{categorySignal}</Text> : null}
        </View>

        {(supportRows.length > 0 || hasSupportingDetail || consolidationNote || consolidationRows.length > 0) ? (
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.technicalHeader}
              onPress={() => setShowTechnicalDetails((value) => !value)}
              activeOpacity={0.7}
            >
              <View style={styles.technicalHeaderText}>
                <Text style={styles.cardEyebrow}>Supporting detail</Text>
                <Text style={styles.cardTitle}>Open the full detail</Text>
              </View>
              <Text style={styles.technicalToggle}>{showTechnicalDetails ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
            <Text style={styles.cardCopy}>
              {showTechnicalDetails
                ? 'This is the full supporting data, evidence, and signal context behind the card.'
                : 'Open this if you want the supporting data and the fuller trail behind the insight.'}
            </Text>
            {showTechnicalDetails && supportRows.length > 0 ? (
              <View style={styles.supportBlock}>
                <Text style={styles.supportBlockTitle}>At a glance</Text>
                <View style={styles.metricList}>
                  {supportRows.map((row) => (
                    <View key={row.label} style={styles.metricRow}>
                      <Text style={styles.metricLabel}>{row.label}</Text>
                      <Text style={styles.metricValue}>{row.value}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {showTechnicalDetails && merchantComparisons.length > 0 ? (
              <View style={styles.supportBlock}>
                <Text style={styles.supportBlockTitle}>Merchant comparison</Text>
                <View style={styles.metricList}>
                  {merchantComparisons.map((row) => {
                    const comparisonValue = row.median_unit_price != null
                      ? `${formatCurrency(row.median_unit_price)} / ${metadata.normalized_total_size_unit || 'unit'}`
                      : formatCurrency(row.median_amount);
                    const detail = [
                      row.occurrence_count ? `${row.occurrence_count}x` : null,
                      row.last_purchased_at ? formatShortDate(row.last_purchased_at) : null,
                    ].filter(Boolean).join(' / ');
                    return (
                      <View key={row.merchant} style={styles.metricRow}>
                        <View style={styles.metricTextBlock}>
                          <Text style={styles.metricMerchant}>{row.merchant}</Text>
                          {detail ? <Text style={styles.metricSub}>{detail}</Text> : null}
                        </View>
                        <Text style={styles.metricValue}>{comparisonValue || 'n/a'}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {showTechnicalDetails && purchaseHistory.length > 0 ? (
              <View style={styles.supportBlock}>
                <Text style={styles.supportBlockTitle}>Recent purchases</Text>
                <View style={styles.expenseList}>
                  {purchaseHistory.slice().reverse().map((purchase) => {
                    const unitDetail = purchase.estimated_unit_price != null
                      ? `${formatCurrency(purchase.estimated_unit_price)} / ${purchase.normalized_total_size_unit || 'unit'}`
                      : null;
                    const purchaseId = purchase.id || purchase.expense_id || null;
                    return (
                      <TouchableOpacity
                        key={purchaseId || `${purchase.date}:${purchase.merchant}:${purchase.amount}`}
                        style={styles.expenseRow}
                        activeOpacity={purchaseId ? 0.82 : 1}
                        disabled={!purchaseId}
                        onPress={() => handleOpenExpense(purchase)}
                      >
                        <View style={styles.expenseText}>
                          <Text style={styles.expenseMerchant}>{purchase.merchant || 'Unknown merchant'}</Text>
                          <Text style={styles.expenseMeta}>
                            {[formatShortDate(purchase.date), unitDetail].filter(Boolean).join(' / ')}
                          </Text>
                        </View>
                        <Text style={styles.expenseAmount}>{formatCurrency(purchase.amount)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {showTechnicalDetails && evidenceMode ? (
              <View style={styles.supportBlock}>
                <Text style={styles.supportBlockTitle}>{evidenceTitle(evidenceMode, metadata)}</Text>
                {evidenceLoading ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color="#d4d4d4" size="small" />
                    <Text style={styles.loadingText}>Loading recent activity...</Text>
                  </View>
                ) : evidenceRows.length > 0 ? (
                  <View style={styles.expenseList}>
                    {evidenceRows.map((expense, index) => (
                      <TouchableOpacity
                        key={expense.id || `${expense.merchant || 'expense'}:${index}`}
                        style={styles.expenseRow}
                        activeOpacity={expense.id ? 0.82 : 1}
                        disabled={!expense.id}
                        onPress={() => handleOpenExpense(expense)}
                      >
                        <View style={styles.expenseText}>
                          <Text style={styles.expenseMerchant}>{expense.merchant || 'Unknown merchant'}</Text>
                          <Text style={styles.expenseMeta}>
                            {[formatShortDate(expense.date), expense.category_name, expense.user_name].filter(Boolean).join(' / ')}
                          </Text>
                        </View>
                        <Text style={styles.expenseAmount}>{formatCurrency(expense.amount)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.cardCopy}>No matching recent expenses are available for this card yet.</Text>
                )}
              </View>
            ) : null}

            {showTechnicalDetails && consolidationNote ? (
              <View style={styles.technicalNoteBlock}>
                <Text style={styles.supportBlockTitle}>Combined signals</Text>
                <Text style={styles.cardCopy}>{consolidationNote}</Text>
                {consolidationRows.length > 0 ? (
                  <View style={styles.foldedList}>
                    {consolidationRows.map((row) => (
                      <View key={row.id} style={styles.foldedRow}>
                        <View style={styles.foldedText}>
                          <Text style={styles.foldedScope}>{row.scope}</Text>
                          <Text style={styles.foldedType}>{row.type}</Text>
                        </View>
                        <Text style={styles.foldedMeta}>
                          {[row.maturity, row.severity].filter(Boolean).join(' / ')}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardEyebrow}>Feedback</Text>
          <Text style={styles.cardTitle}>Was this useful?</Text>
          <Text style={styles.cardCopy}>Your feedback helps Adlo learn whether early signals are useful now or should wait until they are more specific.</Text>
          <View style={styles.feedbackRow}>
            <TouchableOpacity
              style={[styles.feedbackButton, feedbackStatus === 'helpful' && styles.feedbackButtonActive]}
              onPress={() => submitFeedback('helpful')}
            >
              <Text style={[styles.feedbackButtonText, feedbackStatus === 'helpful' && styles.feedbackButtonTextActive]}>Helpful</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.feedbackButton, feedbackStatus === 'not_helpful' && styles.feedbackButtonActive]}
              onPress={() => setShowFeedbackSheet(true)}
            >
              <Text style={[styles.feedbackButtonText, feedbackStatus === 'not_helpful' && styles.feedbackButtonTextActive]}>Not helpful</Text>
            </TouchableOpacity>
          </View>
          {feedbackStatus ? (
            <Text style={styles.feedbackNote}>Thanks. We will use this to tune future insight timing.</Text>
          ) : null}
        </View>
      </ScrollView>

      <Modal
        visible={showFeedbackSheet}
        animationType="slide"
        transparent
        onRequestClose={() => setShowFeedbackSheet(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>What felt off?</Text>
            <View style={styles.reasonGrid}>
              {FEEDBACK_REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason.key}
                  style={[styles.reasonChip, feedbackReason === reason.key && styles.reasonChipActive]}
                  onPress={() => setFeedbackReason(reason.key)}
                >
                  <Text style={[styles.reasonChipText, feedbackReason === reason.key && styles.reasonChipTextActive]}>
                    {reason.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              value={feedbackNote}
              onChangeText={setFeedbackNote}
              style={styles.noteInput}
              placeholder="Optional note"
              placeholderTextColor="#666"
              multiline
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalSecondaryButton} onPress={() => setShowFeedbackSheet(false)}>
                <Text style={styles.modalSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalPrimaryButton, !feedbackReason && styles.modalPrimaryButtonDisabled]}
                onPress={submitNegativeFeedback}
                disabled={!feedbackReason}
              >
                <Text style={styles.modalPrimaryText}>Send feedback</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0a0a0a' },
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 36, gap: 16 },
  hero: {
    backgroundColor: '#141414',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#262626',
    padding: 18,
    gap: 12,
  },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  scopeChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#e5f7ed',
    color: '#14532d',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },
  tierChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#fef3c7',
    color: '#78350f',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },
  combinedChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#dbeafe',
    color: '#1e3a8a',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },
  heroTitle: { color: '#f5f5f5', fontSize: 24, fontWeight: '800', lineHeight: 30 },
  heroCopy: { color: '#d4d4d4', fontSize: 15, lineHeight: 22 },
  heroFacts: { color: '#f5f5f5', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  heroContext: { color: '#9d9d9d', fontSize: 13, lineHeight: 19 },
  contextBanner: {
    backgroundColor: '#101412',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f2c26',
    padding: 14,
    gap: 10,
  },
  contextBannerTitle: { color: '#def7e8', fontSize: 14, fontWeight: '700' },
  contextBannerCopy: { color: '#b8d8c4', fontSize: 13, lineHeight: 19 },
  card: {
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#242424',
    padding: 16,
    gap: 12,
  },
  cardEyebrow: { color: '#8a8a8a', fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  cardTitle: { color: '#f5f5f5', fontSize: 16, fontWeight: '700' },
  cardSupportTitle: { color: '#e5e5e5', fontSize: 12, fontWeight: '700', marginTop: 2 },
  cardCopy: { color: '#b8b8b8', fontSize: 13, lineHeight: 19 },
  foldedList: { gap: 8 },
  foldedRow: {
    borderTopWidth: 1,
    borderTopColor: '#242424',
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  foldedText: { flex: 1 },
  foldedScope: { color: '#f5f5f5', fontSize: 13, fontWeight: '700' },
  foldedType: { color: '#8a8a8a', fontSize: 12, marginTop: 2 },
  foldedMeta: { color: '#b8b8b8', fontSize: 12, textAlign: 'right', flexShrink: 0 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loadingText: { color: '#b8b8b8', fontSize: 13 },
  expenseList: { gap: 8 },
  expenseRow: {
    borderTopWidth: 1,
    borderTopColor: '#242424',
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  expenseText: { flex: 1 },
  expenseMerchant: { color: '#f5f5f5', fontSize: 14, fontWeight: '700' },
  expenseMeta: { color: '#8a8a8a', fontSize: 12, marginTop: 2 },
  expenseAmount: { color: '#f5f5f5', fontSize: 14, fontWeight: '800' },
  primaryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryButtonText: { color: '#0a0a0a', fontSize: 13, fontWeight: '800' },
  technicalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  technicalHeaderText: { flex: 1, gap: 4 },
  technicalToggle: { color: '#d4d4d4', fontSize: 13, fontWeight: '700' },
  metricList: { gap: 0 },
  supportBlock: { gap: 10 },
  supportBlockTitle: { color: '#e5e5e5', fontSize: 13, fontWeight: '700' },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#242424',
    paddingTop: 10,
  },
  metricTextBlock: { flex: 1 },
  metricLabel: { color: '#8a8a8a', fontSize: 12, flex: 1 },
  metricMerchant: { color: '#f5f5f5', fontSize: 13, fontWeight: '700' },
  metricSub: { color: '#8a8a8a', fontSize: 12, marginTop: 2 },
  metricValue: { color: '#f5f5f5', fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' },
  technicalHint: { color: '#a9a39a', fontSize: 12, lineHeight: 18, marginTop: -2 },
  technicalNoteBlock: { gap: 10, marginTop: 4 },
  feedbackRow: { flexDirection: 'row', gap: 10 },
  feedbackButton: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    paddingVertical: 11,
    alignItems: 'center',
  },
  feedbackButtonActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  feedbackButtonText: { color: '#d4d4d4', fontSize: 13, fontWeight: '700' },
  feedbackButtonTextActive: { color: '#0a0a0a' },
  feedbackNote: { color: '#86efac', fontSize: 12, lineHeight: 18 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#111',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 1,
    borderColor: '#262626',
    padding: 20,
    gap: 14,
  },
  modalTitle: { color: '#f5f5f5', fontSize: 18, fontWeight: '800' },
  reasonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  reasonChip: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  reasonChipActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  reasonChipText: { color: '#d4d4d4', fontSize: 13, fontWeight: '700' },
  reasonChipTextActive: { color: '#0a0a0a' },
  noteInput: {
    minHeight: 84,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    color: '#f5f5f5',
    padding: 12,
    textAlignVertical: 'top',
  },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalSecondaryButton: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
    paddingVertical: 12,
  },
  modalSecondaryText: { color: '#d4d4d4', fontSize: 13, fontWeight: '700' },
  modalPrimaryButton: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    paddingVertical: 12,
  },
  modalPrimaryButtonDisabled: { opacity: 0.4 },
  modalPrimaryText: { color: '#0a0a0a', fontSize: 13, fontWeight: '800' },
});
