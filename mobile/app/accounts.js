import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  TextInput, Alert, ScrollView, Share,
} from 'react-native';
import { Stack } from 'expo-router';
import { signOut } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';

export default function AccountsScreen() {
  const [currentUserEmail, setCurrentUserEmail] = useState(null);
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
    loadHousehold();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUserEmail(session?.user?.email ?? null);
    });
  }, [loadHousehold]);

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
  actionBtn: { backgroundColor: '#1a1a1a', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#2a2a2a', justifyContent: 'center' },
  actionBtnDisabled: { opacity: 0.4 },
  actionBtnText: { color: '#f5f5f5', fontSize: 13, fontWeight: '500' },
  signOutBtn: { paddingVertical: 14, alignItems: 'center' },
  signOutText: { color: '#ef4444', fontSize: 15 },
  tokenCard: { backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a', padding: 14, marginTop: 4 },
  tokenLabel: { color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  tokenValue: { color: '#f5f5f5', fontSize: 13, fontFamily: 'monospace', lineHeight: 20, marginBottom: 6 },
  tokenExpiry: { color: '#555', fontSize: 11, marginBottom: 12 },
  tokenActions: { flexDirection: 'row', gap: 8 },
});
