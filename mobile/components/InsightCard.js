import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/tokens';
import { InsightTrendVisual } from './InsightTrendVisual';
import {
  getInsightActionDescriptor,
  getInsightPrimaryMetric,
  getInsightScopeLabel,
} from '../services/insightPresentation';
const { getInsightTrendVisual } = require('../services/insightTrendVisual');

const INSIGHT_CARD_MIN_HEIGHT = 164;
const INSIGHT_SUMMARY_TITLE_LINES = 2;
const INSIGHT_SUMMARY_BODY_LINES = 2;

function pluralVerb(label, singular, plural) {
  return `${label || ''}`.trim().toLowerCase().endsWith('s') ? plural : singular;
}

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

function insightActionLabel(insight) {
  const descriptor = getInsightActionDescriptor(insight);
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
  if (!body || !metricValue) return false;
  return !body.includes(metricValue);
}

function insightDisplayTitle(insight) {
  const type = `${insight?.type || ''}`;
  const metadata = insight?.metadata || {};
  const categoryName = metadata.category_name;
  const merchantName = metadata.merchant_name;

  if (categoryName && (
    type === 'early_top_category'
    || type === 'developing_category_shift'
    || type === 'top_category_driver'
    || type === 'projected_category_surge'
  )) {
    return `${categoryName} ${pluralVerb(categoryName, 'is', 'are')} driving the week`;
  }
  if (categoryName && type === 'projected_category_under_baseline') {
    return `${categoryName} ${pluralVerb(categoryName, 'has', 'have')} room`;
  }
  if (merchantName && (type === 'early_repeated_merchant' || type === 'developing_repeated_merchant')) {
    return `${merchantName} is repeating`;
  }
  if (type === 'developing_weekly_spend_change') return 'The week is picking up';
  if (type === 'one_off_expense_skewing_projection' || type === 'one_offs_driving_variance') return 'One purchase is skewing the month';
  return insight?.title || 'Insight';
}

function insightDisplayBody(insight) {
  const type = `${insight?.type || ''}`;
  const metadata = insight?.metadata || {};
  const categoryName = metadata.category_name;
  const scopeRelationship = metadata.scope_relationship;
  const householdCarry = scopeRelationship === 'personal_household_overlap'
    ? ' It is also affecting the household view.'
    : '';

  if (categoryName && (type === 'early_top_category' || type === 'developing_category_shift' || type === 'top_category_driver')) {
    return scopeRelationship === 'personal_household_overlap'
      ? `Recent spending is unusually ${categoryName.toLowerCase()}-heavy, and it is affecting the household view.`
      : `Recent spending is unusually ${categoryName.toLowerCase()}-heavy.`;
  }
  if (categoryName && type === 'projected_category_surge') {
    return `${categoryName} is tracking above its usual month-end shape.${householdCarry}`;
  }
  if (type === 'developing_weekly_spend_change') {
    return `The last 7 days are running heavier than the prior week.${householdCarry}`;
  }
  if (type === 'one_off_expense_skewing_projection' || type === 'one_offs_driving_variance') {
    const merchant = metadata.largest_expense?.merchant || metadata.top_unusual_expense?.merchant;
    return merchant ? `${merchant} is making the forecast look heavier than the underlying pattern.` : 'A larger purchase is making the forecast look heavier than the underlying pattern.';
  }
  return insight?.body || '';
}

export function InsightCard({ insight, width, onPress, onDismiss, disabled = false, emphasis = 'default' }) {
  const tone = insightToneStyles(insight);
  const primaryMetric = getInsightPrimaryMetric(insight);
  const showPrimaryMetric = shouldShowPrimaryMetric(insight, primaryMetric);
  const isPrimary = emphasis === 'primary';
  const scopeLabel = getInsightScopeLabel(insight);
  const roleLabel = insightRoleLabel(insight);
  const trendVisual = getInsightTrendVisual(insight);
  const displayTitle = insightDisplayTitle(insight);
  const displayBody = insightDisplayBody(insight);

  return (
    <TouchableOpacity
      style={[
        styles.insightCard,
        tone.card,
        isPrimary && styles.insightCardPrimary,
        disabled && styles.insightCardDisabled,
        { width },
      ]}
      activeOpacity={0.92}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onPress?.(insight)}
    >
      <View style={styles.insightHeader}>
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
            onPress={(event) => {
              event?.stopPropagation?.();
              onDismiss?.(insight);
            }}
            disabled={disabled}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Dismiss insight: ${displayTitle}`}
          >
            <Ionicons name="close" size={15} color={colors.textDisabled} />
          </TouchableOpacity>
        </View>
        <Text style={[styles.insightTitle, isPrimary && styles.insightTitlePrimary]} numberOfLines={INSIGHT_SUMMARY_TITLE_LINES}>{displayTitle}</Text>
        {showPrimaryMetric ? (
          <View style={[styles.insightMetricPanel, isPrimary && styles.insightMetricPanelPrimary]}>
            <Text style={[styles.insightMetricValue, isPrimary && styles.insightMetricValuePrimary]} numberOfLines={1}>{primaryMetric.value}</Text>
            <Text style={[styles.insightMetricLabel, isPrimary && styles.insightMetricLabelPrimary]} numberOfLines={1}>{primaryMetric.label}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.insightContent}>
        <Text style={[styles.insightBody, isPrimary && styles.insightBodyPrimary]} numberOfLines={INSIGHT_SUMMARY_BODY_LINES}>{displayBody}</Text>
      </View>
      {trendVisual ? <InsightTrendVisual visual={trendVisual} compact /> : null}
      <View style={styles.insightFooter}>
        <Text style={styles.insightActionLabel} numberOfLines={1}>{insightActionLabel(insight)}</Text>
        <View style={styles.insightCTA}>
          <Ionicons name="chevron-forward" size={14} color={colors.text} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

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
    minHeight: 184,
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
  insightFooter: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  insightActionLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '700', flex: 1 },
  insightCTA: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfacePressed,
  },
  dismissButton: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
