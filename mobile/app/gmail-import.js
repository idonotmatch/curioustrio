import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { buildMockGmailImportState } from '../fixtures/mockGmailImport';

const SUMMARY_WINDOW_DAYS = 90;
const FORCE_MOCK_GMAIL_IMPORT_PREVIEW = true;

function reviewModeCountChips(summary = {}) {
  const breakdown = summary?.review_mode_breakdown || {};
  return [
    { key: 'quick_check', label: 'Quick check', count: breakdown.quick_check || 0 },
    { key: 'items_first', label: 'Items first', count: breakdown.items_first || 0 },
    { key: 'full_review', label: 'Full review', count: breakdown.full_review || 0 },
  ].filter((entry) => entry.count > 0);
}

const MOCK_GMAIL_IMPORT_STATE = buildMockGmailImportState();

export default function GmailImportScreen() {
  const [gmailStatus, setGmailStatus] = useState(null);
  const [importLog, setImportLog] = useState([]);
  const [importSummary, setImportSummary] = useState(null);
  const [importLogExpanded, setImportLogExpanded] = useState(false);
  const [importLogLoading, setImportLogLoading] = useState(false);
  const [importSummaryLoading, setImportSummaryLoading] = useState(false);
  const [gmailSyncing, setGmailSyncing] = useState(false);
  const [senderTrustExpanded, setSenderTrustExpanded] = useState(false);
  const shouldForceMockPreview = FORCE_MOCK_GMAIL_IMPORT_PREVIEW && __DEV__;
  const isUsingMockData = shouldForceMockPreview || (__DEV__ && !gmailStatus?.connected);
  const displayGmailStatus = isUsingMockData
    ? MOCK_GMAIL_IMPORT_STATE.gmailStatus
    : gmailStatus;
  const displayImportSummary = isUsingMockData && displayGmailStatus?.connected
    ? MOCK_GMAIL_IMPORT_STATE.importSummary
    : importSummary;
  const displayImportLog = isUsingMockData && displayGmailStatus?.connected
    ? MOCK_GMAIL_IMPORT_STATE.importLog
    : importLog;

  const loadGmailStatus = useCallback(async () => {
    try {
      const data = await api.get('/gmail/status');
      setGmailStatus(data);
    } catch {
      setGmailStatus(null);
    }
  }, []);

  useEffect(() => {
    loadGmailStatus();
  }, [loadGmailStatus]);

  useEffect(() => {
    if (gmailStatus?.connected) loadImportSummary();
  }, [gmailStatus?.connected]);

  function getImportReasonMeta(reason) {
    const normalized = (reason || '').trim();
    switch (normalized) {
      case 'heuristic_skip': return { label: 'filtered', detail: null };
      case 'classifier_not_expense': return { label: 'not expense', detail: null };
      case 'classifier_uncertain': return { label: 'uncertain', detail: null };
      case 'missing_amount': return { label: 'missing amount', detail: null };
      case 'missing structured receipt': return { label: 'uncertain', detail: null };
      case 'Network error': return { label: 'failed', detail: null };
      default:
        if (!normalized) return { label: 'other', detail: null };
        if (normalized.includes('not a purchase') || normalized.includes('shipping') || normalized.includes('tracking')) {
          return { label: 'not expense', detail: normalized };
        }
        if (normalized.length > 32 || normalized.includes(' ')) {
          return { label: 'skipped', detail: normalized };
        }
        return { label: normalized.replace(/_/g, ' '), detail: null };
    }
  }

  function summarizeReasonChips(reasons = []) {
    const grouped = new Map();
    for (const item of reasons) {
      const meta = getImportReasonMeta(item.reason);
      const existing = grouped.get(meta.label) || { label: meta.label, count: 0, rawReasons: new Set() };
      existing.count += item.count || 0;
      existing.rawReasons.add(item.reason);
      grouped.set(meta.label, existing);
    }
    return Array.from(grouped.values())
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .map(entry => ({
        label: entry.label,
        count: entry.count,
        detail: entry.rawReasons.size > 1 ? `${entry.rawReasons.size} reasons` : null,
      }));
  }

  function formatLogStatus(entry) {
    if (entry.status === 'imported' && entry.review_source === 'gmail') {
      const mode = entry.review_mode || 'full_review';
      if (mode === 'quick_check') return 'quick check';
      if (mode === 'items_first') return 'items first';
      return 'needs review';
    }
    if (entry.status === 'skipped') return getImportReasonMeta(entry.skip_reason).label;
    if (entry.status === 'failed') return 'failed';
    return entry.status;
  }

  function formatLogDetail(entry) {
    if (entry.status === 'imported') return null;
    return getImportReasonMeta(entry.skip_reason).detail;
  }

  function formatRelativeTime(value) {
    if (!value) return null;
    const diffMs = Date.now() - new Date(value).getTime();
    if (Number.isNaN(diffMs)) return null;
    const minutes = Math.max(0, Math.floor(diffMs / 60000));
    if (minutes < 1) return 'just now';
    if (minutes === 1) return '1 minute ago';
    if (minutes < 60) return `${minutes} minutes ago`;
    const hours = Math.floor(minutes / 60);
    if (hours === 1) return '1 hour ago';
    if (hours < 24) return `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
  }

  function formatSenderTrustLevel(level) {
    switch (level) {
      case 'trusted': return 'Trusted';
      case 'mixed': return 'Mixed';
      case 'noisy': return 'Noisy';
      default: return 'Learning';
    }
  }

  function senderTrustTone(level) {
    switch (level) {
      case 'trusted': return styles.senderTrustChipTrusted;
      case 'mixed': return styles.senderTrustChipMixed;
      case 'noisy': return styles.senderTrustChipNoisy;
      default: return styles.senderTrustChipUnknown;
    }
  }

function formatSenderReviewPath(sender = {}) {
  const reliability = sender.review_path_reliability || {};
  if (reliability.fast_lane_eligible) return 'Usually quick to review';
  if ((reliability.quick_check_count || 0) > 0) return `${reliability.quick_check_count} quick approvals`;
  if ((reliability.items_first_count || 0) > 0) return 'Often needs item cleanup';
  if ((reliability.full_review_count || 0) > 0) return 'Usually opened for full review';
  return 'Still learning';
}

function senderPolicyLabel(sender = {}) {
  if (sender.sender_preference?.force_review) return 'Always kept in review';
  if (sender.review_path_reliability?.fast_lane_eligible) return 'Eligible for quick review';
  return 'Review path adapts from recent history';
}

function rankSenderCard(sender = {}) {
  if (sender.sender_preference?.force_review) return 0;
  if (sender.level === 'noisy') return 1;
  if (sender.level === 'mixed') return 2;
  if (sender.review_path_reliability?.fast_lane_eligible) return 4;
  if (sender.level === 'trusted') return 3;
  return 5;
}

  const reasonChips = summarizeReasonChips(displayImportSummary?.reasons || []);
  const reviewPathChips = reviewModeCountChips(displayImportSummary);
  const senderQuality = Array.isArray(displayImportSummary?.quality?.sender_quality)
    ? displayImportSummary.quality.sender_quality
    : [];
  const senderPreferences = Array.isArray(displayImportSummary?.sender_preferences)
    ? displayImportSummary.sender_preferences
    : [];
  const senderCards = (senderQuality.length > 0
    ? senderQuality
    : senderPreferences.map((preference) => ({
      sender_domain: preference.sender_domain,
      level: 'unknown',
      top_changed_fields: [],
      item_reliability: { level: 'unknown' },
      sender_preference: {
        force_review: !!preference.force_review,
      },
      review_path_reliability: {},
    })))
    .sort((a, b) =>
      rankSenderCard(a) - rankSenderCard(b)
      || (b.review_path_reliability?.items_first_count || 0) - (a.review_path_reliability?.items_first_count || 0)
      || (b.imported || 0) - (a.imported || 0)
      || a.sender_domain.localeCompare(b.sender_domain));
  const visibleSenderCards = senderTrustExpanded ? senderCards : senderCards.slice(0, 3);

  async function connectGmail() {
    try {
      const data = await api.get('/gmail/auth');
      if (data?.url) {
        await WebBrowser.openAuthSessionAsync(data.url, 'expensetracker://');
        loadGmailStatus();
      }
    } catch (e) {
      Alert.alert('Gmail', e?.message || 'Could not start Gmail connection');
    }
  }

  async function loadImportLog() {
    setImportLogLoading(true);
    try {
      const data = await api.get('/gmail/import-log?limit=50');
      setImportLog(data);
    } catch {
      // Non-fatal
    } finally {
      setImportLogLoading(false);
    }
  }

  async function loadImportSummary() {
    setImportSummaryLoading(true);
    try {
      const data = await api.get(`/gmail/import-summary?days=${SUMMARY_WINDOW_DAYS}&sender_limit=10`);
      setImportSummary(data);
    } catch {
      setImportSummary(null);
    } finally {
      setImportSummaryLoading(false);
    }
  }

  async function syncGmail() {
    setGmailSyncing(true);
    try {
      const result = await api.post('/gmail/import', {});
      await Promise.all([loadImportLog(), loadImportSummary(), loadGmailStatus()]);
      const pendingReview = result?.outcomes?.imported_pending_review ?? 0;
      Alert.alert(
        'Gmail sync',
        `Imported ${result.imported ?? 0}, skipped ${result.skipped ?? 0}${result.failed ? `, failed ${result.failed}` : ''}${pendingReview ? `, ${pendingReview} queued for review` : ''}`
      );
    } catch (e) {
      Alert.alert('Gmail sync failed', e?.message || 'Something went wrong');
    } finally {
      setGmailSyncing(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Gmail Import' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>GMAIL</Text>
          <View style={styles.row}>
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle}>Gmail import</Text>
              <Text style={styles.rowSub}>
                {displayGmailStatus == null
                  ? 'Loading…'
                  : displayGmailStatus.connected
                    ? (displayGmailStatus.email ? displayGmailStatus.email : 'Connected')
                    : 'Not connected'}
              </Text>
              {displayGmailStatus?.connected && formatRelativeTime(displayImportSummary?.last_synced_at || displayGmailStatus?.last_synced_at) ? (
                <Text style={styles.rowSub}>
                  Last refresh {formatRelativeTime(displayImportSummary?.last_synced_at || displayGmailStatus?.last_synced_at)}
                </Text>
              ) : null}
            </View>
            <View style={styles.btnGroup}>
              {displayGmailStatus?.connected && !isUsingMockData && (
                <TouchableOpacity
                  style={[styles.actionBtn, gmailSyncing && styles.actionBtnDisabled]}
                  onPress={syncGmail}
                  disabled={gmailSyncing}
                >
                  <Text style={styles.actionBtnText}>{gmailSyncing ? 'Syncing…' : 'Sync'}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.actionBtn, isUsingMockData && styles.actionBtnDisabled]}
                onPress={connectGmail}
                disabled={isUsingMockData}
              >
                <Text style={styles.actionBtnText}>
                  {displayGmailStatus?.connected ? 'Reconnect' : 'Connect'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          {isUsingMockData ? (
            <Text style={styles.devPreviewNote}>
              Dev preview data is filling this screen until a real Gmail connection is available.
            </Text>
          ) : null}
          {displayGmailStatus?.connected && (
            importSummaryLoading ? (
              <ActivityIndicator color="#555" style={styles.loadingBlock} />
            ) : displayImportSummary ? (
              <>
                <View style={styles.summaryGrid}>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryValue}>{displayImportSummary.imported}</Text>
                    <Text style={styles.summaryLabel}>Imported</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryValue}>{displayImportSummary.imported_pending_review}</Text>
                    <Text style={styles.summaryLabel}>Need review</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryValue}>{displayImportSummary.skipped}</Text>
                    <Text style={styles.summaryLabel}>Skipped</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryValue}>{displayImportSummary.failed}</Text>
                    <Text style={styles.summaryLabel}>Failed</Text>
                  </View>
                </View>
                <View style={styles.senderTrustSection}>
                  <View style={styles.senderTrustHeader}>
                    <Text style={styles.senderTrustTitle}>Review queue mix</Text>
                    <Text style={styles.senderTrustSub}>
                      How the latest Gmail imports were routed into review.
                    </Text>
                  </View>
                  {reviewPathChips.length > 0 ? (
                    <View style={styles.reasonWrap}>
                      {reviewPathChips.map((item) => (
                        <View key={item.key} style={styles.reasonChip}>
                          <Text style={styles.reasonChipText}>
                            {item.label} · {item.count}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.sectionEmptyText}>
                      No recent queued Gmail imports yet.
                    </Text>
                  )}
                </View>
                <View style={styles.senderTrustSection}>
                  <View style={styles.senderTrustHeader}>
                    <Text style={styles.senderTrustTitle}>Import filters</Text>
                    <Text style={styles.senderTrustSub}>
                      Why messages were filtered or sent down a review path.
                    </Text>
                  </View>
                  {reasonChips.length > 0 ? (
                    <View style={styles.reasonWrap}>
                      {reasonChips.slice(0, 6).map(item => (
                        <View key={item.label} style={styles.reasonChip}>
                          <Text style={styles.reasonChipText}>
                            {item.label} · {item.count}{item.detail ? ` · ${item.detail}` : ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.sectionEmptyText}>
                      No recent filter or skip reasons yet.
                    </Text>
                  )}
                </View>
                <View style={styles.senderTrustSection}>
                  <View style={styles.senderTrustHeader}>
                    <Text style={styles.senderTrustTitle}>Sender trust</Text>
                    <Text style={styles.senderTrustSub}>
                      Reliable senders can move into lighter review paths.
                    </Text>
                  </View>
                  {senderCards.length > 0 ? (
                    <>
                      {visibleSenderCards.map((sender) => (
                      <View key={sender.sender_domain} style={styles.senderTrustCard}>
                        <View style={styles.senderTrustTopRow}>
                          <Text style={styles.senderTrustDomain}>{sender.sender_domain}</Text>
                          <View style={[styles.senderTrustChip, senderTrustTone(sender.level)]}>
                            <Text style={styles.senderTrustChipText}>{formatSenderTrustLevel(sender.level)}</Text>
                          </View>
                        </View>
                        <Text style={styles.senderTrustMeta}>
                          {formatSenderReviewPath(sender)}
                          {sender.item_reliability?.level && sender.item_reliability.level !== 'unknown'
                            ? ` · Items ${sender.item_reliability.level}`
                            : ''}
                        </Text>
                        {Array.isArray(sender.top_changed_fields) && sender.top_changed_fields.length > 0 ? (
                          <Text style={styles.senderTrustDetail}>
                            Usually corrected: {sender.top_changed_fields.map((entry) => entry.field.replace(/_/g, ' ')).join(', ')}
                          </Text>
                        ) : null}
                        <Text style={[
                          styles.senderTrustPolicy,
                          sender.sender_preference?.force_review && styles.senderTrustPolicyStrong,
                        ]}>
                          {senderPolicyLabel(sender)}
                        </Text>
                      </View>
                      ))}
                      {senderCards.length > 3 ? (
                        <TouchableOpacity
                          style={styles.expandToggle}
                          onPress={() => setSenderTrustExpanded((current) => !current)}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.expandToggleText}>
                            {senderTrustExpanded
                              ? 'Show fewer senders'
                              : `Show ${senderCards.length - visibleSenderCards.length} more sender${senderCards.length - visibleSenderCards.length === 1 ? '' : 's'}`}
                          </Text>
                          <Ionicons
                            name={senderTrustExpanded ? 'chevron-up' : 'chevron-down'}
                            size={14}
                            color="#888"
                          />
                        </TouchableOpacity>
                      ) : null}
                    </>
                  ) : (
                    <Text style={styles.sectionEmptyText}>
                      Sender trust will appear here once Adlo has enough recent Gmail review history.
                    </Text>
                  )}
                </View>
                <Text style={styles.summaryWindow}>Last {displayImportSummary.window_days || SUMMARY_WINDOW_DAYS} days</Text>
              </>
            ) : null
          )}
        </View>

        {displayGmailStatus?.connected && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.logToggleRow}
              onPress={() => {
                const next = !importLogExpanded;
                setImportLogExpanded(next);
                if (next && importLog.length === 0 && !isUsingMockData) loadImportLog();
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.sectionTitle}>IMPORT LOG</Text>
              <Ionicons name={importLogExpanded ? 'chevron-up' : 'chevron-down'} size={13} color="#444" />
            </TouchableOpacity>
            {importLogExpanded && (
              importLogLoading ? (
                <ActivityIndicator color="#555" style={styles.loadingBlock} />
              ) : displayImportLog.length === 0 ? (
                <Text style={styles.emptyText}>No import history yet.</Text>
              ) : (
                displayImportLog.map(entry => (
                  <View key={entry.id} style={styles.logRow}>
                    <View style={styles.logRowLeft}>
                      <Text style={styles.logSubject} numberOfLines={1}>
                        {entry.subject || '(no subject)'}
                      </Text>
                      <Text style={styles.logFrom} numberOfLines={1}>
                        {entry.from_address || '—'}
                      </Text>
                      {formatLogDetail(entry) ? (
                        <Text style={styles.logDetail} numberOfLines={1}>
                          {formatLogDetail(entry)}
                        </Text>
                      ) : null}
                      {entry.review_source === 'gmail' ? (
                        <Text style={styles.logContext}>
                          Routed to {formatLogStatus(entry)}
                          {entry.review_required ? ' before confirmation' : ''}
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.logRowRight}>
                      <Text style={[
                        styles.logStatus,
                        entry.status === 'imported' && styles.logStatusImported,
                        entry.status === 'failed' && styles.logStatusFailed,
                      ]}>
                        {formatLogStatus(entry)}
                      </Text>
                      <Text style={styles.logDate}>
                        {new Date(entry.imported_at).toLocaleDateString()}
                      </Text>
                    </View>
                  </View>
                ))
              )
            )}
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 48 },
  section: { marginBottom: 32, borderBottomWidth: 1, borderBottomColor: '#111', paddingBottom: 24 },
  sectionTitle: { fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowInfo: { flex: 1, marginRight: 12 },
  rowTitle: { color: '#f5f5f5', fontSize: 15, fontWeight: '500' },
  rowSub: { color: '#555', fontSize: 12, marginTop: 2 },
  devPreviewNote: { color: '#8ab4ff', fontSize: 11, marginTop: 10, lineHeight: 16 },
  btnGroup: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionBtn: { backgroundColor: '#1a1a1a', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#2a2a2a', justifyContent: 'center' },
  actionBtnDisabled: { opacity: 0.4 },
  actionBtnText: { color: '#f5f5f5', fontSize: 13, fontWeight: '500' },
  loadingBlock: { alignSelf: 'flex-start', marginTop: 12 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  summaryCard: { minWidth: 76, backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#1e1e1e', paddingHorizontal: 12, paddingVertical: 10 },
  summaryValue: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  summaryLabel: { color: '#666', fontSize: 11, marginTop: 2 },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  reasonChip: { borderRadius: 999, borderWidth: 1, borderColor: '#1f1f1f', backgroundColor: '#111', paddingHorizontal: 10, paddingVertical: 6 },
  reasonChipText: { color: '#777', fontSize: 11 },
  senderTrustSection: { marginTop: 14, gap: 10 },
  senderTrustHeader: { gap: 3 },
  senderTrustTitle: { color: '#f5f5f5', fontSize: 13, fontWeight: '600' },
  senderTrustSub: { color: '#666', fontSize: 11 },
  sectionEmptyText: { color: '#666', fontSize: 12, lineHeight: 18 },
  senderTrustCard: { backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#1e1e1e', padding: 12 },
  senderTrustTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  senderTrustDomain: { color: '#f5f5f5', fontSize: 13, fontWeight: '500', flex: 1 },
  senderTrustChip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  senderTrustChipTrusted: { backgroundColor: 'rgba(34,197,94,0.14)' },
  senderTrustChipMixed: { backgroundColor: 'rgba(245,158,11,0.16)' },
  senderTrustChipNoisy: { backgroundColor: 'rgba(248,113,113,0.14)' },
  senderTrustChipUnknown: { backgroundColor: 'rgba(96,165,250,0.14)' },
  senderTrustChipText: { color: '#f5f5f5', fontSize: 11, fontWeight: '700' },
  senderTrustMeta: { color: '#777', fontSize: 11, marginTop: 6 },
  senderTrustDetail: { color: '#555', fontSize: 11, marginTop: 4, lineHeight: 16 },
  senderTrustPolicy: { color: '#8ab4ff', fontSize: 11, marginTop: 8, fontWeight: '600' },
  senderTrustPolicyStrong: { color: '#fcd34d' },
  expandToggle: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    backgroundColor: '#0f0f0f',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  expandToggleText: { color: '#b8b8b8', fontSize: 12, fontWeight: '600' },
  summaryWindow: { color: '#444', fontSize: 11, marginTop: 10 },
  logToggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  logRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#111' },
  logRowLeft: { flex: 1, marginRight: 12 },
  logSubject: { color: '#f5f5f5', fontSize: 13 },
  logFrom: { color: '#555', fontSize: 11, marginTop: 2 },
  logDetail: { color: '#555', fontSize: 11, marginTop: 4 },
  logContext: { color: '#8ab4ff', fontSize: 11, marginTop: 6 },
  logRowRight: { alignItems: 'flex-end' },
  logStatus: { fontSize: 11, color: '#888', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  logStatusImported: { color: '#4ade80' },
  logStatusFailed: { color: '#ef4444' },
  logDate: { color: '#444', fontSize: 11, marginTop: 2 },
  emptyText: { color: '#555', fontSize: 13, marginBottom: 12 },
});
