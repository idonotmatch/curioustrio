import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../services/api';
import { currency, planChangeCopy, priceStatusCopy, strategyCopy } from '../services/purchasePlanningPresentation';
import { PrimaryButton, SecondaryButton } from '../components/ui/Buttons';
import { colors, radius, spacing, typography } from '../theme/tokens';

function relativeUpdate(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 2) return 'Updated now';
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${Math.round(hours / 24)}d ago`;
}

function localDateKey() {
  const now = new Date();
  const pad = (value) => `${value}`.padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function revisitLabel(value) {
  if (!value) return '';
  const date = new Date(`${value}`.slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(date.getTime())) return '';
  return `Revisit ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function selectedPathLabel(value) {
  return {
    current_budget: 'Current budget',
    funding_sources: 'Savings or another source',
    recover_over_time: 'Buy now and recover',
    wait: 'Wait and build funding',
  }[value] || '';
}

function buildSections(items) {
  const claimed = new Set();
  const take = (predicate) => items.filter((item) => {
    if (claimed.has(item.id) || !predicate(item)) return false;
    claimed.add(item.id);
    return true;
  });
  return [
    { key: 'attention', title: 'Needs attention', body: 'A revisit date arrived, or the price or funding picture moved.', items: take((item) => (
      (item.revisit_on && `${item.revisit_on}`.slice(0, 10) <= localDateKey())
      || ['improved', 'worsened'].includes(item.latest_snapshot?.material_change)
    )) },
    { key: 'ready', title: 'Ready', body: 'Plans you have decided are ready to act on.', items: take((item) => item.state === 'ready') },
    { key: 'considering', title: 'Considering', body: 'Ideas you are still thinking through.', items: take((item) => item.state === 'considering') },
    { key: 'paused', title: 'Paused', body: 'Plans waiting for a better moment.', items: take((item) => item.state === 'deferred') },
  ].filter((section) => section.items.length > 0);
}

function PlanRow({ plan, onPress }) {
  const snapshot = plan.latest_snapshot || {};
  const strategy = strategyCopy(snapshot);
  const change = planChangeCopy(snapshot);
  const possible = Number(snapshot.funded_amount || 0);
  const earmarked = Number(snapshot.reserved_amount || 0);
  const total = Number(snapshot.evaluated_amount || plan.estimated_amount || 0);
  const possiblePercent = total > 0 ? Math.min(100, (possible / total) * 100) : 0;
  const earmarkedPercent = total > 0 ? Math.min(100, (earmarked / total) * 100) : 0;
  const selectedPath = selectedPathLabel(plan.selected_strategy);
  const revisitDue = plan.revisit_on && `${plan.revisit_on}`.slice(0, 10) <= localDateKey();

  return (
    <TouchableOpacity style={styles.planRow} activeOpacity={0.84} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowTop}>
        <View style={styles.rowCopy}>
          <View style={styles.badgeRow}>
            <Text style={styles.badge}>{plan.state === 'deferred' ? 'Paused' : plan.state}</Text>
            {revisitDue ? <Text style={styles.due}>Revisit due</Text> : null}
            {change ? <Text style={[styles.change, snapshot.material_change === 'worsened' && styles.changeWarning]}>{change}</Text> : null}
          </View>
          <Text style={styles.planTitle}>{plan.label}</Text>
          <Text style={styles.strategy}>{selectedPath ? `Chosen path: ${selectedPath}` : strategy.title}</Text>
        </View>
        <View style={styles.amountColumn}>
          <Text style={styles.amount}>{currency(total)}</Text>
          <Ionicons name="chevron-forward" size={17} color={colors.textSubtle} />
        </View>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.possibleFill, { width: `${possiblePercent}%` }]} />
        <View style={[styles.earmarkedFill, { width: `${earmarkedPercent}%` }]} />
      </View>
      <View style={styles.rowMeta}>
        <Text style={styles.metaText}>{currency(possible)} could cover</Text>
        <Text style={styles.metaStrong}>{currency(earmarked)} earmarked</Text>
      </View>
      <View style={styles.contextRow}>
        {plan.offer_watch ? <Text style={styles.priceText}>{priceStatusCopy(plan.offer_watch, snapshot)}</Text> : <Text style={styles.priceText}>{revisitLabel(plan.revisit_on)}</Text>}
        <Text style={styles.updateText}>{relativeUpdate(plan.last_evaluated_at || snapshot.created_at)}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function PlansScreen() {
  const router = useRouter();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ refresh = false } = {}) => {
    try {
      refresh ? setRefreshing(true) : setLoading(true);
      setError('');
      const data = await api.get(refresh ? '/plans?refresh=1' : '/plans', { dedupe: false });
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setError(err?.message || 'Could not load planning right now.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const sections = buildSections(items);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refresh: true })} tintColor={colors.text} />}
      >
        <View style={styles.hero}>
          <View style={styles.heroCopy}>
            <Text style={styles.title}>Planning</Text>
            <Text style={styles.subtitle}>Purchases you are considering, what they would displace, and the paths available to pay for them.</Text>
          </View>
          <TouchableOpacity style={styles.sourcesButton} onPress={() => router.push('/funding-pools')} accessibilityRole="button">
            <Ionicons name="wallet-outline" size={18} color={colors.text} />
            <Text style={styles.sourcesText}>Sources</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.skeletonList}>
            {[0, 1, 2].map((key) => <View key={key} style={styles.skeletonRow} />)}
          </View>
        ) : error ? (
          <View style={styles.state}>
            <Text style={styles.stateTitle}>Planning is unavailable</Text>
            <Text style={styles.stateBody}>{error}</Text>
            <SecondaryButton title="Try again" icon="refresh-outline" onPress={() => load()} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.state}>
            <Ionicons name="compass-outline" size={25} color={colors.textMuted} />
            <Text style={styles.stateTitle}>Nothing under consideration</Text>
            <Text style={styles.stateBody}>Start with a name and rough price. You can work through the tradeoffs without deciding today.</Text>
            <PrimaryButton title="Consider a purchase" icon="add" onPress={() => router.push('/plan/new')} />
          </View>
        ) : (
          <>
            {sections.map((section) => (
              <View key={section.key} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionCopy}>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                    <Text style={styles.sectionBody}>{section.body}</Text>
                  </View>
                  <Text style={styles.sectionMeta}>{section.items.length}</Text>
                </View>
                <View style={styles.list}>
                  {section.items.map((plan) => <PlanRow key={plan.id} plan={plan} onPress={() => router.push(`/plan/${plan.id}`)} />)}
                </View>
              </View>
            ))}
            <PrimaryButton title="Consider another purchase" icon="add" onPress={() => router.push('/plan/new')} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: 52, gap: spacing.xxl },
  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg },
  heroCopy: { flex: 1, gap: spacing.sm },
  title: { ...typography.screenTitle, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted },
  sourcesButton: { minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: spacing.md },
  sourcesText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  state: { minHeight: 280, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  stateTitle: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  stateBody: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.sm },
  skeletonList: { gap: 1, backgroundColor: colors.border },
  skeletonRow: { height: 126, backgroundColor: colors.surfaceRaised },
  section: { gap: spacing.md },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  sectionCopy: { flex: 1, gap: 3 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  sectionBody: { color: colors.textSubtle, fontSize: 12 },
  sectionMeta: { color: colors.textSubtle, fontSize: 13 },
  list: { borderTopWidth: 1, borderTopColor: colors.border },
  planRow: { paddingVertical: spacing.lg, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  rowCopy: { flex: 1, gap: 5 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: { color: colors.info, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  change: { color: colors.success, fontSize: 12, fontWeight: '650' },
  due: { color: colors.warning, fontSize: 12, fontWeight: '700' },
  changeWarning: { color: colors.warning },
  planTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  strategy: { color: colors.textMuted, fontSize: 13 },
  amountColumn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  amount: { color: colors.text, fontSize: 16, fontWeight: '700' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfacePressed, overflow: 'hidden' },
  possibleFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.infoMuted },
  earmarkedFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.success },
  rowMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  metaText: { color: colors.textSubtle, fontSize: 12 },
  metaStrong: { color: colors.textMuted, fontSize: 12, fontWeight: '650' },
  contextRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  priceText: { flex: 1, color: colors.info, fontSize: 12 },
  updateText: { color: colors.textSubtle, fontSize: 11 },
});
