import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { EmptyState, InlineError, LoadingState } from './ui/States';
import { colors } from '../theme/tokens';
const { importHistoryTitle, importHistoryReason, importRecoveryMessage } = require('../services/importRecoveryPresentation');
const { decodeHtmlEntities } = require('../services/text');

const FILTERS = [{ key: 'potential', label: 'Potential' }, { key: 'skipped', label: 'All skipped' }, { key: 'failed', label: 'Errors' }, { key: 'imported', label: 'Imported' }];

export function SkippedImportsList({ onRecovered, isUsingMockData = false }) {
  const [filter, setFilter] = useState('potential');
  const [entries, setEntries] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [context, setContext] = useState(null);
  const [contextError, setContextError] = useState('');
  const [contextLoading, setContextLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const listRequest = useRef(0);
  const contextRequest = useRef(0);
  const busy = useRef(false);
  const actionBusy = useRef(false);

  async function load(nextCursor = null, replaceRequest = false) {
    if (busy.current && !replaceRequest) return;
    busy.current = true;
    const request = ++listRequest.current;
    setLoading(true);
    setLoadingMore(!!nextCursor);
    setError('');
    try {
      const result = isUsingMockData ? { entries: [], next_cursor: null }
        : await api.get(`/gmail/review-history?filter=${filter}${nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ''}`);
      if (request !== listRequest.current) return;
      setEntries((previous) => nextCursor
        ? [...previous, ...result.entries.filter((entry) => !previous.some((item) => item.id === entry.id))]
        : result.entries);
      setCursor(result.next_cursor);
    } catch (err) {
      if (request === listRequest.current) setError(err.message || 'Could not load import history.');
    } finally {
      if (request === listRequest.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    busy.current = false;
    setEntries([]);
    setCursor(null);
    load();
    return () => { listRequest.current += 1; };
  }, [filter, isUsingMockData]);

  useEffect(() => () => { contextRequest.current += 1; }, []);

  async function openEntry(entry) {
    const request = ++contextRequest.current;
    setSelected(entry);
    setDetailsVisible(true);
    setContext(null);
    setContextError('');
    setContextLoading(true);
    try {
      const value = await api.get(`/gmail/import-log/${entry.id}/context`);
      if (request === contextRequest.current) setContext(value);
    } catch (err) {
      if (request === contextRequest.current) setContextError(err.message || 'Could not load email details.');
    } finally {
      if (request === contextRequest.current) setContextLoading(false);
    }
  }

  function closeEntry() {
    if (actionBusy.current) return;
    contextRequest.current += 1;
    setDetailsVisible(false);
  }

  async function recover() {
    if (!selected || actionBusy.current) return;
    actionBusy.current = true;
    setRecovering(true);
    try {
      const result = await api.post(`/gmail/import-log/${selected.id}/review`, {});
      contextRequest.current += 1;
      setDetailsVisible(false);
      load(null, true);
      if (result.imported > 0 || result.reason === 'existing') onRecovered();
      Alert.alert(result.imported > 0 ? 'Ready for review' : 'Import result', importRecoveryMessage(result));
    } catch (err) {
      Alert.alert('Could not process email', err.message || 'Try again later.');
    } finally {
      actionBusy.current = false;
      setRecovering(false);
    }
  }

  const canRecover = selected && ['skipped', 'failed'].includes(selected.status) && selected.skip_reason !== 'existing' && !selected.expense_id;
  return (
    <View style={styles.container}>
      <View style={styles.filters} accessibilityRole="tablist">
        {FILTERS.map((option) => (
          <Pressable key={option.key} accessibilityRole="tab" accessibilityState={{ selected: filter === option.key }}
            onPress={() => setFilter(option.key)} style={[styles.filter, filter === option.key && styles.activeFilter]}>
            <Text style={[styles.filterText, filter === option.key && styles.activeText]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading && !loadingMore && entries.length > 0} onRefresh={() => load()} tintColor={colors.text} />}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" accessibilityLabel={`View email: ${importHistoryTitle(item)}`}
            onPress={() => openEntry(item)} style={styles.row}>
            <View style={styles.rowContent}>
              <Text style={styles.subject} numberOfLines={2}>{importHistoryTitle(item)}</Text>
              <Text style={styles.meta} numberOfLines={1}>{item.from_address || item.sender_domain || 'Sender unavailable'}</Text>
              <Text style={styles.reason}>{importHistoryReason(item)}</Text>
              <Text style={styles.date}>Processed {new Date(item.imported_at).toLocaleDateString()}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
          </Pressable>
        )}
        ListEmptyComponent={loading ? (
          <LoadingState label="Loading import history" style={styles.stateBlock} />
        ) : error ? (
          <InlineError title="Could not load import history" body={error} actionLabel="Try again" onAction={() => load()} style={styles.stateBlock} />
        ) : (
          <EmptyState
            icon="mail-open-outline"
            title={filter === 'potential' ? 'No missed expenses found' : `No ${filter === 'failed' ? 'errors' : filter} to show`}
            body={isUsingMockData ? 'Import history is unavailable in preview mode.' : filter === 'potential' ? 'Adlo did not find any potentially missed expenses in retained history.' : 'Try another import-history filter.'}
            style={styles.stateBlock}
          />
        )}
        ListFooterComponent={(
          <View style={styles.footer}>
            {entries.length > 0 && error ? <Text style={styles.error}>{error}</Text> : null}
            {loadingMore ? <ActivityIndicator color={colors.text} /> : entries.length > 0 && (cursor || error) ? (
              <Pressable accessibilityRole="button" onPress={() => load(cursor)} style={styles.button}>
                <Ionicons name={error ? 'refresh' : 'chevron-down'} size={18} color={colors.text} />
                <Text style={styles.buttonText}>{error ? 'Try again' : 'Load more'}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      />
      <Modal visible={detailsVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeEntry}
        onDismiss={() => { if (!detailsVisible) { setSelected(null); setContext(null); } }}>
        <SafeAreaView style={styles.container}>
          <View style={styles.modalHeader}>
            <Text style={styles.heading}>Email details</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close email details" disabled={recovering} onPress={closeEntry} style={styles.iconButton}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.details}>
            <Text style={styles.subject}>{importHistoryTitle(context || selected || {})}</Text>
            <Text selectable style={styles.meta}>{context?.from_address || selected?.from_address || selected?.sender_domain || 'Sender unavailable'}</Text>
            {context?.received_at ? <Text style={styles.meta}>Received {context.received_at}</Text> : null}
            <Text style={styles.reason}>{importHistoryReason(selected || {})}</Text>
            {selected?.amount != null ? <Text style={styles.subject}>Amount: {Number(selected.amount).toFixed(2)}</Text> : null}
            {contextLoading ? <ActivityIndicator color={colors.text} /> : null}
            {context?.snippet ? <Text selectable style={styles.snippet}>{decodeHtmlEntities(context.snippet)}</Text> : null}
            {contextError ? (
              <View style={styles.footer}>
                <Text style={styles.error}>{contextError}</Text>
                <Pressable accessibilityRole="button" onPress={() => openEntry(selected)} style={styles.button}>
                  <Ionicons name="refresh" size={18} color={colors.text} /><Text style={styles.buttonText}>Retry email details</Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
          {canRecover ? (
            <View style={styles.actionBar}>
              <Pressable accessibilityRole="button" accessibilityState={{ busy: recovering, disabled: recovering }} disabled={recovering}
                accessibilityLabel={recovering ? 'Processing email' : selected.status === 'failed' ? 'Retry import' : 'Review this'}
                onPress={recover} style={[styles.button, styles.recoverButton, recovering && styles.disabled]}>
                {recovering ? <ActivityIndicator color={colors.text} /> : <Ionicons name={selected.status === 'failed' ? 'refresh' : 'add-circle-outline'} size={20} color={colors.text} />}
                <Text style={styles.buttonText}>{recovering ? 'Processing email...' : selected.status === 'failed' ? 'Retry import' : 'Review this'}</Text>
              </Pressable>
            </View>
          ) : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  filters: { flexDirection: 'row', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  filter: { flex: 1, minHeight: 52, paddingHorizontal: 4, paddingVertical: 10, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeFilter: { borderBottomColor: colors.success },
  filterText: { color: colors.textSubtle, fontSize: 13, textAlign: 'center' },
  activeText: { color: colors.text, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  rowContent: { flex: 1, minWidth: 0, gap: 5 },
  subject: { color: colors.text, fontSize: 16, lineHeight: 23, fontWeight: '600' },
  meta: { color: colors.textSubtle, fontSize: 13, lineHeight: 19 },
  reason: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  date: { color: colors.textSubtle, fontSize: 12 },
  empty: { color: colors.textSubtle, textAlign: 'center', paddingVertical: 40, lineHeight: 22 },
  stateBlock: { marginTop: 20 },
  footer: { gap: 12, paddingVertical: 20, alignItems: 'center' },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  button: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  modalHeader: { paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { color: colors.text, fontSize: 20, fontWeight: '600', flexShrink: 1 },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  details: { padding: 20, gap: 14 },
  snippet: { color: colors.text, fontSize: 15, lineHeight: 23 },
  actionBar: { padding: 16, borderTopWidth: 1, borderTopColor: colors.border },
  recoverButton: { borderRadius: 8, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong },
  disabled: { opacity: 0.6 },
});
