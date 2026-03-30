import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  Alert,
  Share,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { useRecurring } from '../../hooks/useRecurring';

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { recurring, loading: recurringLoading, refresh: refreshRecurring } = useRecurring();

  const [budgetLimit, setBudgetLimit] = useState('');
  const [currentBudget, setCurrentBudget] = useState(null);
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetMsg, setBudgetMsg] = useState('');
  const [budgetMsgIsError, setBudgetMsgIsError] = useState(false);
  const [pendingSuggestionsCount, setPendingSuggestionsCount] = useState(0);

  // Household
  const [household, setHousehold] = useState(null);
  const [members, setMembers] = useState([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteToken, setInviteToken] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinToken, setJoinToken] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);

  useEffect(() => {
    api.get('/households/me')
      .then(data => { setHousehold(data.household); setMembers(data.members || []); })
      .catch(() => {});
  }, []);

  async function generateInvite() {
    if (!inviteEmail.trim()) return;
    setInviteLoading(true);
    try {
      const data = await api.post('/households/invites', { email: inviteEmail.trim().toLowerCase() });
      setInviteToken(data.token);
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to generate invite');
    } finally {
      setInviteLoading(false);
    }
  }

  async function joinHousehold() {
    if (!joinToken.trim()) return;
    setJoinLoading(true);
    try {
      await api.post(`/households/invites/${joinToken.trim()}/accept`, {});
      const data = await api.get('/households/me');
      setHousehold(data.household);
      setMembers(data.members || []);
      setShowJoinModal(false);
      setJoinToken('');
      Alert.alert('Joined!', `You're now part of ${data.household.name}.`);
    } catch (e) {
      Alert.alert('Error', e.message || 'Invalid or expired invite code');
    } finally {
      setJoinLoading(false);
    }
  }

  function resetInviteModal() {
    setShowInviteModal(false);
    setInviteEmail('');
    setInviteToken(null);
  }

  const loadBudget = useCallback(async () => {
    try {
      const data = await api.get('/budgets');
      setCurrentBudget(data.total);
      if (data.total?.limit) setBudgetLimit(String(data.total.limit));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadBudget();
  }, [loadBudget]);

  useEffect(() => {
    api.get('/categories')
      .then(d => setPendingSuggestionsCount(d.pending_suggestions_count || 0))
      .catch(() => {});
  }, []);

  async function saveBudget() {
    const val = parseFloat(budgetLimit);
    if (!budgetLimit || isNaN(val) || val <= 0) {
      setBudgetMsg('Please enter a valid amount');
      setBudgetMsgIsError(true);
      return;
    }
    setBudgetSaving(true);
    setBudgetMsg('');
    try {
      await api.put('/budgets/total', { monthly_limit: val });
      setBudgetMsg('Saved!');
      setBudgetMsgIsError(false);
      loadBudget();
      setTimeout(() => setBudgetMsg(''), 2000);
    } catch (e) {
      setBudgetMsg(e.message || 'Failed to save');
      setBudgetMsgIsError(true);
    } finally {
      setBudgetSaving(false);
    }
  }

  async function removeRecurring(id) {
    try {
      await api.delete(`/recurring/${id}`);
      refreshRecurring();
    } catch { /* ignore */ }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>

      {/* Household */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>HOUSEHOLD</Text>
        {household ? (
          <>
            <Text style={styles.subText}>{household.name}</Text>
            {members.map(m => (
              <View key={m.id} style={styles.memberRow}>
                <Ionicons name="person-circle-outline" size={18} color="#555" />
                <Text style={styles.memberName}>{m.name || m.email}</Text>
              </View>
            ))}
            <TouchableOpacity style={[styles.button, { marginTop: 12 }]} onPress={() => setShowInviteModal(true)}>
              <Text style={styles.buttonText}>Invite Member</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.subText}>You're not in a household yet.</Text>
            <TouchableOpacity style={styles.button} onPress={() => router.push('/onboarding')}>
              <Text style={styles.buttonText}>Create or Join a Household</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.outlineButton, { marginTop: 8 }]} onPress={() => setShowJoinModal(true)}>
              <Text style={styles.outlineButtonText}>Enter Invite Code</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Invite Member Modal */}
      <Modal visible={showInviteModal} transparent animationType="slide" onRequestClose={resetInviteModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            {inviteToken ? (
              <>
                <Text style={styles.modalTitle}>Invite sent</Text>
                <Text style={styles.modalSub}>
                  Share this code with {inviteEmail}. It expires in 7 days and can only be used once.
                  {'\n\n'}They must sign in with {inviteEmail} to accept it.
                </Text>
                <View style={styles.tokenBox}>
                  <Text style={styles.tokenText} selectable>{inviteToken}</Text>
                </View>
                <TouchableOpacity
                  style={styles.button}
                  onPress={() => Share.share({ message: `Join my household on Adlo with this invite code:\n\n${inviteToken}` })}
                >
                  <Text style={styles.buttonText}>Share Code</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={resetInviteModal}>
                  <Text style={styles.cancelText}>Done</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>Invite a member</Text>
                <Text style={styles.modalSub}>Enter their email address. They must accept with the same email.</Text>
                <TextInput
                  style={styles.input}
                  placeholder="their@email.com"
                  placeholderTextColor="#555"
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoFocus
                />
                <TouchableOpacity
                  style={[styles.button, inviteLoading && styles.buttonDisabled]}
                  onPress={generateInvite}
                  disabled={inviteLoading}
                >
                  <Text style={styles.buttonText}>{inviteLoading ? 'Generating…' : 'Generate Invite Code'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={resetInviteModal}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Join Household Modal */}
      <Modal visible={showJoinModal} transparent animationType="slide" onRequestClose={() => setShowJoinModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Enter invite code</Text>
            <Text style={styles.modalSub}>Paste the code you received from your household member.</Text>
            <TextInput
              style={styles.input}
              placeholder="Paste invite code here"
              placeholderTextColor="#555"
              value={joinToken}
              onChangeText={setJoinToken}
              autoCapitalize="none"
              autoFocus
            />
            <TouchableOpacity
              style={[styles.button, joinLoading && styles.buttonDisabled]}
              onPress={joinHousehold}
              disabled={joinLoading}
            >
              <Text style={styles.buttonText}>{joinLoading ? 'Joining…' : 'Join Household'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowJoinModal(false); setJoinToken(''); }}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Budget */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>BUDGET</Text>
        {currentBudget && (
          <Text style={styles.subText}>
            Current: ${Math.round(currentBudget.limit)}/mo · Spent: ${Math.round(currentBudget.spent)}
          </Text>
        )}
        <TextInput
          style={styles.input}
          value={budgetLimit}
          onChangeText={setBudgetLimit}
          placeholder="Monthly limit (e.g. 2000)"
          placeholderTextColor="#555"
          keyboardType="numeric"
        />
        <TouchableOpacity
          style={[styles.button, budgetSaving && styles.buttonDisabled]}
          onPress={saveBudget}
          disabled={budgetSaving}
        >
          <Text style={styles.buttonText}>{budgetSaving ? 'Saving...' : 'Save Budget'}</Text>
        </TouchableOpacity>
        {budgetMsg ? <Text style={budgetMsgIsError ? styles.msgError : styles.msgText}>{budgetMsg}</Text> : null}
      </View>

      {/* Recurring — list only, no manual detect button */}
      {!recurringLoading && recurring.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>RECURRING EXPENSES</Text>
          {recurring.map(item => (
            <View key={item.id} style={styles.row}>
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle}>{item.merchant}</Text>
                <Text style={styles.rowSub}>
                  ${parseFloat(item.expected_amount).toFixed(2)} · {item.frequency} · next {item.next_expected_date}
                </Text>
              </View>
              <TouchableOpacity onPress={() => removeRecurring(item.id)}>
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Accounts */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ACCOUNTS</Text>
        <TouchableOpacity style={styles.navRow} onPress={() => router.push('/accounts')}>
          <Text style={styles.navRowText}>Manage accounts</Text>
          <Ionicons name="chevron-forward" size={16} color="#888" />
        </TouchableOpacity>
      </View>

      {/* Categories */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>CATEGORIES</Text>
        <TouchableOpacity style={styles.navRow} onPress={() => router.push('/categories')}>
          <Text style={styles.navRowText}>Edit category details</Text>
          <View style={styles.navRowRight}>
            {pendingSuggestionsCount > 0 && <View style={styles.badge} />}
            <Ionicons name="chevron-forward" size={16} color="#888" />
          </View>
        </TouchableOpacity>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 40 },
  section: { marginBottom: 32, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', paddingBottom: 24 },
  sectionTitle: { fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  subText: { color: '#bbb', fontSize: 14, marginBottom: 10 },
  input: { backgroundColor: '#111', borderWidth: 1, borderColor: '#333', borderRadius: 8, color: '#fff', padding: 12, fontSize: 16, marginBottom: 10 },
  button: { backgroundColor: '#fff', borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#0a0a0a', fontWeight: '600', fontSize: 15 },
  msgText: { color: '#bbb', fontSize: 14, marginTop: 6, textAlign: 'center' },
  msgError: { color: '#ef4444', fontSize: 14, marginTop: 6, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  rowInfo: { flex: 1, marginRight: 12 },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '500' },
  rowSub: { color: '#999', fontSize: 14, marginTop: 2 },
  removeText: { color: '#e44', fontSize: 14 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  navRowText: { color: '#f5f5f5', fontSize: 15 },
  navRowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  memberName: { color: '#ccc', fontSize: 14 },
  outlineButton: { borderWidth: 1, borderColor: '#333', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  outlineButtonText: { color: '#ccc', fontWeight: '600', fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#111', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 20, color: '#fff', fontWeight: '700', marginBottom: 8 },
  modalSub: { color: '#888', fontSize: 14, lineHeight: 20, marginBottom: 16 },
  tokenBox: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 16, marginBottom: 16 },
  tokenText: { color: '#fff', fontSize: 13, fontFamily: 'monospace', lineHeight: 20 },
  cancelBtn: { alignItems: 'center', marginTop: 12 },
  cancelText: { color: '#555', fontSize: 14 },
});
