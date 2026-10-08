import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { memo, useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/tokens';
import { InsightTrendVisual } from './InsightTrendVisual';
import {
  getInsightCardAction,
  getInsightCardCopy,
  getInsightConfidenceLabel,
  getInsightPrimaryMetric,
  getInsightScopeLabel,
  getInsightSupportRows,
  getInsightTimeframeLabel,
} from '../services/insightPresentation';
const { getInsightTrendVisual } = require('../services/insightTrendVisual');
const { normalizeDisplayText } = require('../services/text');

const INSIGHT_CARD_MIN_HEIGHT = 232;
const INSIGHT_SUMMARY_TITLE_LINES = 2;
const INSIGHT_SUMMARY_BODY_LINES = 1;

function insightRoleLabel(insight) {
  const type = `${insight?.type || ''}`;
  if (type.startsWith('early_')) return type === 'early_cleanup' ? 'Setup' : 'Learning';
  if (type.startsWith('developing_')) return 'Shift';
  if (type === 'usage_set_budget') return 'Setup';
  if (type === 'usage_start_logging' || type === 'usage_building_history') return 'Learning';
  if (
    type === 'one_offs_driving_variance'
    || type === 'one_off_expense_skewing_projection'
    || type === 'top_category_driver'
    || type === 'projected_category_surge'
    || type === 'recurring_cost_pressure'
  ) {
    return 'Driver';
  }
  if (type === 'projected_month_end_over_budget' || type === 'budget_too_low') return 'Act';
  if (type === 'projected_month_end_under_budget' || type === 'projected_category_under_baseline' || type === 'usage_ready_to_plan') return 'Plan';
  if (insight?.entity_type === 'item') return 'Act';
  return 'Review';
}

function insightActionLabel(insight, descriptor) {
  const label = descriptor.label;
  if (`${label}`.toLowerCase() === 'open detail') {
    const type = `${insight?.type || ''}`;
    if (type.includes('category') || insight?.metadata?.category_name) return 'Inspect driver';
    if (type.includes('one_off')) return 'Review purchase';
    return 'Review evidence';
  }
  return label;
}

function insightToneStyles(insight) {
  const role = insightRoleLabel(insight);
  if (role === 'Act') {
    return {
      card: styles.insightCardWarn,
      roleChip: styles.insightRoleChipWarn,
      roleText: styles.insightRoleTextWarn,
    };
  }
  if (role === 'Plan') {
    return {
      card: styles.insightCardPlan,
      roleChip: styles.insightRoleChipPlan,
      roleText: styles.insightRoleTextPlan,
    };
  }
  if (role === 'Setup') {
    return {
      card: styles.insightCardSetup,
      roleChip: styles.insightRoleChipSetup,
      roleText: styles.insightRoleTextSetup,
    };
  }
  if (role === 'Learning') {
    return {
      card: styles.insightCardLearning,
      roleChip: styles.insightRoleChipLearning,
      roleText: styles.insightRoleTextLearning,
    };
  }
  return {
    card: styles.insightCardExplain,
    roleChip: styles.insightRoleChipExplain,
    roleText: styles.insightRoleTextExplain,
  };
}

function normalizeMetricText(value) {
  return `${value || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function shouldShowPrimaryMetric(insight, primaryMetric) {
  if (!primaryMetric?.value) return false;
  const body = normalizeMetricText(insight?.body);
  const metricValue = normalizeMetricText(primaryMetric.value);
  if (!metricValue) return false;
  if (!body) return true;
  return !body.includes(metricValue);
}

function InsightCardBase({ insight, width, onPress, onAction, onDismiss, disabled = false, emphasis = 'default' }) {
  const tone = useMemo(() => insightToneStyles(insight), [insight]);
  const primaryMetric = useMemo(() => getInsightPrimaryMetric(insight), [insight]);
  const cardCopy = useMemo(() => getInsightCardCopy(insight), [insight]);
  const displayTitle = useMemo(() => normalizeDisplayText(cardCopy.title), [cardCopy]);
  const displayBody = useMemo(() => normalizeDisplayText(cardCopy.body), [cardCopy]);
  const insightForMetric = useMemo(() => ({ ...insight, body: displayBody }), [displayBody, insight]);
  const showPrimaryMetric = useMemo(
    () => shouldShowPrimaryMetric(insightForMetric, primaryMetric),
    [insightForMetric, primaryMetric]
  );
  const isPrimary = emphasis === 'primary';
  const scopeLabel = useMemo(() => getInsightScopeLabel(insight), [insight]);
  const timeframeLabel = useMemo(() => getInsightTimeframeLabel(insight), [insight]);
  const confidenceLabel = useMemo(() => getInsightConfidenceLabel(insight), [insight]);
  const roleLabel = useMemo(() => insightRoleLabel(insight), [insight]);
  const trendVisual = useMemo(() => getInsightTrendVisual(insight), [insight]);
  const actionDescriptor = useMemo(() => getInsightCardAction(insight), [insight]);
  const actionLabel = useMemo(() => normalizeDisplayText(insightActionLabel(insight, actionDescriptor)), [actionDescriptor, insight]);
  const actionReason = useMemo(() => normalizeDisplayText(actionDescriptor.reason), [actionDescriptor]);
  const evidenceRows = useMemo(() => getInsightSupportRows(insight, { limit: 3 })
    .map((row) => ({
      label: normalizeDisplayText(row.label),
      value: normalizeDisplayText(row.value),
    }))
    .filter((row) => row.label && row.value)
    .filter((row) => !showPrimaryMetric || normalizeMetricText(row.value) !== normalizeMetricText(primaryMetric?.value))
    .slice(0, 2), [insight, primaryMetric, showPrimaryMetric]);

  return (
    <View
      style={[
        styles.insightCard,
        tone.card,
        isPrimary && styles.insightCardPrimary,
        disabled && styles.insightCardDisabled,
        { width },
      ]}
    >
      <View style={styles.insightHeaderTop}>
        <View style={styles.insightMetaRow}>
          <View style={styles.insightScopeChip}>
            <Text style={styles.insightScopeText}>{scopeLabel}</Text>
          </View>
          <View style={[styles.insightRoleChip, tone.roleChip]}>
            <Text style={[styles.insightRoleText, tone.roleText]}>{roleLabel}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.dismissButton}
          onPress={() => onDismiss?.(insight)}
          disabled={disabled}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Dismiss insight: ${displayTitle}`}
        >
          <Ionicons name="close" size={15} color={colors.textDisabled} />
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={styles.insightDetailButton}
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityLabel={`Open insight details: ${displayTitle}`}
        accessibilityHint={[timeframeLabel, confidenceLabel, displayBody].filter(Boolean).join('. ')}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => onPress?.(insight)}
      >
        <View style={styles.insightHeader}>
          <Text style={styles.insightContext} numberOfLines={1}>{timeframeLabel}</Text>
          <Text style={[styles.insightTitle, isPrimary && styles.insightTitlePrimary]} numberOfLines={INSIGHT_SUMMARY_TITLE_LINES}>{displayTitle}</Text>
          {showPrimaryMetric ? (
            <View style={[styles.insightMetricPanel, isPrimary && styles.insightMetricPanelPrimary]}>
              <Text style={[styles.insightMetricValue, isPrimary && styles.insightMetricValuePrimary]} numberOfLines={1}>{primaryMetric.value}</Text>
              <Text style={[styles.insightMetricLabel, isPrimary && styles.insightMetricLabelPrimary]} numberOfLines={1}>{primaryMetric.label}</Text>
            </View>
          ) : null}
        </View>
        {displayBody ? (
          <View style={styles.insightContent}>
            <Text style={[styles.insightBody, isPrimary && styles.insightBodyPrimary]} numberOfLines={INSIGHT_SUMMARY_BODY_LINES}>{displayBody}</Text>
          </View>
        ) : null}
        {trendVisual ? (
          <InsightTrendVisual
            visual={trendVisual}
            compact
            showProjection={!showPrimaryMetric}
            showValue={!showPrimaryMetric}
          />
        ) : null}
        {evidenceRows.length > 0 ? (
          <View style={styles.evidenceBlock}>
            <View style={styles.evidenceRows}>
              {evidenceRows.map((row) => (
                <View key={`${row.label}:${row.value}`} style={styles.evidenceRow}>
                  <Text style={styles.evidenceLabel} numberOfLines={1}>{row.label}</Text>
                  <Text style={styles.evidenceValue} numberOfLines={1}>{row.value}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.insightFooter}
        activeOpacity={0.76}
        accessibilityRole="button"
        accessibilityLabel={`${actionLabel}: ${actionReason}`}
        accessibilityHint="Opens the recommended next step"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          if (onAction) onAction(insight, actionDescriptor);
          else onPress?.(insight);
        }}
      >
        <View style={styles.insightActionCopy}>
          <Text style={styles.insightActionLabel} numberOfLines={1}>{actionLabel}</Text>
        </View>
        <View style={styles.insightCTA}>
          <Ionicons name="chevron-forward" size={14} color={colors.text} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

export const InsightCard = memo(InsightCardBase);

const styles = StyleSheet.create({
  insightCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 15,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    minHeight: INSIGHT_CARD_MIN_HEIGHT,
    justifyContent: 'space-between',
  },
  insightCardPrimary: {
    minHeight: 232,
    paddingHorizontal: 17,
    paddingVertical: 14,
    borderColor: colors.infoBorder,
    backgroundColor: colors.surfaceRaised,
  },
  insightCardWarn: { borderColor: colors.dangerMuted },
  insightCardPlan: { borderColor: colors.infoMuted },
  insightCardSetup: { borderColor: colors.warningMuted },
  insightCardLearning: { borderColor: colors.successMuted },
  insightCardExplain: { borderColor: colors.border },
  insightCardDisabled: { opacity: 0.72 },
  insightDetailButton: { gap: 10 },
  insightHeader: { gap: 10 },
  insightHeaderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  insightMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  insightScopeChip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.borderSubtle,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.border,
  },
  insightScopeText: { fontSize: 11, color: colors.textMuted, fontWeight: '600', letterSpacing: 0.3 },
  insightRoleChip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
  },
  insightRoleText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  insightRoleChipWarn: { backgroundColor: colors.dangerMuted, borderColor: colors.dangerMuted },
  insightRoleChipPlan: { backgroundColor: colors.infoMuted, borderColor: colors.infoMuted },
  insightRoleChipSetup: { backgroundColor: colors.warningMuted, borderColor: colors.warningMuted },
  insightRoleChipLearning: { backgroundColor: colors.successMuted, borderColor: colors.successMuted },
  insightRoleChipExplain: { backgroundColor: colors.surfacePressed, borderColor: colors.infoMuted },
  insightRoleTextWarn: { color: colors.danger },
  insightRoleTextPlan: { color: colors.info },
  insightRoleTextSetup: { color: colors.warning },
  insightRoleTextLearning: { color: colors.success },
  insightRoleTextExplain: { color: colors.text },
  insightContext: { color: colors.textSubtle, fontSize: 11, lineHeight: 15 },
  insightTitle: { fontSize: 16, color: colors.text, fontWeight: '600', lineHeight: 21 },
  insightTitlePrimary: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  insightMetricPanel: {
    alignSelf: 'flex-start',
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingLeft: 10,
    paddingVertical: 2,
  },
  insightMetricPanelPrimary: { paddingLeft: 12 },
  insightMetricValue: {
    fontSize: 22,
    lineHeight: 26,
    color: colors.text,
    fontWeight: '750',
  },
  insightMetricValuePrimary: {
    fontSize: 28,
    lineHeight: 32,
    color: colors.text,
    fontWeight: '800',
  },
  insightMetricLabel: {
    fontSize: 10,
    lineHeight: 13,
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  insightMetricLabelPrimary: {
    color: colors.textMuted,
  },
  insightContent: { flex: 1, justifyContent: 'flex-start', marginTop: 8 },
  insightBody: { fontSize: 13, color: colors.textSubtle, lineHeight: 18 },
  insightBodyPrimary: { fontSize: 14, color: colors.text, lineHeight: 20 },
  evidenceBlock: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: 10,
    gap: 6,
  },
  evidenceRows: { gap: 6 },
  evidenceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  evidenceLabel: { color: colors.textSubtle, fontSize: 11, flex: 1 },
  evidenceValue: { color: colors.text, fontSize: 12, fontWeight: '700', textAlign: 'right', flexShrink: 1 },
  insightFooter: {
    marginTop: 12,
    minHeight: 52,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  insightActionCopy: { flex: 1 },
  insightActionLabel: { fontSize: 13, color: colors.text, fontWeight: '700' },
  insightCTA: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfacePressed,
  },
  dismissButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
