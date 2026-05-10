import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { invalidateExpenseMutationCaches } from '../services/expenseMutationEffects';
import { INTERNAL_TOOLS_ENABLED } from '../services/internalTools';
import { MetricStrip } from '../components/ui/MetricStrip';
import { EmptyState, InlineError, LoadingState, SectionHeader } from '../components/ui/States';
import { StatusChip } from '../components/ui/StatusChip';
import { colors, radius, spacing, typography } from '../theme/tokens';

const WINDOW_DAYS = 14;
const PROBE_LIMIT = 25;

function formatDateTime(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusTone(level) {
  switch (level) {
    case 'error': return styles.statusError;
    case 'warning': return styles.statusWarning;
    default: return styles.statusOk;
  }
}

function statusIcon(level) {
  switch (level) {
    case 'error': return 'alert-circle';
    case 'warning': return 'warning';
    default: return 'checkmark-circle';
  }
}

function metricValue(value) {
  return Number(value || 0).toLocaleString();
}

function MessageRow({ item }) {
  const status = item.import_status || 'failed';
  return (
    <View style={styles.messageRow}>
      <View style={styles.messageMain}>
        <Text style={styles.messageSubject} numberOfLines={2}>{item.subject || item.message_id || 'Message'}</Text>
        <Text style={styles.messageMeta} numberOfLines={1}>
          {item.sender || 'Unknown sender'} · {item.received_at || formatDateTime(item.imported_at)}
        </Text>
        {item.snippet ? <Text style={styles.messageSnippet} numberOfLines={2}>{item.snippet}</Text> : null}
        {item.skip_reason || item.reason ? (
          <Text style={styles.messageReason} numberOfLines={2}>{item.skip_reason || item.reason}</Text>
        ) : null}
      </View>
      <StatusChip label={status} tone={status === 'unlogged' ? 'warning' : status === 'failed' ? 'danger' : 'neutral'} />
    </View>
  );
}

function ProbeSection({ title, probe }) {
  const candidates = Array.isArray(probe?.candidates) ? probe.candidates : [];
  return (
    <View style={styles.section}>
      <SectionHeader
        title={title}
        body={probe?.query || ''}
      />
      {probe?.error ? <InlineError title="Probe failed" body={probe.error} /> : null}
      <MetricStrip
        items={[
          { label: 'Checked', value: probe?.checked_count },
          { label: 'Logged', value: probe?.logged_count },
          { label: 'Unlogged', value: probe?.unlogged_count },
          { label: 'Failed', value: probe?.status_counts?.failed },
        ]}
      />
      {candidates.length > 0 ? (
        <View style={styles.messageList}>
          {candidates.map((item) => (
            <MessageRow key={`${item.message_id}-${item.import_status}`} item={item} />
          ))}
        </View>
      ) : (
        <EmptyState
          compact
          icon="checkmark-circle-outline"
          title="No candidates surfaced"
          body="This probe did not find unlogged or failed messages."
        />
      )}
    </View>
  );
}

export default function EmailImportHealthScreen() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  const topRecommendation = useMemo(() => {
    const items = Array.isArray(health?.recommendations) ? health.recommendations : [];
    return items[0] || { level: 'warning', message: 'Health check has not run yet.' };
  }, [health]);

  const loadHealth = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/gmail/import-health?days=${WINDOW_DAYS}&limit=${PROBE_LIMIT}`);
      setHealth(data);
    } catch (e) {
      setError(e?.message || 'Could not load Gmail import health.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  async function refresh() {
    setRefreshing(true);
    await loadHealth({ silent: true });
  }

  async function runSync() {
    setSyncing(true);
    try {
      const result = await api.post('/gmail/import', {});
      await invalidateExpenseMutationCaches();
      await loadHealth({ silent: true });
      Alert.alert(
        'Gmail sync complete',
        `Imported ${result.imported || 0}, skipped ${result.skipped || 0}${result.failed ? `, failed ${result.failed}` : ''}.`
      );
    } catch (e) {
      Alert.alert('Gmail sync failed', e?.message || 'Could not run Gmail sync.');
    } finally {
      setSyncing(false);
    }
  }

  if (!INTERNAL_TOOLS_ENABLED) {
    return (
      <>
        <Stack.Screen options={{ title: 'Email Import Health' }} />
        <View style={styles.container}>
          <EmptyState title="Internal tools are disabled" body="Email import health is hidden in this build." icon="lock-closed-outline" />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Email Import Health' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl tintColor={colors.text} refreshing={refreshing} onRefresh={refresh} />}
      >
        <View style={[styles.hero, statusTone(topRecommendation.level)]}>
          <View style={styles.heroIcon}>
            <Ionicons name={statusIcon(topRecommendation.level)} size={18} color={colors.text} />
          </View>
          <View style={styles.heroText}>
            <Text style={styles.heroTitle}>{topRecommendation.message}</Text>
            <Text style={styles.heroSub}>
              Last sync {formatDateTime(health?.sync?.last_synced_at)} · {health?.sync?.last_sync_status || 'unknown'}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={[styles.actionBtn, syncing && styles.actionBtnDisabled]} onPress={runSync} disabled={syncing}>
            {syncing ? <ActivityIndicator color={colors.background} /> : <Text style={styles.primaryActionText}>Run sync</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={refresh}>
            <Ionicons name="refresh" size={15} color={colors.text} />
            <Text style={styles.secondaryActionText}>Refresh</Text>
          </TouchableOpacity>
        </View>

        {loading ? <LoadingState label="Checking Gmail import health" /> : null}
        {error ? <InlineError title="Could not load Gmail import health" body={error} onAction={refresh} /> : null}

        {health ? (
          <>
            <View style={styles.section}>
              <SectionHeader title="Recent log health" body={`Last ${health.window_days || WINDOW_DAYS} days`} />
              <MetricStrip
                items={[
                  { label: 'Logs', value: health.recent_logs?.checked_count },
                  { label: 'Imported', value: health.recent_logs?.counts?.imported },
                  { label: 'Skipped', value: health.recent_logs?.counts?.skipped },
                  { label: 'Failed', value: health.recent_logs?.counts?.failed },
                ]}
              />
            </View>

            <ProbeSection title="Inbox coverage" probe={health.probes?.inbox} />
            <ProbeSection title="Importer search coverage" probe={health.probes?.import_query} />

            <View style={styles.section}>
              <SectionHeader title="Recommendations" />
              {(health.recommendations || []).map((item) => (
                <View key={item.code} style={styles.recommendationRow}>
                  <Ionicons name={statusIcon(item.level)} size={16} color={item.level === 'error' ? colors.danger : item.level === 'warning' ? colors.warning : colors.success} />
                  <Text style={styles.recommendationText}>{item.message}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 48 },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
  },
  statusOk: { backgroundColor: colors.successMuted, borderColor: colors.successBorder },
  statusWarning: { backgroundColor: colors.warningMuted, borderColor: colors.warningBorder },
  statusError: { backgroundColor: colors.dangerMuted, borderColor: colors.dangerBorder },
  heroIcon: { marginTop: 1 },
  heroText: { flex: 1 },
  heroTitle: { color: colors.text, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  heroSub: { color: colors.textMuted, fontSize: 12, marginTop: 5 },
  actions: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  actionBtn: { minHeight: 44, flex: 1, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  actionBtnDisabled: { opacity: 0.6 },
  primaryActionText: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },
  secondaryBtn: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryActionText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  loader: { marginTop: 18 },
  section: { marginTop: 20, paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.surfaceRaised },
  sectionHeader: { gap: 4 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  queryText: { color: colors.textDisabled, fontSize: 11 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  metricCard: { width: '48%', minHeight: 76, borderRadius: 8, borderWidth: 1, borderColor: colors.textInverse, backgroundColor: colors.surface, padding: 12 },
  metricWarning: { borderColor: colors.warningBorder },
  metricError: { borderColor: colors.dangerBorder },
  metricLabel: { color: colors.textSubtle, fontSize: 11, fontWeight: '700' },
  metricValue: { color: colors.text, fontSize: 25, fontWeight: '700', marginTop: 10 },
  messageList: { marginTop: 12, gap: 10 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.surface, padding: 12 },
  messageMain: { flex: 1 },
  messageSubject: { color: colors.text, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  messageMeta: { color: colors.textDisabled, fontSize: 11, marginTop: 4 },
  messageSnippet: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  messageReason: { color: colors.warning, fontSize: 11, lineHeight: 16, marginTop: 8 },
  messagePill: { borderRadius: 999, backgroundColor: colors.borderSubtle, paddingHorizontal: 8, paddingVertical: 4 },
  messagePillText: { color: colors.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  recommendationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.surfaceRaised },
  recommendationText: { color: colors.textMuted, fontSize: 13, lineHeight: 18, flex: 1 },
  emptyText: { color: colors.textDisabled, fontSize: 12, marginTop: 12 },
  emptyTitle: { color: colors.text, fontSize: 16, padding: 20 },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18, marginTop: 10 },
});
