import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getInsightActionDescriptor, getInsightPrimaryMetric } from '../services/insightPresentation';

const INSIGHT_CARD_MIN_HEIGHT = 174;
const INSIGHT_SUMMARY_TITLE_LINES = 2;
const INSIGHT_SUMMARY_BODY_LINES = 3;

function insightScopeLabel(insight) {
  const scopes = Array.isArray(insight?.metadata?.consolidated_scopes)
    ? insight.metadata.consolidated_scopes
    : [];
  if (scopes.includes('personal') && scopes.includes('household')) return 'You + Household';
  if (insight?.metadata?.scope === 'personal') return 'You';
  if (insight?.metadata?.scope === 'household') return 'Household';
  return insight?.entity_type === 'item' ? 'Household' : 'You';
}

function insightRoleLabel(insight) {
  const type = `${insight?.type || ''}`;
  if (type.startsWith('early_')) return type === 'early_cleanup' ? 'Setup' : 'Learning';
  if (type.startsWith('developing_')) return 'Explain';
  if (type === 'usage_set_budget') return 'Setup';
  if (type === 'usage_start_logging' || type === 'usage_building_history') return 'Learning';
  if (
    type === 'one_offs_driving_variance'
    || type === 'one_off_expense_skewing_projection'
    || type === 'top_category_driver'
    || type === 'projected_category_surge'
    || type === 'recurring_cost_pressure'
  ) {
    return 'Explain';
  }
  if (type === 'projected_month_end_over_budget' || type === 'budget_too_low') return 'Act';
  if (type === 'projected_month_end_under_budget' || type === 'projected_category_under_baseline' || type === 'usage_ready_to_plan') return 'Plan';
  if (insight?.entity_type === 'item') return 'Act';
  return 'Review';
}

function insightActionLabel(insight) {
  return getInsightActionDescriptor(insight).label;
}

function insightActionReason(insight) {
  if (insight?.metadata?.scope_relationship === 'personal_household_overlap') return 'Your impact';
  if (insight?.metadata?.scope === 'household') return 'Shared context';
  return getInsightActionDescriptor(insight).reason;
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

export function InsightCard({ insight, width, onPress, onDismiss }) {
  const tone = insightToneStyles(insight);
  const primaryMetric = getInsightPrimaryMetric(insight);
  const showPrimaryMetric = shouldShowPrimaryMetric(insight, primaryMetric);

  return (
    <TouchableOpacity
      style={[styles.insightCard, tone.card, { width }]}
      activeOpacity={0.92}
      accessibilityRole="button"
      onPress={() => onPress?.(insight)}
    >
      <View style={styles.insightHeader}>
        <View style={styles.insightHeaderTop}>
          <View style={styles.insightMetaRow}>
            <View style={styles.insightScopeChip}>
              <Text style={styles.insightScopeText}>{insightScopeLabel(insight)}</Text>
            </View>
            <View style={[styles.insightRoleChip, tone.roleChip]}>
              <Text style={[styles.insightRoleText, tone.roleText]}>{insightRoleLabel(insight)}</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={(event) => {
              event?.stopPropagation?.();
              onDismiss?.(insight);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Dismiss insight: ${insight.title}`}
          >
            <Ionicons name="close" size={16} color="#666" />
          </TouchableOpacity>
        </View>
        <Text style={styles.insightTitle} numberOfLines={INSIGHT_SUMMARY_TITLE_LINES}>{insight.title}</Text>
        <View style={styles.insightMetricSlot}>
          {showPrimaryMetric ? (
            <View style={styles.insightMetricRow}>
              <Text style={styles.insightMetricValue} numberOfLines={1}>{primaryMetric.value}</Text>
              <Text style={styles.insightMetricLabel} numberOfLines={1}>{primaryMetric.label}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.insightContent}>
        <Text style={styles.insightBody} numberOfLines={INSIGHT_SUMMARY_BODY_LINES}>{insight.body}</Text>
      </View>
      <View style={styles.insightFooter}>
        <Text style={styles.insightActionReason}>{insightActionReason(insight)}</Text>
        <Text style={styles.insightActionLabel}>{insightActionLabel(insight)}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  insightCard: {
    backgroundColor: '#111',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    minHeight: INSIGHT_CARD_MIN_HEIGHT,
    justifyContent: 'space-between',
  },
  insightCardWarn: { backgroundColor: '#141111', borderColor: '#2d1d1d' },
  insightCardPlan: { backgroundColor: '#101317', borderColor: '#1b2a38' },
  insightCardSetup: { backgroundColor: '#12120f', borderColor: '#2b2818' },
  insightCardLearning: { backgroundColor: '#101512', borderColor: '#1d3424' },
  insightCardExplain: { backgroundColor: '#111214', borderColor: '#20252b' },
  insightHeader: { gap: 10 },
  insightHeaderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  insightMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  insightScopeChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#1a1a1a',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#262626',
  },
  insightScopeText: { fontSize: 11, color: '#cfcfcf', fontWeight: '600', letterSpacing: 0.3 },
  insightRoleChip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
  },
  insightRoleChipWarn: { backgroundColor: '#251717', borderColor: '#4a2424' },
  insightRoleChipPlan: { backgroundColor: '#13202b', borderColor: '#28435b' },
  insightRoleChipSetup: { backgroundColor: '#252110', borderColor: '#4b4118' },
  insightRoleChipLearning: { backgroundColor: '#132219', borderColor: '#275234' },
  insightRoleChipExplain: { backgroundColor: '#171b20', borderColor: '#2d353e' },
  insightRoleText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  insightRoleTextWarn: { color: '#f2b4b4' },
  insightRoleTextPlan: { color: '#a9d2f8' },
  insightRoleTextSetup: { color: '#e6d08d' },
  insightRoleTextLearning: { color: '#a9e0b3' },
  insightRoleTextExplain: { color: '#b6c1cc' },
  insightTitle: { fontSize: 16, color: '#f5f5f5', fontWeight: '600', lineHeight: 21 },
  insightMetricSlot: {
    minHeight: 20,
    justifyContent: 'flex-end',
  },
  insightMetricRow: {
    marginTop: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    flexWrap: 'wrap',
  },
  insightMetricValue: {
    fontSize: 18,
    lineHeight: 22,
    color: '#d5dde6',
    fontWeight: '500',
  },
  insightMetricLabel: {
    fontSize: 10,
    lineHeight: 13,
    color: '#7f8994',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  insightContent: { flex: 1, justifyContent: 'flex-start', marginTop: 8 },
  insightBody: { fontSize: 13, color: '#999', lineHeight: 18 },
  insightFooter: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1f1f1f',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  insightActionReason: { fontSize: 11, color: '#7e8791', textTransform: 'uppercase', letterSpacing: 0.8, flexShrink: 1 },
  insightActionLabel: { fontSize: 12, color: '#dce8f5', fontWeight: '700', textAlign: 'right', flexShrink: 0 },
});
