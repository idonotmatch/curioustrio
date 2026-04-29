import { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api } from '../services/api';

function reasonLabel(reason = '') {
  switch (`${reason}`.trim()) {
    case 'below_surface_threshold':
      return 'Below surface threshold';
    case 'expired_insight':
      return 'Expired before surfacing';
    case 'stale_temporal_window':
      return 'Outside the useful timing window';
    case 'unknown_merchant_anchor':
      return 'Missing a trustworthy merchant anchor';
    case 'thin_explanatory_evidence':
      return 'Not enough evidence yet';
    case 'weak_category_assignment_signal':
      return 'Category confidence is still weak';
    case 'early_signal_missing_anchor':
      return 'Too early without a strong anchor';
    case 'stale_low_signal':
      return 'Seen too often without enough value';
    default:
      return `${reason || 'Unknown reason'}`
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

function compactNumber(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? `${amount}` : '0';
}

function summarizeDiagnostics(debug = null) {
  const rawCount = Number(debug?.raw?.count || 0);
  const finalCount = Number(debug?.final?.count || 0);
  const dismissedCount = Number(debug?.feedback?.dismissed_raw_count || 0);
  const suppressedCount = Number(debug?.feedback?.suppressed_raw_count || 0);
  const thresholdCount = Number(debug?.feedback?.below_threshold_raw_count || 0);

  if (finalCount > 0) {
    return {
      tone: 'good',
      title: 'Insights are being generated',
      body: `Adlo currently has ${finalCount} surfaced insight${finalCount === 1 ? '' : 's'} for your account. If Summary is still blank on this device, we are probably looking at a client-side bug, stale cache, or local suppression.`,
    };
  }

  if (rawCount === 0) {
    return {
      tone: 'neutral',
      title: 'No insight candidates yet',
      body: 'The engine is not seeing enough meaningful spending signals for the current period yet, so there is nothing to surface right now.',
    };
  }

  if (dismissedCount >= rawCount) {
    return {
      tone: 'neutral',
      title: 'Your available insights are currently dismissed',
      body: 'The engine has candidates, but the ones it can build right now are already in a dismissed state. That usually means the summary tab is behaving correctly.',
    };
  }

  if (thresholdCount >= rawCount) {
    return {
      tone: 'neutral',
      title: 'Signals exist, but they are still too weak',
      body: 'Adlo found candidates, but none of them cleared the surface threshold yet. This is usually not a bug; it means the signals are still too light or too noisy.',
    };
  }

  if (suppressedCount >= rawCount) {
    return {
      tone: 'neutral',
      title: 'Signals are being intentionally suppressed',
      body: 'The engine found candidates, but feedback or continuity rules are keeping them off the summary surface for now.',
    };
  }

  return {
    tone: 'neutral',
    title: 'Nothing is surfacing right now',
    body: 'Adlo is generating candidates, but none are currently making it through all ranking and suppression checks. The breakdown below should tell us which gate is doing the work.',
  };
}

function toneStyles(tone = 'neutral') {
  if (tone === 'good') {
    return {
      card: styles.heroCardGood,
      eyebrow: styles.heroEyebrowGood,
      title: styles.heroTitleGood,
    };
  }
  return {
    card: styles.heroCardNeutral,
    eyebrow: styles.heroEyebrowNeutral,
    title: styles.heroTitleNeutral,
  };
}

function sortedReasonRows(debug = null) {
  const entries = Object.entries(debug?.surface_summary?.by_reason || {});
  return entries
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .map(([reason, count]) => ({
      reason,
      label: reasonLabel(reason),
      count: Number(count || 0),
    }));
}

function topSuppressedRows(debug = null) {
  return (Array.isArray(debug?.ranking_comparison?.suppressed_candidates)
    ? debug.ranking_comparison.suppressed_candidates
    : []
  )
    .slice(0, 4)
    .map((candidate) => ({
      id: candidate.id,
      title: candidate.title || 'Untitled insight',
      type: candidate.type || 'unknown',
      reasons: Array.isArray(candidate.suppression_reasons) ? candidate.suppression_reasons : [],
      score: candidate.surface_score,
      threshold: candidate.threshold,
    }));
}

function surfacedRows(debug = null) {
  return (Array.isArray(debug?.final_insights) ? debug.final_insights : []).slice(0, 4);
}

function DiagnosticsSection({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function InsightDiagnosticsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [debug, setDebug] = useState(null);

  const loadDebug = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const data = await api.get('/insights/debug?limit=10');
      setDebug(data);
    } catch (err) {
      setDebug(null);
      setError(err?.message || 'Could not load insight diagnostics.');
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    loadDebug();
  }, [loadDebug]));

  const summary = summarizeDiagnostics(debug);
  const tone = toneStyles(summary.tone);
  const reasonRows = sortedReasonRows(debug);
  const suppressedRows = topSuppressedRows(debug);
  const currentRows = surfacedRows(debug);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.heroCard, tone.card]}>
        <Text style={[styles.heroEyebrow, tone.eyebrow]}>Insight diagnostics</Text>
        <Text style={[styles.heroTitle, tone.title]}>{summary.title}</Text>
        <Text style={styles.heroBody}>{summary.body}</Text>
        <TouchableOpacity
          style={[styles.refreshButton, refreshing && styles.buttonDisabled]}
          onPress={() => loadDebug({ silent: true })}
          disabled={refreshing}
          activeOpacity={0.88}
        >
          <Text style={styles.refreshButtonText}>{refreshing ? 'Refreshing...' : 'Refresh diagnostics'}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator color="#d4d4d4" />
          <Text style={styles.loadingText}>Checking the insight engine...</Text>
        </View>
      ) : null}

      {!loading && error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Couldn’t load insight diagnostics</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <TouchableOpacity style={styles.errorRetry} onPress={() => loadDebug()}>
            <Text style={styles.errorRetryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {!loading && !error && debug ? (
        <>
          <DiagnosticsSection title="Current counts">
            <View style={styles.metricsGrid}>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>{compactNumber(debug?.final?.count)}</Text>
                <Text style={styles.metricLabel}>Surfaced now</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>{compactNumber(debug?.raw?.count)}</Text>
                <Text style={styles.metricLabel}>Raw candidates</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>{compactNumber(debug?.feedback?.below_threshold_raw_count)}</Text>
                <Text style={styles.metricLabel}>Below threshold</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>{compactNumber(debug?.feedback?.dismissed_raw_count)}</Text>
                <Text style={styles.metricLabel}>Dismissed</Text>
              </View>
            </View>
          </DiagnosticsSection>

          {currentRows.length > 0 ? (
            <DiagnosticsSection title="Surfaced insights">
              <View style={styles.stack}>
                {currentRows.map((row) => (
                  <View key={row.id} style={styles.listCard}>
                    <Text style={styles.listTitle}>{row.title}</Text>
                    <Text style={styles.listMeta}>
                      {`${row.type || 'unknown'} · ${row.scope || 'personal'} · ${row.maturity || 'unspecified'}`}
                    </Text>
                  </View>
                ))}
              </View>
            </DiagnosticsSection>
          ) : null}

          {reasonRows.length > 0 ? (
            <DiagnosticsSection title="Why candidates are being blocked">
              <View style={styles.stack}>
                {reasonRows.map((row) => (
                  <View key={row.reason} style={styles.reasonRow}>
                    <Text style={styles.reasonLabel}>{row.label}</Text>
                    <Text style={styles.reasonCount}>{row.count}</Text>
                  </View>
                ))}
              </View>
            </DiagnosticsSection>
          ) : null}

          {suppressedRows.length > 0 ? (
            <DiagnosticsSection title="Closest blocked candidates">
              <View style={styles.stack}>
                {suppressedRows.map((row) => (
                  <View key={row.id} style={styles.listCard}>
                    <Text style={styles.listTitle}>{row.title}</Text>
                    <Text style={styles.listMeta}>
                      {`${row.type || 'unknown'} · score ${compactNumber(row.score)} / threshold ${compactNumber(row.threshold)}`}
                    </Text>
                    {row.reasons.length > 0 ? (
                      <Text style={styles.listBody}>
                        {row.reasons.map(reasonLabel).join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </DiagnosticsSection>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 40, gap: 18 },
  heroCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  heroCardGood: {
    backgroundColor: '#0f1412',
    borderColor: '#1d3b2a',
  },
  heroCardNeutral: {
    backgroundColor: '#111214',
    borderColor: '#21252b',
  },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  heroEyebrowGood: { color: '#8fd2a6' },
  heroEyebrowNeutral: { color: '#9cabbb' },
  heroTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  heroTitleGood: { color: '#eefaf1' },
  heroTitleNeutral: { color: '#f5f5f5' },
  heroBody: {
    color: '#b8c2cd',
    fontSize: 14,
    lineHeight: 20,
  },
  refreshButton: {
    marginTop: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#f5f5f5',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  refreshButtonText: {
    color: '#0a0a0a',
    fontSize: 13,
    fontWeight: '700',
  },
  buttonDisabled: { opacity: 0.55 },
  loadingCard: {
    backgroundColor: '#111214',
    borderWidth: 1,
    borderColor: '#20252b',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#a6b1bd',
    fontSize: 14,
  },
  errorCard: {
    backgroundColor: '#141111',
    borderColor: '#332020',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  errorTitle: { color: '#f5f5f5', fontSize: 16, fontWeight: '700' },
  errorBody: { color: '#d0b4b4', fontSize: 14, lineHeight: 20 },
  errorRetry: {
    alignSelf: 'flex-start',
    marginTop: 4,
    backgroundColor: '#201616',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorRetryText: { color: '#f0c8c8', fontSize: 13, fontWeight: '700' },
  section: { gap: 10 },
  sectionTitle: {
    color: '#8d98a6',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    minWidth: '47%',
    flexGrow: 1,
    backgroundColor: '#101114',
    borderColor: '#1c2026',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  metricValue: {
    color: '#f5f5f5',
    fontSize: 24,
    fontWeight: '700',
  },
  metricLabel: {
    color: '#96a2af',
    fontSize: 13,
  },
  stack: { gap: 10 },
  listCard: {
    backgroundColor: '#101114',
    borderColor: '#1b2026',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  listTitle: {
    color: '#f5f5f5',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  listMeta: {
    color: '#90a0af',
    fontSize: 12,
  },
  listBody: {
    color: '#b7c1cc',
    fontSize: 13,
    lineHeight: 18,
  },
  reasonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#101114',
    borderColor: '#1b2026',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  reasonLabel: {
    flex: 1,
    color: '#d8e1ea',
    fontSize: 14,
    lineHeight: 19,
  },
  reasonCount: {
    color: '#f5f5f5',
    fontSize: 14,
    fontWeight: '700',
  },
});
