import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MetricStrip } from './ui/MetricStrip';
import { InlineError, SectionHeader } from './ui/States';
import { colors } from '../theme/tokens';

export function GmailImportOverview({
  styles,
  displayGmailStatus,
  gmailStatusError,
  retryGmailStatus,
  isUsingMockData,
  connectGmail,
  disconnectGmail,
  disconnectingGmail,
  gmailSyncing,
  syncGmail,
  importSummaryLoading,
  displayImportSummary,
  syncStatusMessage,
  syncErrorMessage,
  reviewPathChips,
  importHealthMessage,
  learningExpanded,
  setLearningExpanded,
  collapsedLearningLine,
  learningLines,
  reasonChips,
  topDismissReasons,
  formatDismissReason,
  topTemplates,
  formatTemplateLabel,
  formatTemplateItemSignal,
  senderCards,
  senderSectionExpanded,
  setSenderSectionExpanded,
  collapsedSenderCards,
  senderTrustTone,
  formatSenderTrustLevel,
  formatSenderReviewPath,
  senderPolicyLabel,
  senderTrustExpanded,
  setSenderTrustExpanded,
  visibleSenderCards,
  summaryWindowDays,
}) {
  return (
    <View style={styles.section}>
      <SectionHeader
        eyebrow="Gmail"
        title="Import control"
        body="Connection, sync state, review volume, and sender learning."
      />
      <View style={styles.row}>
        <View style={styles.rowInfo}>
          <Text style={styles.rowTitle}>Gmail import</Text>
          <Text style={styles.rowSub}>
            {displayGmailStatus == null
              ? (gmailStatusError ? 'Status unavailable' : 'Checking connection…')
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
          {displayGmailStatus?.connected && !isUsingMockData ? (
            <TouchableOpacity
              style={styles.inlineDangerLink}
              onPress={disconnectGmail}
              disabled={disconnectingGmail}
              activeOpacity={0.82}
            >
              <Text style={styles.inlineDangerLinkText}>
                {disconnectingGmail ? 'Disconnecting…' : 'Disconnect Gmail'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {displayGmailStatus != null ? <View style={styles.btnGroup}>
          {displayGmailStatus?.connected && !isUsingMockData ? (
            <TouchableOpacity
              style={[styles.actionBtn, gmailSyncing && styles.actionBtnDisabled]}
              onPress={syncGmail}
              disabled={gmailSyncing}
            >
              <Text style={styles.actionBtnText}>{gmailSyncing ? 'Syncing…' : 'Sync'}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.actionBtn, isUsingMockData && styles.actionBtnDisabled]}
            onPress={connectGmail}
            disabled={isUsingMockData}
          >
            <Text style={styles.actionBtnText}>
              {displayGmailStatus?.connected ? 'Reconnect' : 'Connect'}
            </Text>
          </TouchableOpacity>
        </View> : null}
      </View>
      {gmailStatusError ? (
        <InlineError
          title="Could not check Gmail"
          body={gmailStatusError}
          actionLabel="Try again"
          onAction={retryGmailStatus}
          style={{ marginTop: 12 }}
        />
      ) : null}
      {isUsingMockData ? (
        <Text style={styles.devPreviewNote}>
          Dev preview data is filling this screen until a real Gmail connection is available.
        </Text>
      ) : null}
      {displayGmailStatus?.connected ? (
        importSummaryLoading ? (
          <ActivityIndicator color={colors.textDisabled} style={styles.loadingBlock} />
        ) : displayImportSummary ? (
          <>
            <MetricStrip
              items={[
                { label: 'Imported', value: displayImportSummary.imported },
                { label: 'Awaiting review', value: displayImportSummary.current_pending_review ?? displayImportSummary.imported_pending_review },
                { label: 'Approved cleanly', value: displayImportSummary.approved_without_changes ?? 0 },
                { label: 'Filtered out', value: displayImportSummary.skipped },
              ]}
              style={styles.summaryGrid}
            />
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
                  color={colors.textDisabled}
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
                      {reasonChips.slice(0, 3).map((item) => (
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
                              {[
                                template.sender_domain,
                                `${template.total} seen`,
                                formatTemplateItemSignal(template) || template.learned_disposition || 'unknown',
                              ].filter(Boolean).join(' · ')}
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
                  color={colors.textDisabled}
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
                        color={colors.textSubtle}
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
            <Text style={styles.summaryWindow}>Last {summaryWindowDays} days</Text>
          </>
        ) : null
      ) : null}
    </View>
  );
}
