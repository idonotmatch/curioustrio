import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatTemplateLabel } from '../services/gmailImportPresentation';
import { EmptyState, LoadingState } from './ui/States';
import { StatusChip, statusToneForState } from './ui/StatusChip';
import { colors } from '../theme/tokens';
const { decodeHtmlEntities } = require('../services/text');

function logSubjectLabel(entry = {}) {
  const subject = decodeHtmlEntities(`${entry.subject || ''}`).trim();
  if (subject) return subject;
  const template = entry.subject_pattern && entry.subject_pattern !== 'unknown_subject'
    ? formatTemplateLabel(entry.subject_pattern)
    : null;
  const sender = entry.sender_domain && entry.sender_domain !== 'unknown'
    ? entry.sender_domain
    : null;
  if (template && sender) return `${template} · ${sender}`;
  if (template) return template;
  if (sender) return sender;
  return '(no subject)';
}

function logOutcomeText(entry = {}, formatLogDetail) {
  const detail = formatLogDetail(entry);
  if (detail) return detail;
  if (entry.skip_reason === 'classifier_uncertain') return 'Skipped because the email looked purchase-related but did not have a readable final total.';
  if (entry.skip_reason === 'missing_amount') return 'Skipped because no readable amount was found.';
  if (entry.skip_reason === 'duplicate_expense') return 'Skipped because it matched an existing expense.';
  if (`${entry.skip_reason || ''}`.startsWith('template_skip_')) return 'Filtered as a recurring non-charge email template.';
  if (entry.status === 'failed') return entry.skip_reason ? `Failed: ${entry.skip_reason}` : 'Import failed before this email could be processed.';
  return null;
}

export function GmailImportLogSection({
  styles,
  displayGmailStatus,
  importLogExpanded,
  toggleImportLog,
  displayImportLog,
  retryingAllFailed,
  retryAllFailedImports,
  importLogLoading,
  formatLogDetail,
  formatLogStatus,
  retryFailedImport,
  retryingFailedIds,
}) {
  if (!displayGmailStatus?.connected) return null;

  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.logToggleRow}
        onPress={toggleImportLog}
        activeOpacity={0.7}
      >
        <Text style={styles.sectionTitle}>IMPORT LOG</Text>
        <Ionicons name={importLogExpanded ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textDisabled} />
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
      {importLogExpanded ? (
        importLogLoading ? (
          <LoadingState compact label="Loading import history" style={styles.loadingBlock} />
        ) : displayImportLog.length === 0 ? (
          <EmptyState
            compact
            title="No import history yet"
            body="Run a Gmail sync to start building the import log."
            icon="mail-outline"
          />
        ) : (
          displayImportLog.map((entry) => (
            <View key={entry.id} style={styles.logRow}>
              <View style={styles.logRowLeft}>
                <Text style={styles.logSubject} numberOfLines={1}>
                  {logSubjectLabel(entry)}
                </Text>
                <Text style={styles.logFrom} numberOfLines={1}>
                  {entry.from_address || '—'}
                </Text>
                {logOutcomeText(entry, formatLogDetail) ? (
                  <Text style={styles.logDetail} numberOfLines={1}>
                    {logOutcomeText(entry, formatLogDetail)}
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
                <StatusChip label={formatLogStatus(entry)} tone={statusToneForState(formatLogStatus(entry))} />
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
      ) : null}
    </View>
  );
}
