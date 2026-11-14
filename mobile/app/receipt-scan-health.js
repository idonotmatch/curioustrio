import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MetricStrip } from '../components/ui/MetricStrip';
import { EmptyState, InlineError, LoadingState, SectionHeader } from '../components/ui/States';
import { useAdaptiveLayout } from '../contexts/AdaptiveLayoutContext';
import { api } from '../services/api';
import { INTERNAL_TOOLS_ENABLED } from '../services/internalTools';
import { colors, spacing, typography } from '../theme/tokens';

const WINDOW_DAYS = 30;

function seconds(milliseconds) {
  const value = Number(milliseconds || 0);
  return value > 0 ? `${Math.round(value / 1000)}s` : '-';
}

function percent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function iconFor(level) {
  if (level === 'error') return 'alert-circle';
  if (level === 'warning') return 'warning';
  return 'checkmark-circle';
}

function colorFor(level) {
  if (level === 'error') return colors.danger;
  if (level === 'warning') return colors.warning;
  return colors.success;
}

export default function ReceiptScanHealthScreen() {
  const layout = useAdaptiveLayout();
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const top = useMemo(() => health?.recommendations?.[0], [health]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      setHealth(await api.get(`/expenses/scan-health?days=${WINDOW_DAYS}`, { dedupe: false }));
    } catch (requestError) {
      setError(requestError?.message || 'Could not load receipt scan health.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!INTERNAL_TOOLS_ENABLED) {
    return (
      <>
        <Stack.Screen options={{ title: 'Receipt Scan Health' }} />
        <SafeAreaView style={styles.container} edges={['left', 'right']}>
          <EmptyState title="Internal tools are disabled" body="Receipt diagnostics are hidden in this build." icon="lock-closed-outline" />
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Receipt Scan Health' }} />
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { maxWidth: Math.min(layout.maxWidths.feed, layout.availableWidth) }]}
          refreshControl={<RefreshControl tintColor={colors.text} refreshing={refreshing} onRefresh={() => { setRefreshing(true); load({ silent: true }); }} />}
        >
          {top ? (
            <View style={styles.hero}>
              <Ionicons name={iconFor(top.level)} size={20} color={colorFor(top.level)} />
              <View style={styles.heroCopy}>
                <Text style={styles.heroTitle}>{top.message}</Text>
                <Text style={styles.heroBody}>Durable queue and parser signals from the last {health.window_days} days</Text>
              </View>
            </View>
          ) : null}

          {loading ? <LoadingState label="Checking receipt scan health" /> : null}
          {error ? <InlineError title="Could not load receipt scan health" body={error} onAction={() => load()} /> : null}

          {health ? (
            <>
              <View style={styles.section}>
                <SectionHeader title="Job reliability" body="Includes failures before AI parsing begins" />
                <MetricStrip items={[
                  { label: 'Submitted', value: health.jobs?.jobs },
                  { label: 'Success', value: percent(health.jobs?.success_rate) },
                  { label: 'Failed', value: health.jobs?.failed },
                  { label: 'Stalled', value: Number(health.jobs?.stale_queued || 0) + Number(health.jobs?.stale_processing || 0) },
                ]} />
              </View>

              <View style={styles.section}>
                <SectionHeader title="Latency and retries" />
                <MetricStrip items={[
                  { label: 'Avg total', value: seconds(health.jobs?.avg_end_to_end_ms) },
                  { label: 'Slowest 5%', value: seconds(health.jobs?.p95_end_to_end_ms) },
                  { label: 'Queue p95', value: seconds(health.jobs?.p95_queue_ms) },
                  { label: 'Retried', value: percent(health.jobs?.retry_rate) },
                ]} />
              </View>

              <View style={styles.section}>
                <SectionHeader title="Parse quality" body="Scans that reached extraction" />
                <MetricStrip items={[
                  { label: 'Attempts', value: health.parsing?.counts?.attempts },
                  { label: 'Parsed', value: health.parsing?.counts?.parsed },
                  { label: 'Needs review', value: health.parsing?.counts?.partial },
                  { label: 'Failed', value: health.parsing?.counts?.failed },
                ]} />
              </View>

              <View style={styles.section}>
                <SectionHeader title="Findings" />
                {(health.recommendations || []).map((item) => (
                  <View key={item.code} style={styles.finding}>
                    <Ionicons name={iconFor(item.level)} size={17} color={colorFor(item.level)} />
                    <Text style={styles.findingText}>{item.message}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { width: '100%', alignSelf: 'center', padding: spacing.xl, paddingBottom: 48 },
  hero: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface },
  heroCopy: { flex: 1, gap: spacing.xs },
  heroTitle: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  heroBody: { color: colors.textMuted, ...typography.bodySmall },
  section: { marginTop: spacing.xl, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.surfaceRaised },
  finding: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.surfaceRaised },
  findingText: { flex: 1, color: colors.textMuted, ...typography.body },
});
