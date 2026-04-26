import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
const { decodeHtmlEntities } = require('../services/text');

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
      {importLogExpanded ? (
        importLogLoading ? (
          <ActivityIndicator color="#555" style={styles.loadingBlock} />
        ) : displayImportLog.length === 0 ? (
          <Text style={styles.emptyText}>No import history yet.</Text>
        ) : (
          displayImportLog.map((entry) => (
            <View key={entry.id} style={styles.logRow}>
              <View style={styles.logRowLeft}>
                <Text style={styles.logSubject} numberOfLines={1}>
                  {decodeHtmlEntities(`${entry.subject || ''}`).trim() || '(no subject)'}
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
      ) : null}
    </View>
  );
}
