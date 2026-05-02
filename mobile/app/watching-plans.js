import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../services/api';
import { toLocalDateString } from '../services/date';
import { pushConfirmDraft } from '../services/confirmNavigation';

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `$${Math.abs(amount).toFixed(0)}`;
}

function scopeLabel(scope) {
  return scope === 'household' ? 'Household' : 'You';
}

function scopeContextLabel(scope) {
  return scope === 'household' ? 'Shared room' : 'Personal room';
}

function statusLabel(status) {
  switch (status) {
    case 'comfortable': return 'Comfortable';
    case 'absorbable': return 'Absorbable';
    case 'tight': return 'Tight';
    case 'risky': return 'Risky';
    case 'not_absorbable': return 'Not absorbable';
    default: return 'Unknown';
  }
}

function monthLabel(month) {
  const [yearRaw, monthRaw] = `${month || ''}`.split('-');
  const year = Number(yearRaw);
  const monthNumber = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return 'next month';
  }
  return new Date(year, monthNumber - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

function changeCopy(plan) {
  if (plan?.last_material_change === 'improved') return 'Looks easier now';
  if (plan?.last_material_change === 'worsened') return 'Tighter than before';
  return '';
}

function whyChangedCopy(plan) {
  const previous = Number(plan?.previous_risk_adjusted_headroom_amount);
  const current = Number(plan?.last_risk_adjusted_headroom_amount);
  const hasBoth = Number.isFinite(previous) && Number.isFinite(current);
  const delta = hasBoth ? current - previous : 0;

  if (plan?.last_material_change === 'improved') {
    if (hasBoth && delta >= 25) return `${formatCurrency(delta)} more room opened up.`;
    return 'Your projected room improved since the last check.';
  }
  if (plan?.last_material_change === 'worsened') {
    if (hasBoth && delta <= -25) return `${formatCurrency(Math.abs(delta))} less room is left now.`;
    return 'Your projected room tightened since the last check.';
  }
  return '';
}

function timingPreferenceCopy(plan) {
  return `${plan?.timing_preference_note || ''}`.trim();
}

function sortPlans(items) {
  const priority = {
    worsened: 0,
    improved: 1,
    unchanged: 2,
  };
  return [...items].sort((a, b) => {
    const aPriority = priority[a?.last_material_change] ?? 3;
    const bPriority = priority[b?.last_material_change] ?? 3;
    if (aPriority !== bPriority) return aPriority - bPriority;
    const aTime = new Date(a?.last_evaluated_at || a?.created_at || 0).getTime();
    const bTime = new Date(b?.last_evaluated_at || b?.created_at || 0).getTime();
    return bTime - aTime;
  });
}

function buildSections(items) {
  const sorted = sortPlans(items);
  const groups = [
    { key: 'worsened', title: 'Got tighter', items: sorted.filter((plan) => plan.last_material_change === 'worsened') },
    { key: 'improved', title: 'Got easier', items: sorted.filter((plan) => plan.last_material_change === 'improved') },
    { key: 'stable', title: 'Stable', items: sorted.filter((plan) => !['worsened', 'improved'].includes(plan.last_material_change)) },
  ];
  return groups.filter((group) => group.items.length > 0);
}

function buildScopeGroups(items) {
  const household = items.filter((plan) => plan.scope === 'household');
  const personal = items.filter((plan) => plan.scope !== 'household');
  return [
    {
      key: 'household',
      title: 'Shared household plans',
      subtitle: 'Things you are keeping an eye on for shared room and timing.',
      items: household,
    },
    {
      key: 'personal',
      title: 'Personal plans',
      subtitle: 'Things you are keeping an eye on just for your own spending room.',
      items: personal,
    },
  ].filter((group) => group.items.length > 0);
}

export default function WatchingPlansScreen() {
  const router = useRouter();
  const { resolved, label } = useLocalSearchParams();
  const [items, setItems] = useState([]);
  const [deferredItems, setDeferredItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get('/trends/scenario-memory/watching?limit=20');
      setItems(Array.isArray(data?.items) ? data.items : []);
      setDeferredItems(Array.isArray(data?.deferred_items) ? data.deferred_items : []);
    } catch {
      setItems([]);
      setDeferredItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const scopeGroups = buildScopeGroups(items);

  async function handleResolve(plan, action) {
    try {
      await api.post(`/trends/scenario-memory/${plan.id}/resolve`, { action });
      load();
    } catch {
      // non-fatal
    }
  }

  async function handleDefer(plan) {
    try {
      await api.post(`/trends/scenario-memory/${plan.id}/defer`, {});
      load();
    } catch {
      // non-fatal
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.title}>Watching</Text>
          <Text style={styles.subtitle}>
            Plans you explicitly asked Adlo to keep an eye on.
          </Text>
        </View>

        {resolved === 'bought' ? (
          <View style={styles.successBanner}>
            <Text style={styles.successTitle}>Marked as bought</Text>
            <Text style={styles.successBody}>
              {label ? `${label} was moved out of your watched plans.` : 'That plan was moved out of your watched plans.'}
            </Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color="#f5f5f5" />
          </View>
        ) : items.length === 0 ? (
          <>
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No watched plans yet</Text>
              <Text style={styles.emptyBody}>
                Watch a plan from a scenario result to keep an eye on it here.
              </Text>
            </View>
            {deferredItems.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Coming back next month</Text>
                {deferredItems.map((plan) => (
                  <View key={plan.id} style={styles.deferredCard}>
                      <View style={styles.rowTop}>
                        <View style={styles.textCol}>
                          <Text style={styles.label}>{plan.label}</Text>
                          <Text style={styles.meta}>{scopeLabel(plan.scope)} · Returns in {monthLabel(plan.deferred_until_month)}</Text>
                          {timingPreferenceCopy(plan) ? (
                            <Text style={styles.preferenceNote}>{timingPreferenceCopy(plan)}</Text>
                          ) : null}
                      </View>
                      <View style={styles.rightCol}>
                        <Text style={styles.status}>{statusLabel(plan.last_affordability_status)}</Text>
                        <Text style={styles.amount}>{formatCurrency(plan.amount)}</Text>
                      </View>
                    </View>
                    <View style={styles.actionsRow}>
                      <TouchableOpacity
                        style={styles.secondaryAction}
                        onPress={async () => {
                          try {
                            await api.post(`/trends/scenario-memory/${plan.id}/watch`, { enabled: true });
                            load();
                          } catch {
                            // non-fatal
                          }
                        }}
                      >
                        <Text style={styles.secondaryActionText}>Watch again now</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <>
            {scopeGroups.map((scopeGroup) => (
              <View key={scopeGroup.key} style={styles.scopeSection}>
                <View style={styles.scopeHeader}>
                  <Text style={styles.scopeTitle}>{scopeGroup.title}</Text>
                  <Text style={styles.scopeSubtitle}>{scopeGroup.subtitle}</Text>
                </View>
                {buildSections(scopeGroup.items).map((section) => (
                  <View key={`${scopeGroup.key}-${section.key}`} style={styles.section}>
                    <Text style={styles.sectionLabel}>{section.title}</Text>
                    {section.items.map((plan) => {
                      const change = changeCopy(plan);
                      const why = whyChangedCopy(plan);
                      return (
                        <View key={plan.id} style={styles.card}>
                          <TouchableOpacity
                            activeOpacity={0.85}
                            onPress={() => router.push({
                              pathname: '/scenario-check',
                              params: {
                                month: plan.month,
                                scope: plan.scope,
                                amount: `${plan.amount}`,
                                label: plan.label,
                                auto_run: '1',
                                timing_mode: plan.timing_mode || 'now',
                              },
                            })}
                          >
                            <View style={styles.rowTop}>
                              <View style={styles.textCol}>
                                <Text style={styles.label}>{plan.label}</Text>
                                <Text style={styles.meta}>{scopeLabel(plan.scope)} · {scopeContextLabel(plan.scope)} · Watching</Text>
                                {change ? <Text style={styles.change}>{change}</Text> : null}
                                {why ? <Text style={styles.why}>{why}</Text> : null}
                                {timingPreferenceCopy(plan) ? (
                                  <Text style={styles.preferenceNote}>{timingPreferenceCopy(plan)}</Text>
                                ) : null}
                              </View>
                              <View style={styles.rightCol}>
                                <Text style={styles.status}>{statusLabel(plan.last_affordability_status)}</Text>
                                <Text style={styles.amount}>{formatCurrency(plan.amount)}</Text>
                              </View>
                            </View>
                          </TouchableOpacity>
                          <View style={styles.actionsRow}>
                            <TouchableOpacity
                              style={styles.primaryAction}
                              onPress={() => {
                                pushConfirmDraft(router, {
                                  merchant: plan.label,
                                  description: plan.label,
                                  amount: Number(plan.amount),
                                  date: toLocalDateString(),
                                  source: 'manual',
                                  scenario_memory_id: plan.id,
                                });
                              }}
                            >
                              <Text style={styles.primaryActionText}>Bought it</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.secondaryAction}
                              onPress={() => handleDefer(plan)}
                            >
                              <Text style={styles.secondaryActionText}>Revisit next month</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.tertiaryAction}
                              onPress={() => handleResolve(plan, 'not_buying')}
                            >
                              <Text style={styles.tertiaryActionText}>Not buying it</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.quaternaryAction}
                              onPress={async () => {
                                try {
                                  await api.post(`/trends/scenario-memory/${plan.id}/watch`, { enabled: false });
                                  load();
                                } catch {
                                  // non-fatal
                                }
                              }}
                            >
                              <Text style={styles.quaternaryActionText}>Stop watching</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            ))}
            {deferredItems.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Coming back next month</Text>
                {deferredItems.map((plan) => (
                  <View key={plan.id} style={styles.deferredCard}>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => router.push({
                        pathname: '/scenario-check',
                          params: {
                            month: plan.month,
                            scope: plan.scope,
                            amount: `${plan.amount}`,
                            label: plan.label,
                            timing_mode: plan.timing_mode || 'now',
                          },
                        })}
                    >
                      <View style={styles.rowTop}>
                        <View style={styles.textCol}>
                          <Text style={styles.label}>{plan.label}</Text>
                          <Text style={styles.meta}>{scopeLabel(plan.scope)} · {scopeContextLabel(plan.scope)} · Returns in {monthLabel(plan.deferred_until_month)}</Text>
                          {timingPreferenceCopy(plan) ? (
                            <Text style={styles.preferenceNote}>{timingPreferenceCopy(plan)}</Text>
                          ) : null}
                        </View>
                        <View style={styles.rightCol}>
                          <Text style={styles.status}>{statusLabel(plan.last_affordability_status)}</Text>
                          <Text style={styles.amount}>{formatCurrency(plan.amount)}</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                    <View style={styles.actionsRow}>
                      <TouchableOpacity
                        style={styles.secondaryAction}
                        onPress={async () => {
                          try {
                            await api.post(`/trends/scenario-memory/${plan.id}/watch`, { enabled: true });
                            load();
                          } catch {
                            // non-fatal
                          }
                        }}
                      >
                        <Text style={styles.secondaryActionText}>Watch again now</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0a0a0a' },
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 48, gap: 16 },
  hero: { gap: 6 },
  title: { fontSize: 30, color: '#f5f5f5', fontWeight: '600', letterSpacing: -0.8 },
  subtitle: { fontSize: 15, color: '#99a2ad', lineHeight: 22 },
  successBanner: {
    backgroundColor: '#0f1913',
    borderWidth: 1,
    borderColor: '#284032',
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  successTitle: { color: '#f2f8f3', fontSize: 15, fontWeight: '600' },
  successBody: { color: '#a7beac', fontSize: 13, lineHeight: 18 },
  loadingState: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  emptyCard: {
    backgroundColor: '#101216',
    borderWidth: 1,
    borderColor: '#1d2730',
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  emptyTitle: { color: '#e3ebf3', fontSize: 17, fontWeight: '600' },
  emptyBody: { color: '#8fa0b2', fontSize: 14, lineHeight: 20 },
  preferenceNote: { color: '#9cc3de', fontSize: 12, lineHeight: 17, marginTop: 3 },
  scopeSection: { gap: 12 },
  scopeHeader: { gap: 4 },
  scopeTitle: { color: '#f0f4f8', fontSize: 20, fontWeight: '600', letterSpacing: -0.4 },
  scopeSubtitle: { color: '#8fa0b2', fontSize: 13, lineHeight: 18 },
  section: { gap: 10 },
  sectionLabel: {
    color: '#8e8e8e',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  card: {
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#212121',
    borderRadius: 16,
    padding: 16,
    gap: 14,
  },
  deferredCard: {
    backgroundColor: '#101113',
    borderWidth: 1,
    borderColor: '#1f2328',
    borderRadius: 16,
    padding: 16,
    gap: 14,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  textCol: { flex: 1 },
  rightCol: { alignItems: 'flex-end', gap: 5 },
  label: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  meta: { color: '#8e8e8e', fontSize: 12, marginTop: 4 },
  change: { color: '#b8c8ff', fontSize: 13, fontWeight: '700', marginTop: 10 },
  why: { color: '#8f99ac', fontSize: 13, lineHeight: 18, marginTop: 3 },
  status: { color: '#9ca3af', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  amount: { color: '#f5f5f5', fontSize: 22, fontWeight: '600', letterSpacing: -0.4 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primaryAction: {
    borderRadius: 999,
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryActionText: { color: '#000', fontSize: 13, fontWeight: '700' },
  secondaryAction: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#39424c',
    backgroundColor: '#1a1f24',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryActionText: { color: '#e6edf5', fontSize: 13, fontWeight: '600' },
  tertiaryAction: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#4a2f38',
    backgroundColor: '#21161b',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  tertiaryActionText: { color: '#efdbe4', fontSize: 13, fontWeight: '600' },
  quaternaryAction: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2d3b4a',
    backgroundColor: '#17202a',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  quaternaryActionText: { color: '#dce8f5', fontSize: 13, fontWeight: '600' },
});
