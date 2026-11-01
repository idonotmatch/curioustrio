import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { currency, planChangeCopy, priceStatusCopy, strategyCopy } from '../services/purchasePlanningPresentation';
import { colors, radius, spacing } from '../theme/tokens';

function selectedPathLabel(value) {
  return {
    current_budget: 'Use this month\'s budget room',
    funding_sources: 'Use savings or another source',
    recover_over_time: 'Buy now and recover over time',
    wait: 'Wait and build funding',
  }[value] || null;
}

function formatRevisit(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function FactRow({ label, value, tone }) {
  if (!value) return null;
  return (
    <View style={styles.factRow}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={[styles.factValue, tone === 'success' && styles.factValueSuccess, tone === 'warning' && styles.factValueWarning]}>{value}</Text>
    </View>
  );
}

export function PlanPreviewPane({ plan, onOpen }) {
  if (!plan) {
    return (
      <View style={[styles.pane, styles.emptyPane]}>
        <Ionicons name="compass-outline" size={28} color={colors.textDisabled} />
        <Text style={styles.emptyTitle}>Choose a plan</Text>
        <Text style={styles.emptyBody}>Its funding path and price context will stay here while you compare ideas.</Text>
      </View>
    );
  }

  const snapshot = plan.latest_snapshot || {};
  const strategy = strategyCopy(snapshot);
  const change = planChangeCopy(snapshot);
  const total = Number(snapshot.evaluated_amount || plan.estimated_amount || 0);
  const funded = Number(snapshot.funded_amount || 0);
  const reserved = Number(snapshot.reserved_amount || 0);
  const gap = Math.max(0, Number(snapshot.funding_gap != null ? snapshot.funding_gap : total - funded));
  const selectedPath = selectedPathLabel(plan.selected_strategy);
  const revisit = formatRevisit(plan.revisit_on);
  const coveredPercent = total > 0 ? Math.min(100, Math.max(0, (funded / total) * 100)) : 0;

  return (
    <View style={styles.pane}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{plan.state === 'deferred' ? 'Paused' : plan.state || 'Considering'}</Text>
            <Text style={styles.title}>{plan.label}</Text>
          </View>
          <Text style={styles.amount}>{currency(total)}</Text>
        </View>

        {change ? (
          <View style={[styles.changeRow, snapshot.material_change === 'worsened' && styles.changeRowWarning]}>
            <Ionicons name={snapshot.material_change === 'worsened' ? 'alert-circle-outline' : 'trending-up-outline'} size={17} color={snapshot.material_change === 'worsened' ? colors.warning : colors.success} />
            <Text style={styles.changeText}>{change}</Text>
          </View>
        ) : null}

        <View style={styles.strategyBlock}>
          <Text style={styles.sectionTitle}>Current path</Text>
          <Text style={styles.strategyTitle}>{selectedPath || strategy.title}</Text>
          <Text style={styles.strategyBody}>{strategy.body}</Text>
        </View>

        <View style={styles.coverageBlock}>
          <View style={styles.coverageHeading}>
            <Text style={styles.sectionTitle}>Funding view</Text>
            <Text style={styles.coverageValue}>{Math.round(coveredPercent)}% covered</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${coveredPercent}%` }]} />
          </View>
          <View style={styles.facts}>
            <FactRow label="Could cover" value={currency(funded)} tone="success" />
            <FactRow label="Earmarked" value={currency(reserved)} />
            <FactRow label="Still unfunded" value={gap > 0 ? currency(gap) : 'Fully covered'} tone={gap > 0 ? 'warning' : 'success'} />
          </View>
        </View>

        {plan.offer_watch ? (
          <View style={styles.contextBlock}>
            <Text style={styles.sectionTitle}>Price watch</Text>
            <Text style={styles.contextText}>{priceStatusCopy(plan.offer_watch, snapshot)}</Text>
          </View>
        ) : null}

        {revisit ? (
          <View style={styles.contextBlock}>
            <Text style={styles.sectionTitle}>Next check-in</Text>
            <Text style={styles.contextText}>{revisit}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => onOpen(plan)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${plan.label} plan`}
        >
          <Text style={styles.primaryButtonText}>Work through this plan</Text>
          <Ionicons name="arrow-forward" size={17} color={colors.textInverse} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { width: 390, minWidth: 0, alignSelf: 'stretch', borderLeftWidth: 1, borderLeftColor: colors.borderSubtle, backgroundColor: colors.surface },
  emptyPane: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 44, gap: spacing.sm },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: spacing.sm },
  emptyBody: { color: colors.textSubtle, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  content: { padding: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.xl },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  eyebrow: { color: colors.info, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 22, lineHeight: 28, fontWeight: '700' },
  amount: { color: colors.text, fontSize: 20, lineHeight: 26, fontWeight: '700' },
  changeRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: colors.successMuted, borderWidth: 1, borderColor: colors.successBorder },
  changeRowWarning: { backgroundColor: colors.warningMuted, borderColor: colors.warningBorder },
  changeText: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '700' },
  strategyBlock: { gap: spacing.sm },
  sectionTitle: { color: colors.textSubtle, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  strategyTitle: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  strategyBody: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  coverageBlock: { gap: spacing.md },
  coverageHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  coverageValue: { color: colors.text, fontSize: 12, fontWeight: '700' },
  progressTrack: { height: 7, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.surfacePressed },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: colors.success },
  facts: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  factRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  factLabel: { color: colors.textSubtle, fontSize: 12 },
  factValue: { color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  factValueSuccess: { color: colors.success },
  factValueWarning: { color: colors.warning },
  contextBlock: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  contextText: { color: colors.text, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  actions: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surfaceRaised },
  primaryButton: { minHeight: 44, borderRadius: radius.sm, backgroundColor: colors.text, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  primaryButtonText: { color: colors.textInverse, fontSize: 13, fontWeight: '800' },
});
