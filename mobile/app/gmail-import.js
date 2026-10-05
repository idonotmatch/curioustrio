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
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { invalidateExpenseMutationCaches } from '../services/expenseMutationEffects';
import { FRESHNESS_DOMAINS } from '../services/freshnessRegistry';
import { useFreshnessRefresh } from '../hooks/useFreshnessRefresh';
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
import { colors } from '../theme/tokens';
const { startGmailConnectFlow } = require('../services/gmailAuthFlow');

const SUMMARY_WINDOW_DAYS = 90;
const FORCE_MOCK_GMAIL_IMPORT_PREVIEW = false;

const MOCK_GMAIL_IMPORT_STATE = buildMockGmailImportState();

export default function GmailImportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [gmailStatus, setGmailStatus] = useState(null);
  const [gmailStatusError, setGmailStatusError] = useState('');
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
  const [disconnectingGmail, setDisconnectingGmail] = useState(false);
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
      setGmailStatusError('');
    } catch (error) {
      setGmailStatus(null);
      setGmailStatusError(error?.message || 'Could not check the Gmail connection.');
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
      const { completed } = await startGmailConnectFlow();
      if (completed) {
        await Promise.all([loadGmailStatus(), loadImportSummary(), loadPendingQueue()]);
      }
    } catch (e) {
      Alert.alert('Gmail', e?.message || 'Could not start Gmail connection');
    }
  }

  async function disconnectGmail() {
    Alert.alert(
      'Disconnect Gmail',
      'Adlo will stop syncing new email receipts and remove the current Gmail connection from this account.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setDisconnectingGmail(true);
            try {
              await api.delete('/gmail/connection');
              await invalidateExpenseMutationCaches();
              setImportSummary(null);
              setImportLog([]);
              setPendingReviewItems([]);
              setPendingReviewError(null);
              setImportLogExpanded(false);
              await loadGmailStatus();
              Alert.alert('Gmail disconnected', 'You can reconnect Gmail anytime from this screen.');
            } catch (e) {
              Alert.alert('Could not disconnect Gmail', e?.message || 'Please try again.');
            } finally {
              setDisconnectingGmail(false);
            }
          },
        },
      ]
    );
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
      const result = await api.post('/gmail/import', { source: 'manual' });
      await invalidateExpenseMutationCaches();
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
      await invalidateExpenseMutationCaches();
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
      await invalidateExpenseMutationCaches();
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

  useFreshnessRefresh(FRESHNESS_DOMAINS.gmailImport, () => {
    loadImportSummary();
    loadPendingQueue();
    if (importLogExpanded) loadImportLog();
  }, { delayMs: 700 });

  return (
    <>
      <Stack.Screen options={{ title: 'Gmail Import' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {params.welcome === 'connect' ? (
          <View style={styles.welcomeCard}>
            <Text style={styles.welcomeEyebrow}>Good first move</Text>
            <Text style={styles.welcomeTitle}>Bring in receipts instead of retyping them.</Text>
            <Text style={styles.welcomeBody}>
              Gmail import works best once you trust the connection. You can always start manually and come back to this later.
            </Text>
          </View>
        ) : null}

        <GmailImportOverview
          styles={styles}
          displayGmailStatus={displayGmailStatus}
          gmailStatusError={gmailStatusError}
          retryGmailStatus={loadGmailStatus}
          isUsingMockData={isUsingMockData}
          connectGmail={connectGmail}
          disconnectGmail={disconnectGmail}
          disconnectingGmail={disconnectingGmail}
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

        <GmailPendingReviewSection
          styles={styles}
          displayGmailStatus={displayGmailStatus}
          displayPendingReviewItems={displayPendingReviewItems}
          pendingReviewError={pendingReviewError}
          retryPendingReview={loadPendingQueue}
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
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 48 },
  welcomeCard: {
    marginBottom: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  welcomeEyebrow: {
    color: colors.textSubtle,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  welcomeTitle: { color: colors.text, fontSize: 21, fontWeight: '700', marginBottom: 8, lineHeight: 28 },
  welcomeBody: { color: colors.textSubtle, fontSize: 14, lineHeight: 20 },
  section: { marginBottom: 32, borderBottomWidth: 1, borderBottomColor: colors.surface, paddingBottom: 24 },
  sectionTitle: { fontSize: 10, color: colors.textDisabled, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowInfo: { flex: 1, marginRight: 12 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '500' },
  rowSub: { color: colors.textDisabled, fontSize: 12, marginTop: 2 },
  rowMetaAlert: { color: colors.warning, fontSize: 11, marginTop: 6, lineHeight: 16 },
  devPreviewNote: { color: colors.info, fontSize: 11, marginTop: 10, lineHeight: 16 },
  btnGroup: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionBtn: { backgroundColor: colors.borderSubtle, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.borderStrong, justifyContent: 'center' },
  actionBtnDisabled: { opacity: 0.4 },
  actionBtnText: { color: colors.text, fontSize: 13, fontWeight: '500' },
  inlineDangerLink: { marginTop: 10, alignSelf: 'flex-start' },
  inlineDangerLinkText: { color: colors.danger, fontSize: 12, fontWeight: '600' },
  loadingBlock: { alignSelf: 'flex-start', marginTop: 12 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  summaryCard: {
    width: '48%',
    minHeight: 78,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: 'flex-start',
  },
  summaryLabel: { color: colors.textSubtle, fontSize: 11, fontWeight: '600', lineHeight: 14 },
  summaryValue: { color: colors.text, fontSize: 24, fontWeight: '600', marginTop: 10 },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  reasonChip: { borderRadius: 999, borderWidth: 1, borderColor: colors.textInverse, backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 6 },
  reasonChipText: { color: colors.textDisabled, fontSize: 11 },
  learningList: { gap: 10, marginTop: 4 },
  learningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  learningDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginTop: 6 },
  learningText: { color: colors.textMuted, fontSize: 12, lineHeight: 18, flex: 1 },
  templateList: { marginTop: 4, gap: 8 },
  templateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceRaised,
  },
  templateRowMain: { flex: 1 },
  templateTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  templateMeta: { color: colors.textDisabled, fontSize: 11, marginTop: 3 },
  templateOutcome: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  senderTrustSection: { marginTop: 14, gap: 10 },
  expandSectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  expandSectionTitleWrap: { flex: 1, gap: 4 },
  senderTrustHeader: { gap: 3 },
  senderTrustTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
  senderTrustSub: { color: colors.textDisabled, fontSize: 11 },
  sectionEmptyText: { color: colors.textDisabled, fontSize: 12, lineHeight: 18 },
  senderTrustCard: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.borderSubtle, padding: 12 },
  senderTrustTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  senderTrustDomain: { color: colors.text, fontSize: 13, fontWeight: '500', flex: 1 },
  senderTrustChip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  senderTrustChipTrusted: { backgroundColor: colors.successMuted },
  senderTrustChipMixed: { backgroundColor: colors.warningMuted },
  senderTrustChipNoisy: { backgroundColor: colors.dangerMuted },
  senderTrustChipUnknown: { backgroundColor: colors.infoMuted },
  senderTrustChipText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  senderTrustMeta: { color: colors.textDisabled, fontSize: 11, marginTop: 6 },
  senderTrustDetail: { color: colors.textDisabled, fontSize: 11, marginTop: 4, lineHeight: 16 },
  senderTrustPolicy: { color: colors.info, fontSize: 11, marginTop: 8, fontWeight: '600' },
  senderTrustPolicyStrong: { color: colors.warning },
  expandToggle: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.textInverse,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  expandToggleText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  summaryWindow: { color: colors.textDisabled, fontSize: 11, marginTop: 10 },
  logToggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  inlineRetryBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.textInverse,
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inlineRetryBtnText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  openQueueLink: { color: colors.info, fontSize: 12, fontWeight: '600' },
  pendingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  pendingRowMain: { flex: 1, marginRight: 12 },
  pendingMerchant: { color: colors.text, fontSize: 13, fontWeight: '500' },
  pendingMeta: { color: colors.info, fontSize: 11, marginTop: 4 },
  pendingRowRight: { alignItems: 'flex-end' },
  pendingAmount: { color: colors.text, fontSize: 13, fontWeight: '600' },
  logRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.surface },
  logRowLeft: { flex: 1, marginRight: 12 },
  logSubject: { color: colors.text, fontSize: 13 },
  logFrom: { color: colors.textDisabled, fontSize: 11, marginTop: 2 },
  logDetail: { color: colors.textDisabled, fontSize: 11, marginTop: 4 },
  logContext: { color: colors.info, fontSize: 11, marginTop: 6 },
  logRowRight: { alignItems: 'flex-end' },
  logStatus: { fontSize: 11, color: colors.textSubtle, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  logStatusImported: { color: colors.success },
  logStatusFailed: { color: colors.danger },
  logDate: { color: colors.textDisabled, fontSize: 11, marginTop: 2 },
  logRetryBtn: { marginTop: 8, paddingHorizontal: 8, paddingVertical: 6 },
  logRetryBtnText: { color: colors.info, fontSize: 11, fontWeight: '600' },
  emptyText: { color: colors.textDisabled, fontSize: 13, marginBottom: 12 },
});
