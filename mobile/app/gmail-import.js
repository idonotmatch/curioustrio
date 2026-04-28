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
import { GmailImportOverview } from '../components/GmailImportOverview';
import { GmailPendingReviewSection } from '../components/GmailPendingReviewSection';
import { GmailImportLogSection } from '../components/GmailImportLogSection';
import {
  reviewModeCountChips,
  summarizeReasonChips,
  formatLogStatus,
  formatLogDetail,
  formatRelativeTime,
  formatSenderTrustLevel,
  formatSenderReviewPath,
  senderPolicyLabel,
  formatDismissReason,
  formatTemplateLabel,
  formatTemplateItemSignal,
  rankSenderCard,
  learningSummaryLines,
  importHealthMessage,
  syncStatusMessage,
  syncErrorMessage,
} from '../services/gmailImportPresentation';
import { buildMockGmailImportState, buildMockPendingExpenses } from '../fixtures/mockGmailImport';

const SUMMARY_WINDOW_DAYS = 90;
const FORCE_MOCK_GMAIL_IMPORT_PREVIEW = false;
const DEBUG_REPROCESS_MESSAGE_ID = '19dd13aa1784b85f';

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
  const [reprocessingDebugMessage, setReprocessingDebugMessage] = useState(false);
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

  function senderTrustTone(level) {
    switch (level) {
      case 'trusted': return styles.senderTrustChipTrusted;
      case 'mixed': return styles.senderTrustChipMixed;
      case 'noisy': return styles.senderTrustChipNoisy;
      default: return styles.senderTrustChipUnknown;
    }
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
      const data = await api.get('/gmail/import-log?limit=50&detail=compact');
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

  async function reprocessDebugMessage() {
    setReprocessingDebugMessage(true);
    try {
      const result = await api.post(`/gmail/message/${DEBUG_REPROCESS_MESSAGE_ID}/reprocess`, {});
      await invalidateCache('cache:expenses:pending');
      await Promise.all([loadImportLog(), loadImportSummary(), loadGmailStatus(), loadPendingQueue()]);
      Alert.alert(
        'Email reprocessed',
        result?.expense?.id
          ? 'The email was re-run and the pending expense was rebuilt.'
          : 'The email was re-run.'
      );
    } catch (e) {
      Alert.alert('Reprocess failed', e?.message || 'Could not reprocess this email');
    } finally {
      setReprocessingDebugMessage(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Gmail Import' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <GmailImportOverview
          styles={styles}
          displayGmailStatus={displayGmailStatus}
          isUsingMockData={isUsingMockData}
          connectGmail={connectGmail}
          gmailSyncing={gmailSyncing}
          syncGmail={syncGmail}
          importSummaryLoading={importSummaryLoading}
          displayImportSummary={displayImportSummary}
          syncStatusMessage={syncStatusMessage}
          syncErrorMessage={syncErrorMessage}
          reviewPathChips={reviewPathChips}
          importHealthMessage={importHealthMessage}
          learningExpanded={learningExpanded}
          setLearningExpanded={setLearningExpanded}
          collapsedLearningLine={collapsedLearningLine}
          learningLines={learningLines}
          reasonChips={reasonChips}
          topDismissReasons={topDismissReasons}
          formatDismissReason={formatDismissReason}
          topTemplates={topTemplates}
          formatTemplateLabel={formatTemplateLabel}
          formatTemplateItemSignal={formatTemplateItemSignal}
          senderCards={senderCards}
          senderSectionExpanded={senderSectionExpanded}
          setSenderSectionExpanded={setSenderSectionExpanded}
          collapsedSenderCards={collapsedSenderCards}
          senderTrustTone={senderTrustTone}
          formatSenderTrustLevel={formatSenderTrustLevel}
          formatSenderReviewPath={formatSenderReviewPath}
          senderPolicyLabel={senderPolicyLabel}
          senderTrustExpanded={senderTrustExpanded}
          setSenderTrustExpanded={setSenderTrustExpanded}
          visibleSenderCards={visibleSenderCards}
          summaryWindowDays={displayImportSummary?.window_days || SUMMARY_WINDOW_DAYS}
        />

        {__DEV__ ? (
          <View style={styles.debugCard}>
            <Text style={styles.debugEyebrow}>Debug</Text>
            <Text style={styles.debugTitle}>Reprocess a specific Gmail message</Text>
            <Text style={styles.debugBody}>{DEBUG_REPROCESS_MESSAGE_ID}</Text>
            <TouchableOpacity
              style={[styles.actionBtn, reprocessingDebugMessage && styles.actionBtnDisabled]}
              onPress={reprocessDebugMessage}
              disabled={reprocessingDebugMessage}
              activeOpacity={0.82}
            >
              <Text style={styles.actionBtnText}>
                {reprocessingDebugMessage ? 'Reprocessing...' : 'Reprocess email'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <GmailPendingReviewSection
          styles={styles}
          displayGmailStatus={displayGmailStatus}
          displayPendingReviewItems={displayPendingReviewItems}
          pendingReviewError={pendingReviewError}
          openReviewQueue={() => router.push('/review-queue')}
          openExpenseReview={(item) => router.push({
            pathname: '/expense/[id]',
            params: {
              id: item.id,
              expense: JSON.stringify(item),
            },
          })}
        />

        <GmailImportLogSection
          styles={styles}
          displayGmailStatus={displayGmailStatus}
          importLogExpanded={importLogExpanded}
          toggleImportLog={() => {
            const next = !importLogExpanded;
            setImportLogExpanded(next);
            if (next && importLog.length === 0 && !isUsingMockData) loadImportLog();
          }}
          displayImportLog={displayImportLog}
          retryingAllFailed={retryingAllFailed}
          retryAllFailedImports={retryAllFailedImports}
          importLogLoading={importLogLoading}
          formatLogDetail={formatLogDetail}
          formatLogStatus={formatLogStatus}
          retryFailedImport={retryFailedImport}
          retryingFailedIds={retryingFailedIds}
        />
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
  debugCard: {
    marginBottom: 24,
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 14,
    gap: 10,
  },
  debugEyebrow: { color: '#8ab4ff', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  debugTitle: { color: '#f5f5f5', fontSize: 14, fontWeight: '600' },
  debugBody: { color: '#9aa5b1', fontSize: 12, lineHeight: 18 },
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
