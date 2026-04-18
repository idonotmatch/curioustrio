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
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { invalidateCache } from '../services/cache';
import { buildMockGmailImportState, buildMockPendingExpenses } from '../fixtures/mockGmailImport';

const SUMMARY_WINDOW_DAYS = 90;
const FORCE_MOCK_GMAIL_IMPORT_PREVIEW = false;

function reviewModeCountChips(summary = {}) {
  const breakdown = summary?.current_review_mode_breakdown || summary?.review_mode_breakdown || {};
  return [
    { key: 'quick_check', label: 'Quick confirm', count: breakdown.quick_check || 0 },
    { key: 'items_first', label: 'Item cleanup', count: breakdown.items_first || 0 },
    { key: 'full_review', label: 'Full review', count: breakdown.full_review || 0 },
  ].filter((entry) => entry.count > 0);
}

const MOCK_GMAIL_IMPORT_STATE = buildMockGmailImportState();

export default function GmailImportScreen() {
  const router = useRouter();
  const [gmailStatus, setGmailStatus] = useState(null);
  const [importLog, setImportLog] = useState([]);
  const [importSummary, setImportSummary] = useState(null);
  const [pendingReviewItems, setPendingReviewItems] = useState([]);
  const [pendingReviewError, setPendingReviewError] = useState(null);
  const [importLogExpanded, setImportLogExpanded] = useState(false);
  const [importLogLoading, setImportLogLoading] = useState(false);
  const [importSummaryLoading, setImportSummaryLoading] = useState(false);
  const [gmailSyncing, setGmailSyncing] = useState(false);
  const [retryingFailedIds, setRetryingFailedIds] = useState([]);
  const [retryingAllFailed, setRetryingAllFailed] = useState(false);
  const [senderTrustExpanded, setSenderTrustExpanded] = useState(false);
  const [learningExpanded, setLearningExpanded] = useState(false);
  const [senderSectionExpanded, setSenderSectionExpanded] = useState(false);
  const shouldForceMockPreview = FORCE_MOCK_GMAIL_IMPORT_PREVIEW && __DEV__;
  const isUsingMockData = shouldForceMockPreview;
  const displayGmailStatus = isUsingMockData
    ? MOCK_GMAIL_IMPORT_STATE.gmailStatus
    : gmailStatus;
  const displayImportSummary = isUsingMockData && displayGmailStatus?.connected
    ? MOCK_GMAIL_IMPORT_STATE.importSummary
    : importSummary;
  const displayImportLog = isUsingMockData && displayGmailStatus?.connected
    ? MOCK_GMAIL_IMPORT_STATE.importLog
    : importLog;
  const displayPendingReviewItems = isUsingMockData && displayGmailStatus?.connected
    ? buildMockPendingExpenses().filter((item) => item.review_source === 'gmail' || item.source === 'email')
    : pendingReviewItems;

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

  useFocusEffect(useCallback(() => {
    loadGmailStatus();
    if (displayGmailStatus?.connected || gmailStatus?.connected) {
      loadImportSummary();
      loadPendingQueue();
      if (importLogExpanded) loadImportLog();
    }
  }, [
    loadGmailStatus,
    importLogExpanded,
    displayGmailStatus?.connected,
    gmailStatus?.connected,
  ]));

  useEffect(() => {
    if (gmailStatus?.connected) {
      loadImportSummary();
      loadPendingQueue();
    }
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
    if (entry.expense_status === 'confirmed') return 'reviewed';
    if (entry.expense_status === 'dismissed') return 'dismissed';
    if (entry.review_action === 'approved') return 'reviewed';
    if (entry.review_action === 'edited') return 'edited';
    if (entry.review_action === 'dismissed') return 'dismissed';
    if (entry.status === 'imported' && entry.review_source === 'gmail') {
      if (entry.review_required === false) return 'handled';
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
      case 'trusted': return 'Usually accurate';
      case 'mixed': return 'Sometimes needs review';
      case 'noisy': return 'Usually needs review';
      default: return 'Still learning';
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
  if (sender.sender_preference?.force_review) return 'Always sent to review';
  if (reliability.fast_lane_eligible) return 'Usually ready for a quick confirmation';
  if ((reliability.items_first_count || 0) > 0) return 'Often needs item cleanup first';
  if ((reliability.full_review_count || 0) > 0) return 'Usually worth a closer review';
  if ((reliability.quick_check_count || 0) > 0) return 'Often lightweight to review';
  return 'Adlo is still learning this sender';
}

function senderPolicyLabel(sender = {}) {
  if (sender.sender_preference?.force_review) return 'Always review';
  if (sender.review_path_reliability?.fast_lane_eligible) return 'Can often stay lightweight';
  return 'Adapts from your review history';
}

function formatDismissReason(reason = '') {
  switch (`${reason}`) {
    case 'not_an_expense': return 'not an expense';
    case 'duplicate': return 'duplicate';
    case 'business_or_track_only': return 'business or track only';
    case 'transfer_or_payment': return 'transfer or payment';
    case 'wrong_details': return 'wrong details';
    case 'other': return 'other';
    default: return `${reason}`.replace(/_/g, ' ');
  }
}

function formatTemplateLabel(pattern = '') {
  switch (pattern) {
    case 'amazon_order': return 'Amazon order';
    case 'amazon_shipping': return 'Amazon shipping';
    case 'amazon_refund': return 'Amazon refund';
    case 'generic_receipt': return 'Receipt';
    case 'generic_shipping': return 'Shipping update';
    case 'generic_refund': return 'Refund';
    case 'generic_payment': return 'Payment receipt';
    case 'generic_invoice': return 'Invoice';
    case 'generic_subscription': return 'Subscription';
    case 'generic_trip': return 'Trip or ride receipt';
    case 'generic_marketing': return 'Marketing';
    default: return `${pattern || 'Unknown template'}`.replace(/_/g, ' ');
  }
}

function rankSenderCard(sender = {}) {
  if (sender.sender_preference?.force_review) return 0;
  if (sender.level === 'noisy') return 1;
  if (sender.level === 'mixed') return 2;
  if (sender.review_path_reliability?.fast_lane_eligible) return 4;
  if (sender.level === 'trusted') return 3;
  return 5;
}

function learningSummaryLines(summary = {}, reasonChips = [], topDismissReasons = []) {
  const lines = [];
  const pendingReview = Number(summary?.current_pending_review ?? summary?.imported_pending_review ?? 0);
  const approvedWithoutChanges = Number(summary?.approved_without_changes || 0);
  const approvedAfterChanges = Number(summary?.approved_after_changes || 0);
  const skipped = Number(summary?.skipped || 0);

  if (approvedWithoutChanges > 0 || approvedAfterChanges > 0) {
    if (approvedWithoutChanges >= approvedAfterChanges) {
      lines.push(`Most recent imports were close enough to approve with little or no cleanup.`);
    } else {
      lines.push(`Recent imports still often need edits before they are ready to approve.`);
    }
  }

  if (pendingReview > 0) {
    lines.push(`${pendingReview} import${pendingReview === 1 ? ' is' : 's are'} waiting because Adlo still wanted your confirmation.`);
  }

  if (reasonChips.length > 0 && skipped > 0) {
    const top = reasonChips.slice(0, 2).map((item) => item.label).join(' and ');
    lines.push(`Recent filtering mostly removed ${top} messages before they reached your queue.`);
  }

  if (topDismissReasons.length > 0) {
    const top = topDismissReasons
      .slice(0, 2)
      .map((item) => formatDismissReason(item.reason))
      .join(' and ');
    lines.push(`When you dismiss Gmail imports, it is usually because they are ${top}.`);
  }

  return lines.slice(0, 3);
}

function importHealthMessage(summary = {}) {
  const failed = Number(summary?.failed || 0);
  const pendingReview = Number(summary?.current_pending_review ?? summary?.imported_pending_review ?? 0);
  const imported = Number(summary?.imported || 0);
  if (failed > 0) return `${failed} recent import${failed === 1 ? '' : 's'} failed and may need another sync.`;
  if (pendingReview > 0) return `${pendingReview} Gmail import${pendingReview === 1 ? '' : 's'} still need your review.`;
  if (imported > 0) return `Recent Gmail imports are coming through normally.`;
  return 'No recent Gmail activity yet.';
}

function formatSyncSource(source) {
  if (source === 'manual') return 'manual refresh';
  if (source === 'scheduler') return 'background refresh';
  return 'sync';
}

function syncStatusMessage(status = {}, summary = {}) {
  const lastSuccess = formatRelativeTime(summary?.last_synced_at || status?.last_synced_at);
  const lastAttempt = formatRelativeTime(summary?.last_sync_attempted_at || status?.last_sync_attempted_at);
  const lastError = summary?.last_sync_error || status?.last_sync_error;
  const source = summary?.last_sync_source || status?.last_sync_source;
  const syncStatus = summary?.last_sync_status || status?.last_sync_status;

  if (syncStatus === 'failed' && lastAttempt) {
    return `Last ${formatSyncSource(source)} failed ${lastAttempt}.`;
  }
  if (lastSuccess) {
    return `Last ${formatSyncSource(source)} ${lastSuccess}.`;
  }
  if (lastAttempt) {
    return `Last ${formatSyncSource(source)} was ${lastAttempt}.`;
  }
  if (lastError) {
    return 'Gmail sync hit an issue before finishing.';
  }
  return null;
}

function syncErrorMessage(status = {}, summary = {}) {
  const lastError = summary?.last_sync_error || status?.last_sync_error;
  if (!lastError) return null;
  const normalized = `${lastError}`.trim();
  if (!normalized) return null;
  if (normalized.length <= 90) return normalized;
  return `${normalized.slice(0, 87)}...`;
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
  const topDismissReasons = Array.isArray(displayImportSummary?.debug?.top_dismiss_reasons)
    ? displayImportSummary.debug.top_dismiss_reasons
    : [];
  const topTemplates = Array.isArray(displayImportSummary?.debug?.top_templates)
    ? displayImportSummary.debug.top_templates
    : [];
  const learningLines = learningSummaryLines(displayImportSummary, reasonChips, topDismissReasons);
  const collapsedLearningLine = learningLines[0] || 'Adlo will summarize what it is learning here once more Gmail review history builds up.';
  const collapsedSenderCards = senderSectionExpanded ? visibleSenderCards : [];

  async function connectGmail() {
    try {
      const data = await api.get('/gmail/auth');
      if (data?.url) {
        const redirectUrl = Linking.createURL('/gmail-import');
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
        if (result.type === 'success' || result.type === 'opened') {
          await Promise.all([loadGmailStatus(), loadImportSummary(), loadPendingQueue()]);
        }
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

  async function loadPendingQueue() {
    try {
      const data = await api.get('/expenses/pending');
      const gmailItems = Array.isArray(data)
        ? data.filter((item) => item?.review_source === 'gmail' || item?.source === 'email')
        : [];
      setPendingReviewItems(gmailItems);
      setPendingReviewError(null);
    } catch {
      setPendingReviewItems([]);
      setPendingReviewError('Could not load your review queue.');
    }
  }

  async function syncGmail() {
    setGmailSyncing(true);
    try {
      const result = await api.post('/gmail/import', {});
      await invalidateCache('cache:expenses:pending');
      await Promise.all([loadImportLog(), loadImportSummary(), loadGmailStatus(), loadPendingQueue()]);
      const pendingReview = result?.outcomes?.imported_pending_review ?? 0;
      Alert.alert('Gmail sync',
        `Imported ${result.imported ?? 0}, skipped ${result.skipped ?? 0}${result.failed ? `, failed ${result.failed}` : ''}${pendingReview ? `, ${pendingReview} added to your review queue` : ''}`,
        pendingReview > 0
          ? [
              { text: 'Later', style: 'cancel' },
              { text: 'Open review queue', onPress: () => router.push('/review-queue') },
            ]
          : [{ text: 'OK' }]
      );
    } catch (e) {
      Alert.alert('Gmail sync failed', e?.message || 'Something went wrong');
    } finally {
      setGmailSyncing(false);
    }
  }

  async function retryFailedImport(logId) {
    setRetryingFailedIds((current) => [...current, logId]);
    try {
      const result = await api.post(`/gmail/import-log/${logId}/retry`, {});
      await invalidateCache('cache:expenses:pending');
      await Promise.all([loadImportLog(), loadImportSummary(), loadGmailStatus(), loadPendingQueue()]);
      Alert.alert(
        'Retry complete',
        result.imported
          ? 'The failed email was reprocessed and added back into your import flow.'
          : result.skipped
            ? 'The failed email was retried, but it is still being skipped.'
            : 'The retry attempt did not recover this email yet.'
      );
    } catch (e) {
      Alert.alert('Retry failed', e?.message || 'Could not retry this import');
    } finally {
      setRetryingFailedIds((current) => current.filter((id) => id !== logId));
    }
  }

  async function retryAllFailedImports() {
    setRetryingAllFailed(true);
    try {
      const result = await api.post('/gmail/retry-failed', { limit: 10 });
      await invalidateCache('cache:expenses:pending');
      await Promise.all([loadImportLog(), loadImportSummary(), loadGmailStatus(), loadPendingQueue()]);
      Alert.alert(
        'Retries finished',
        `Tried ${result.attempted || 0}. Imported ${result.imported || 0}, skipped ${result.skipped || 0}${result.failed ? `, failed ${result.failed}` : ''}.`
      );
    } catch (e) {
      Alert.alert('Retry failed', e?.message || 'Could not retry failed imports');
    } finally {
      setRetryingAllFailed(false);
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
                    ? (displayGmailStatus.email ? `Connected to ${displayGmailStatus.email}` : 'Connected')
                    : 'Not connected'}
              </Text>
              {displayGmailStatus?.connected && syncStatusMessage(displayGmailStatus, displayImportSummary) ? (
                <Text style={styles.rowSub}>
                  {syncStatusMessage(displayGmailStatus, displayImportSummary)}
                </Text>
              ) : null}
              {displayGmailStatus?.connected && syncErrorMessage(displayGmailStatus, displayImportSummary) ? (
                <Text style={styles.rowMetaAlert}>
                  {syncErrorMessage(displayGmailStatus, displayImportSummary)}
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
                    <Text style={styles.summaryLabel}>Imported</Text>
                    <Text style={styles.summaryValue}>{displayImportSummary.imported}</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryLabel}>Awaiting review</Text>
                    <Text style={styles.summaryValue}>{displayImportSummary.current_pending_review ?? displayImportSummary.imported_pending_review}</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryLabel}>Approved cleanly</Text>
                    <Text style={styles.summaryValue}>{displayImportSummary.approved_without_changes ?? 0}</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryLabel}>Filtered out</Text>
                    <Text style={styles.summaryValue}>{displayImportSummary.skipped}</Text>
                  </View>
                </View>
                <View style={styles.senderTrustSection}>
                  <View style={styles.senderTrustHeader}>
                    <Text style={styles.senderTrustTitle}>Import health</Text>
                  </View>
                  <Text style={styles.sectionEmptyText}>
                    {importHealthMessage(displayImportSummary)}
                  </Text>
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
                  ) : null}
                </View>
                <View style={styles.senderTrustSection}>
                  <TouchableOpacity
                    style={styles.expandSectionHeader}
                    onPress={() => setLearningExpanded((current) => !current)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.expandSectionTitleWrap}>
                      <Text style={styles.senderTrustTitle}>What Adlo is learning</Text>
                      <Text style={styles.sectionEmptyText}>{collapsedLearningLine}</Text>
                    </View>
                    <Ionicons
                      name={learningExpanded ? 'chevron-up' : 'chevron-down'}
                      size={15}
                      color="#666"
                    />
                  </TouchableOpacity>
                  {learningExpanded ? (
                    <>
                      {learningLines.length > 0 ? (
                        <View style={styles.learningList}>
                          {learningLines.map((line) => (
                            <View key={line} style={styles.learningRow}>
                              <View style={styles.learningDot} />
                              <Text style={styles.learningText}>{line}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                      {reasonChips.length > 0 || topDismissReasons.length > 0 ? (
                        <View style={styles.reasonWrap}>
                          {reasonChips.slice(0, 3).map(item => (
                            <View key={`reason-${item.label}`} style={styles.reasonChip}>
                              <Text style={styles.reasonChipText}>
                                Filtered: {item.label} · {item.count}
                              </Text>
                            </View>
                          ))}
                          {topDismissReasons.slice(0, 4).map((item) => (
                            <View key={`dismiss-${item.reason}`} style={styles.reasonChip}>
                              <Text style={styles.reasonChipText}>
                                Dismissed: {formatDismissReason(item.reason)} · {item.count}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.sectionEmptyText}>
                          No recent filter or dismiss patterns yet.
                        </Text>
                      )}
                      {topTemplates.length > 0 ? (
                        <View style={styles.templateList}>
                          {topTemplates.slice(0, 4).map((template) => (
                            <View key={`${template.sender_domain}-${template.subject_pattern}`} style={styles.templateRow}>
                              <View style={styles.templateRowMain}>
                                <Text style={styles.templateTitle}>
                                  {formatTemplateLabel(template.subject_pattern)}
                                </Text>
                                <Text style={styles.templateMeta}>
                                  {template.sender_domain} · {template.total} seen · {template.learned_disposition || 'unknown'}
                                </Text>
                              </View>
                              <Text style={styles.templateOutcome}>
                                {template.skipped > 0 ? `${template.skipped} skipped` : `${template.imported} imported`}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </>
                  ) : null}
                </View>
                <View style={styles.senderTrustSection}>
                  <TouchableOpacity
                    style={styles.expandSectionHeader}
                    onPress={() => setSenderSectionExpanded((current) => !current)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.expandSectionTitleWrap}>
                      <Text style={styles.senderTrustTitle}>Review preferences</Text>
                      <Text style={styles.sectionEmptyText}>
                        {senderCards.length > 0
                          ? `${senderCards.filter((sender) => sender.sender_preference?.force_review || sender.level === 'noisy' || sender.level === 'mixed').length || senderCards.length} sender${(senderCards.filter((sender) => sender.sender_preference?.force_review || sender.level === 'noisy' || sender.level === 'mixed').length || senderCards.length) === 1 ? '' : 's'} currently stand out in your review flow.`
                          : 'Sender preferences will appear here once more Gmail review history builds up.'}
                      </Text>
                    </View>
                    <Ionicons
                      name={senderSectionExpanded ? 'chevron-up' : 'chevron-down'}
                      size={15}
                      color="#666"
                    />
                  </TouchableOpacity>
                  {senderCards.length > 0 ? (
                    <>
                      {collapsedSenderCards.map((sender) => (
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
                              ? ` · Line items ${formatSenderTrustLevel(sender.item_reliability.level).toLowerCase()}`
                              : ''}
                          </Text>
                          {Array.isArray(sender.top_changed_fields) && sender.top_changed_fields.length > 0 ? (
                            <Text style={styles.senderTrustDetail}>
                              Usually needs confirmation on: {sender.top_changed_fields.map((entry) => entry.field.replace(/_/g, ' ')).join(', ')}
                            </Text>
                          ) : null}
                          {Array.isArray(sender.top_dismiss_reasons) && sender.top_dismiss_reasons.length > 0 ? (
                            <Text style={styles.senderTrustDetail}>
                              Often dismissed as: {sender.top_dismiss_reasons.map((entry) => formatDismissReason(entry.reason)).join(', ')}
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
                      {senderSectionExpanded && senderCards.length > 3 ? (
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
            <View style={styles.logToggleRow}>
              <Text style={styles.sectionTitle}>AWAITING YOUR REVIEW</Text>
              {displayPendingReviewItems.length > 0 ? (
                <TouchableOpacity onPress={() => router.push('/review-queue')} activeOpacity={0.75}>
                  <Text style={styles.openQueueLink}>Open queue</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {displayPendingReviewItems.length === 0 ? (
              <Text style={styles.emptyText}>
                {pendingReviewError || 'No Gmail imports are currently waiting in your review queue.'}
              </Text>
            ) : (
              displayPendingReviewItems.slice(0, 3).map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.pendingRow}
                  activeOpacity={0.82}
                  onPress={() => router.push({
                    pathname: '/expense/[id]',
                    params: {
                      id: item.id,
                      expense: JSON.stringify(item),
                    },
                  })}
                >
                  <View style={styles.pendingRowMain}>
                    <Text style={styles.pendingMerchant} numberOfLines={1}>
                      {item.merchant || item.description || '(no merchant)'}
                    </Text>
                    <Text style={styles.pendingMeta} numberOfLines={1}>
                      {item.gmail_review_hint?.review_mode === 'quick_check'
                        ? 'Quick check'
                        : item.gmail_review_hint?.review_mode === 'items_first'
                          ? 'Items first'
                          : 'Review'}
                    </Text>
                  </View>
                  <View style={styles.pendingRowRight}>
                    <Text style={styles.pendingAmount}>${Number(item.amount || 0).toFixed(2)}</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

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
            {displayImportLog.some((entry) => entry.status === 'failed') ? (
              <TouchableOpacity
                style={[styles.inlineRetryBtn, retryingAllFailed && styles.actionBtnDisabled]}
                onPress={retryAllFailedImports}
                disabled={retryingAllFailed}
                activeOpacity={0.8}
              >
                <Text style={styles.inlineRetryBtnText}>
                  {retryingAllFailed ? 'Retrying failed imports...' : 'Retry failed imports'}
                </Text>
              </TouchableOpacity>
            ) : null}
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
                          {entry.expense_status === 'pending'
                            ? `Added to your review queue as ${formatLogStatus(entry)}`
                            : entry.expense_status === 'confirmed'
                              ? 'You already reviewed this import'
                              : entry.expense_status === 'dismissed'
                                ? 'You dismissed this import'
                                : entry.review_action
                                  ? `You ${formatLogStatus(entry)} this import`
                                  : `This import was ${formatLogStatus(entry)}`}
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
                      {entry.status === 'failed' ? (
                        <TouchableOpacity
                          style={styles.logRetryBtn}
                          onPress={() => retryFailedImport(entry.id)}
                          disabled={retryingFailedIds.includes(entry.id)}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.logRetryBtnText}>
                            {retryingFailedIds.includes(entry.id) ? 'Retrying...' : 'Retry'}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
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
  rowMetaAlert: { color: '#d97706', fontSize: 11, marginTop: 6, lineHeight: 16 },
  devPreviewNote: { color: '#8ab4ff', fontSize: 11, marginTop: 10, lineHeight: 16 },
  btnGroup: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionBtn: { backgroundColor: '#1a1a1a', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#2a2a2a', justifyContent: 'center' },
  actionBtnDisabled: { opacity: 0.4 },
  actionBtnText: { color: '#f5f5f5', fontSize: 13, fontWeight: '500' },
  loadingBlock: { alignSelf: 'flex-start', marginTop: 12 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  summaryCard: {
    width: '48%',
    minHeight: 78,
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: 'flex-start',
  },
  summaryLabel: { color: '#7a7a7a', fontSize: 11, fontWeight: '600', lineHeight: 14 },
  summaryValue: { color: '#f5f5f5', fontSize: 24, fontWeight: '600', marginTop: 10 },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  reasonChip: { borderRadius: 999, borderWidth: 1, borderColor: '#1f1f1f', backgroundColor: '#111', paddingHorizontal: 10, paddingVertical: 6 },
  reasonChipText: { color: '#777', fontSize: 11 },
  learningList: { gap: 10, marginTop: 4 },
  learningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  learningDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#8ab4ff', marginTop: 6 },
  learningText: { color: '#b8b8b8', fontSize: 12, lineHeight: 18, flex: 1 },
  templateList: { marginTop: 4, gap: 8 },
  templateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#141414',
  },
  templateRowMain: { flex: 1 },
  templateTitle: { color: '#d5d5d5', fontSize: 12, fontWeight: '600' },
  templateMeta: { color: '#666', fontSize: 11, marginTop: 3 },
  templateOutcome: { color: '#9ca3af', fontSize: 11, fontWeight: '600' },
  senderTrustSection: { marginTop: 14, gap: 10 },
  expandSectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  expandSectionTitleWrap: { flex: 1, gap: 4 },
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
  inlineRetryBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    backgroundColor: '#111',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inlineRetryBtnText: { color: '#b8b8b8', fontSize: 12, fontWeight: '600' },
  openQueueLink: { color: '#8ab4ff', fontSize: 12, fontWeight: '600' },
  pendingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
  },
  pendingRowMain: { flex: 1, marginRight: 12 },
  pendingMerchant: { color: '#f5f5f5', fontSize: 13, fontWeight: '500' },
  pendingMeta: { color: '#8ab4ff', fontSize: 11, marginTop: 4 },
  pendingRowRight: { alignItems: 'flex-end' },
  pendingAmount: { color: '#f5f5f5', fontSize: 13, fontWeight: '600' },
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
  logRetryBtn: { marginTop: 8, paddingHorizontal: 8, paddingVertical: 6 },
  logRetryBtnText: { color: '#8ab4ff', fontSize: 11, fontWeight: '600' },
  emptyText: { color: '#555', fontSize: 13, marginBottom: 12 },
});
