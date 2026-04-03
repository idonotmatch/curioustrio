import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  TextInput, Alert, ScrollView, Share,
} from 'react-native';
import { Stack } from 'expo-router';
import { signOut } from '../lib/auth';
import { supabase } from '../lib/supabase';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';

export default function AccountsScreen() {
  const [currentUserEmail, setCurrentUserEmail] = useState(null);
  const [gmailStatus, setGmailStatus] = useState(null);
  const [signingOut, setSigningOut] = useState(false);

  const [householdData, setHouseholdData] = useState(null);
  const [householdLoading, setHouseholdLoading] = useState(true);

  // Household name editing
  const [editingName, setEditingName] = useState(false);
  const [householdNameInput, setHouseholdNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [newHouseholdName, setNewHouseholdName] = useState('');
  const [creatingHousehold, setCreatingHousehold] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [generatedInvite, setGeneratedInvite] = useState(null); // { token, email, expiresAt }
  const [joinToken, setJoinToken] = useState('');
  const [joiningHousehold, setJoiningHousehold] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState(null);
  const [leavingHousehold, setLeavingHousehold] = useState(false);

  const loadGmailStatus = useCallback(async () => {
    try {
      const data = await api.get('/gmail/status');
      setGmailStatus(data);
    } catch {
      setGmailStatus(null);
    }
  }, []);

  const loadHousehold = useCallback(async () => {
    setHouseholdLoading(true);
    try {
      const data = await api.get('/households/me');
      setHouseholdData(data);
      setHouseholdNameInput(data.household?.name || '');
    } catch {
      setHouseholdData('none');
    } finally {
      setHouseholdLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGmailStatus();
    loadHousehold();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUserEmail(session?.user?.email ?? null);
    });
  }, [loadGmailStatus, loadHousehold]);

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

  function formatImportReason(reason) {
    return getImportReasonMeta(reason).label;
  }

  function formatLogStatus(entry) {
    if (entry.status === 'imported' && /needs review/i.test(entry.notes || '')) return 'needs review';
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

  const [importLog, setImportLog] = useState([]);
  const [importSummary, setImportSummary] = useState(null);
  const [importLogExpanded, setImportLogExpanded] = useState(false);
  const [importLogLoading, setImportLogLoading] = useState(false);
  const [importSummaryLoading, setImportSummaryLoading] = useState(false);

  async function loadImportLog() {
    setImportLogLoading(true);
    try {
      const data = await api.get('/gmail/import-log?limit=50');
      setImportLog(data);
    } catch { /* non-fatal */ } finally {
      setImportLogLoading(false);
    }
  }

  async function loadImportSummary() {
    setImportSummaryLoading(true);
    try {
      const data = await api.get('/gmail/import-summary?days=30');
      setImportSummary(data);
    } catch {
      setImportSummary(null);
    } finally {
      setImportSummaryLoading(false);
    }
  }

  const [gmailSyncing, setGmailSyncing] = useState(false);
  async function syncGmail() {
    setGmailSyncing(true);
    try {
      const result = await api.post('/gmail/import', {});
      await Promise.all([loadImportLog(), loadImportSummary()]);
      const pendingReview = result?.outcomes?.imported_pending_review ?? 0;
      Alert.alert(
        'Gmail sync',
        `Imported ${result.imported ?? 0}, skipped ${result.skipped ?? 0}${result.failed ? `, failed ${result.failed}` : ''}${pendingReview ? `, ${pendingReview} need review` : ''}`
      );
    } catch (e) {
      Alert.alert('Gmail sync failed', e?.message || 'Something went wrong');
    } finally {
      setGmailSyncing(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try { await signOut(); } catch { setSigningOut(false); }
  }

  async function saveHouseholdName() {
    if (!householdNameInput.trim()) return;
    setSavingName(true);
    try {
      await api.patch('/households/me', { name: householdNameInput.trim() });
      setHouseholdData(prev => ({
        ...prev,
        household: { ...prev.household, name: householdNameInput.trim() },
      }));
      setEditingName(false);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSavingName(false);
    }
  }

  async function createHousehold() {
    if (!newHouseholdName.trim()) return;
    setCreatingHousehold(true);
    try {
      await api.post('/households', { name: newHouseholdName.trim() });
      setNewHouseholdName('');
      loadHousehold();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setCreatingHousehold(false);
    }
  }

  async function removeMember(memberId) {
    Alert.alert(
      'Remove member',
      'This person will lose access to household expenses.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (removingMemberId === memberId) return;
            setRemovingMemberId(memberId);
            try {
              await api.delete(`/households/me/members/${memberId}`);
              loadHousehold();
            } catch (e) {
              Alert.alert('Could not remove member', e.message || 'Please try again.');
            } finally {
              setRemovingMemberId(null);
            }
          },
        },
      ]
    );
  }

  async function leaveHousehold() {
    Alert.alert(
      'Leave household',
      'You will lose access to shared expenses. Your own expenses are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            if (leavingHousehold) return;
            setLeavingHousehold(true);
            try {
              await api.post('/households/me/leave', {});
              loadHousehold();
            } catch (e) {
              Alert.alert('Could not leave household', e.message || 'Please try again.');
            } finally {
              setLeavingHousehold(false);
            }
          },
        },
      ]
    );
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) return;
    setSendingInvite(true);
    try {
      const email = inviteEmail.trim().toLowerCase();
      const result = await api.post('/households/invites', { email });
      setInviteEmail('');
      setGeneratedInvite({ token: result.token, email, expiresAt: result.expires_at });
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSendingInvite(false);
    }
  }

  async function shareInvite() {
    if (!generatedInvite) return;
    const householdName = householdData?.household?.name || 'my household';
    await Share.share({
      message: `Join ${householdName} on Adlo!\n\nEnter this invite code in Settings → Manage Accounts → Join with invite token:\n\n${generatedInvite.token}\n\nExpires in 7 days. You must accept with ${generatedInvite.email}.`,
    });
  }

  async function joinHousehold() {
    if (!joinToken.trim()) return;
    setJoiningHousehold(true);
    try {
      await api.post(`/households/invites/${joinToken.trim()}/accept`, {});
      setJoinToken('');
      loadHousehold();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setJoiningHousehold(false);
    }
  }

  const currentMember = (householdData?.members || []).find(
    m => m.email === currentUserEmail
  );
  const currentUserId = currentMember?.id;

  return (
    <>
      <Stack.Screen options={{ title: 'Accounts' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>

        {/* Household */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>HOUSEHOLD</Text>
          {householdLoading ? (
            <ActivityIndicator color="#555" style={{ alignSelf: 'flex-start' }} />
          ) : householdData && householdData !== 'none' ? (
            <>
              {/* Household name — inline editable */}
              {editingName ? (
                <View style={styles.nameEditRow}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    value={householdNameInput}
                    onChangeText={setHouseholdNameInput}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={saveHouseholdName}
                  />
                  <TouchableOpacity
                    style={[styles.nameEditBtn, savingName && { opacity: 0.5 }]}
                    onPress={saveHouseholdName}
                    disabled={savingName}
                  >
                    {savingName
                      ? <ActivityIndicator color="#000" size="small" />
                      : <Text style={styles.nameEditBtnText}>Save</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.nameCancelBtn} onPress={() => {
                    setHouseholdNameInput(householdData.household?.name || '');
                    setEditingName(false);
                  }}>
                    <Ionicons name="close" size={18} color="#555" />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.nameRow} onPress={() => setEditingName(true)}>
                  <Text style={styles.householdName}>{householdData.household?.name}</Text>
                  <Ionicons name="pencil-outline" size={14} color="#555" style={{ marginLeft: 8 }} />
                </TouchableOpacity>
              )}

              <Text style={styles.subLabel}>Members</Text>
              {(householdData.members || []).map(m => (
                <View key={m.id} style={styles.memberRow}>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{m.name || m.email}</Text>
                    {m.email ? <Text style={styles.memberEmail}>{m.email}</Text> : null}
                  </View>
                  {currentUserId != null && m.id !== currentUserId && (
                    <TouchableOpacity
                      onPress={() => removeMember(m.id)}
                      disabled={removingMemberId === m.id}
                      style={{ paddingVertical: 8, paddingHorizontal: 4 }}
                    >
                      {removingMemberId === m.id
                        ? <ActivityIndicator size="small" color="#ef4444" />
                        : <Text style={styles.removeText}>Remove</Text>}
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              <Text style={styles.subLabel}>Invite someone</Text>
              {generatedInvite ? (
                <View style={styles.tokenCard}>
                  <Text style={styles.tokenLabel}>Invite code for {generatedInvite.email}</Text>
                  <Text style={styles.tokenValue} selectable>{generatedInvite.token}</Text>
                  <Text style={styles.tokenExpiry}>
                    Expires {new Date(generatedInvite.expiresAt).toLocaleDateString()} · single use
                  </Text>
                  <View style={styles.tokenActions}>
                    <TouchableOpacity style={styles.actionBtn} onPress={shareInvite}>
                      <Text style={styles.actionBtnText}>Share</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, { borderColor: '#333' }]}
                      onPress={() => setGeneratedInvite(null)}
                    >
                      <Text style={styles.actionBtnText}>New invite</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.inputRow}>
                  <TextInput
                    style={styles.input}
                    placeholder="their@email.com"
                    placeholderTextColor="#333"
                    value={inviteEmail}
                    onChangeText={setInviteEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    style={[styles.actionBtn, (!inviteEmail.trim() || sendingInvite) && styles.actionBtnDisabled]}
                    onPress={sendInvite}
                    disabled={sendingInvite || !inviteEmail.trim()}
                  >
                    {sendingInvite
                      ? <ActivityIndicator color="#f5f5f5" size="small" />
                      : <Text style={styles.actionBtnText}>Generate</Text>}
                  </TouchableOpacity>
                </View>
              )}
              <TouchableOpacity
                style={[styles.leaveBtn, leavingHousehold && { opacity: 0.5 }]}
                onPress={leaveHousehold}
                disabled={leavingHousehold}
              >
                {leavingHousehold
                  ? <ActivityIndicator color="#ef4444" size="small" />
                  : <Text style={styles.leaveBtnText}>Leave household</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.emptyText}>You're not in a household yet.</Text>
              <Text style={styles.subLabel}>Create one</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  placeholder="Household name"
                  placeholderTextColor="#333"
                  value={newHouseholdName}
                  onChangeText={setNewHouseholdName}
                />
                <TouchableOpacity
                  style={[styles.actionBtn, (!newHouseholdName.trim() || creatingHousehold) && styles.actionBtnDisabled]}
                  onPress={createHousehold}
                  disabled={creatingHousehold || !newHouseholdName.trim()}
                >
                  {creatingHousehold
                    ? <ActivityIndicator color="#f5f5f5" size="small" />
                    : <Text style={styles.actionBtnText}>Create</Text>}
                </TouchableOpacity>
              </View>
              <Text style={[styles.subLabel, { marginTop: 20 }]}>Join with invite token</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  placeholder="Paste invite token"
                  placeholderTextColor="#333"
                  value={joinToken}
                  onChangeText={setJoinToken}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={[styles.actionBtn, (!joinToken.trim() || joiningHousehold) && styles.actionBtnDisabled]}
                  onPress={joinHousehold}
                  disabled={joiningHousehold || !joinToken.trim()}
                >
                  {joiningHousehold
                    ? <ActivityIndicator color="#f5f5f5" size="small" />
                    : <Text style={styles.actionBtnText}>Join</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {/* Gmail */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>GMAIL</Text>
          <View style={styles.row}>
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle}>Gmail import</Text>
              <Text style={styles.rowSub}>
                {gmailStatus == null
                  ? 'Loading…'
                  : gmailStatus.connected
                    ? (gmailStatus.email ? gmailStatus.email : 'Connected')
                    : 'Not connected'}
              </Text>
            </View>
            <View style={styles.btnGroup}>
              {gmailStatus?.connected && (
                <TouchableOpacity
                  style={[styles.actionBtn, gmailSyncing && { opacity: 0.5 }]}
                  onPress={syncGmail}
                  disabled={gmailSyncing}
                >
                  <Text style={styles.actionBtnText}>{gmailSyncing ? 'Syncing…' : 'Sync'}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.actionBtn} onPress={connectGmail}>
                <Text style={styles.actionBtnText}>
                  {gmailStatus?.connected ? 'Reconnect' : 'Connect'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          {gmailStatus?.connected && (
            importSummaryLoading ? (
              <ActivityIndicator color="#555" style={{ alignSelf: 'flex-start', marginTop: 12 }} />
            ) : importSummary ? (
              <>
                <View style={styles.summaryGrid}>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryValue}>{importSummary.imported}</Text>
                    <Text style={styles.summaryLabel}>Imported</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryValue}>{importSummary.imported_pending_review}</Text>
                    <Text style={styles.summaryLabel}>Need review</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryValue}>{importSummary.skipped}</Text>
                    <Text style={styles.summaryLabel}>Skipped</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryValue}>{importSummary.failed}</Text>
                    <Text style={styles.summaryLabel}>Failed</Text>
                  </View>
                </View>
                {Array.isArray(importSummary.reasons) && importSummary.reasons.length > 0 && (
                  <View style={styles.reasonWrap}>
                    {importSummary.reasons.slice(0, 4).map(item => (
                      <View key={item.reason} style={styles.reasonChip}>
                        <Text style={styles.reasonChipText}>{formatImportReason(item.reason)} · {item.count}</Text>
                      </View>
                    ))}
                  </View>
                )}
                <Text style={styles.summaryWindow}>Last {importSummary.window_days} days</Text>
                {formatRelativeTime(importSummary.last_imported_at) ? (
                  <Text style={styles.summaryWindow}>Last refresh {formatRelativeTime(importSummary.last_imported_at)}</Text>
                ) : null}
              </>
            ) : null
          )}
        </View>

        {/* Gmail import log */}
        {gmailStatus?.connected && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.logToggleRow}
              onPress={() => {
                const next = !importLogExpanded;
                setImportLogExpanded(next);
                if (next && importLog.length === 0) loadImportLog();
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.sectionTitle}>IMPORT LOG</Text>
              <Ionicons name={importLogExpanded ? 'chevron-up' : 'chevron-down'} size={13} color="#444" />
            </TouchableOpacity>
            {importLogExpanded && (
              importLogLoading ? (
                <ActivityIndicator color="#555" style={{ alignSelf: 'flex-start', marginTop: 8 }} />
              ) : importLog.length === 0 ? (
                <Text style={styles.emptyText}>No import history yet.</Text>
              ) : (
                importLog.map(entry => (
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

        {/* Sign out */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SESSION</Text>
          <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} disabled={signingOut}>
            {signingOut
              ? <ActivityIndicator color="#ef4444" size="small" />
              : <Text style={styles.signOutText}>Sign out</Text>}
          </TouchableOpacity>
        </View>

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
  emptyText: { color: '#555', fontSize: 13, marginBottom: 12 },

  nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  householdName: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  nameEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  nameEditBtn: { backgroundColor: '#f5f5f5', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center' },
  nameEditBtnText: { color: '#000', fontWeight: '600', fontSize: 13 },
  nameCancelBtn: { padding: 8 },

  subLabel: { fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 1, marginTop: 16, marginBottom: 8 },
  memberRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#111' },
  memberName: { color: '#f5f5f5', fontSize: 14 },
  memberEmail: { color: '#555', fontSize: 12 },
  memberInfo: { flex: 1 },
  removeText: { color: '#ef4444', fontSize: 14 },
  leaveBtn: { marginTop: 24, paddingVertical: 12, alignItems: 'center' },
  leaveBtnText: { color: '#ef4444', fontSize: 14 },
  inputRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, backgroundColor: '#111', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#f5f5f5', fontSize: 14, borderWidth: 1, borderColor: '#1f1f1f' },
  btnGroup: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionBtn: { backgroundColor: '#1a1a1a', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#2a2a2a', justifyContent: 'center' },
  actionBtnDisabled: { opacity: 0.4 },
  actionBtnText: { color: '#f5f5f5', fontSize: 13, fontWeight: '500' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  summaryCard: { minWidth: 76, backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#1e1e1e', paddingHorizontal: 12, paddingVertical: 10 },
  summaryValue: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  summaryLabel: { color: '#666', fontSize: 11, marginTop: 2 },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  reasonChip: { borderRadius: 999, borderWidth: 1, borderColor: '#1f1f1f', backgroundColor: '#111', paddingHorizontal: 10, paddingVertical: 6 },
  reasonChipText: { color: '#777', fontSize: 11 },
  summaryWindow: { color: '#444', fontSize: 11, marginTop: 10 },
  signOutBtn: { paddingVertical: 14, alignItems: 'center' },
  signOutText: { color: '#ef4444', fontSize: 15 },
  logToggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  logRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#111' },
  logRowLeft: { flex: 1, marginRight: 12 },
  logSubject: { color: '#f5f5f5', fontSize: 13 },
  logFrom: { color: '#555', fontSize: 11, marginTop: 2 },
  logDetail: { color: '#555', fontSize: 11, marginTop: 4 },
  logRowRight: { alignItems: 'flex-end' },
  logStatus: { fontSize: 11, color: '#888', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  logStatusImported: { color: '#4ade80' },
  logStatusFailed: { color: '#ef4444' },
  logDate: { color: '#444', fontSize: 11, marginTop: 2 },
  tokenCard: { backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a', padding: 14, marginTop: 4 },
  tokenLabel: { color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  tokenValue: { color: '#f5f5f5', fontSize: 13, fontFamily: 'monospace', lineHeight: 20, marginBottom: 6 },
  tokenExpiry: { color: '#555', fontSize: 11, marginBottom: 12 },
  tokenActions: { flexDirection: 'row', gap: 8 },
});
