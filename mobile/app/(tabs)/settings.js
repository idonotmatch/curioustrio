import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { api } from '../../services/api';
import { useRecurring } from '../../hooks/useRecurring';

export default function SettingsScreen() {
  const { recurring, loading: recurringLoading, refresh: refreshRecurring } = useRecurring();

  // Budget section
  const [budgetLimit, setBudgetLimit] = useState('');
  const [currentBudget, setCurrentBudget] = useState(null);
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetMsg, setBudgetMsg] = useState('');

  // Recurring detect section
  const [detecting, setDetecting] = useState(false);
  const [candidates, setCandidates] = useState(null);
  const [addingId, setAddingId] = useState(null);

  // Gmail section
  const [gmailStatus, setGmailStatus] = useState(null);

  const loadBudget = useCallback(async () => {
    try {
      const data = await api.get('/budgets');
      setCurrentBudget(data.total);
      if (data.total?.limit) setBudgetLimit(String(data.total.limit));
    } catch {
      // ignore
    }
  }, []);

  const loadGmailStatus = useCallback(async () => {
    try {
      const data = await api.get('/gmail/status');
      setGmailStatus(data);
    } catch {
      setGmailStatus(null);
    }
  }, []);

  useEffect(() => {
    loadBudget();
    loadGmailStatus();
  }, [loadBudget, loadGmailStatus]);

  async function saveBudget() {
    setBudgetSaving(true);
    setBudgetMsg('');
    try {
      await api.put('/budgets/total', { monthly_limit: parseFloat(budgetLimit) });
      setBudgetMsg('Saved!');
      loadBudget();
    } catch (e) {
      setBudgetMsg(e.message || 'Failed to save');
    } finally {
      setBudgetSaving(false);
    }
  }

  async function detectRecurring() {
    setDetecting(true);
    setCandidates(null);
    try {
      const data = await api.post('/recurring/detect');
      setCandidates(data);
    } catch {
      setCandidates([]);
    } finally {
      setDetecting(false);
    }
  }

  async function addCandidate(candidate, index) {
    setAddingId(index);
    try {
      await api.post('/recurring', {
        merchant: candidate.merchant,
        expected_amount: candidate.medianAmount,
        frequency: candidate.frequency,
        next_expected_date: candidate.nextExpectedDate,
      });
      // Remove from candidates list after adding
      setCandidates(prev => prev.filter((_, i) => i !== index));
      refreshRecurring();
    } catch {
      // ignore
    } finally {
      setAddingId(null);
    }
  }

  async function removeRecurring(id) {
    try {
      await api.delete(`/recurring/${id}`);
      refreshRecurring();
    } catch {
      // ignore
    }
  }

  async function connectGmail() {
    try {
      const data = await api.get('/gmail/auth');
      if (data?.url) {
        await Linking.openURL(data.url);
      }
    } catch {
      // ignore
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Budget Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>BUDGET</Text>
        {currentBudget && (
          <Text style={styles.subText}>
            Current: ${currentBudget.limit}/mo · Spent: ${currentBudget.spent}
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
        {budgetMsg ? <Text style={styles.msgText}>{budgetMsg}</Text> : null}
      </View>

      {/* Recurring Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>RECURRING EXPENSES</Text>
        {recurringLoading ? (
          <ActivityIndicator color="#fff" />
        ) : recurring.length === 0 ? (
          <Text style={styles.emptyText}>No recurring expenses tracked.</Text>
        ) : (
          recurring.map(item => (
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
          ))
        )}

        <TouchableOpacity
          style={[styles.button, styles.buttonSecondary, detecting && styles.buttonDisabled]}
          onPress={detectRecurring}
          disabled={detecting}
        >
          <Text style={styles.buttonText}>{detecting ? 'Detecting...' : 'Detect Recurring'}</Text>
        </TouchableOpacity>

        {candidates !== null && candidates.length === 0 && (
          <Text style={styles.emptyText}>No recurring patterns detected.</Text>
        )}
        {candidates && candidates.length > 0 && (
          <View style={styles.candidatesBox}>
            <Text style={styles.candidatesTitle}>Detected Patterns</Text>
            {candidates.map((c, i) => (
              <View key={i} style={styles.row}>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle}>{c.merchant}</Text>
                  <Text style={styles.rowSub}>
                    ${c.medianAmount?.toFixed(2)} · {c.frequency} · next {c.nextExpectedDate}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => addCandidate(c, i)}
                  disabled={addingId === i}
                >
                  <Text style={styles.addText}>{addingId === i ? '...' : 'Add'}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Gmail Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>GMAIL</Text>
        {gmailStatus ? (
          <Text style={styles.subText}>
            {gmailStatus.connected ? `Connected: ${gmailStatus.email}` : 'Not connected'}
          </Text>
        ) : (
          <Text style={styles.subText}>Loading status...</Text>
        )}
        <TouchableOpacity style={styles.button} onPress={connectGmail}>
          <Text style={styles.buttonText}>
            {gmailStatus?.connected ? 'Reconnect Gmail' : 'Connect Gmail'}
          </Text>
        </TouchableOpacity>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 40 },
  section: {
    marginBottom: 32,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    paddingBottom: 24,
  },
  sectionTitle: {
    fontSize: 11,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  subText: { color: '#aaa', fontSize: 13, marginBottom: 10 },
  input: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    color: '#fff',
    padding: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  button: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonSecondary: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    marginTop: 12,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#0a0a0a', fontWeight: '600', fontSize: 15 },
  msgText: { color: '#aaa', fontSize: 13, marginTop: 6, textAlign: 'center' },
  emptyText: { color: '#555', fontSize: 13, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  rowInfo: { flex: 1, marginRight: 12 },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '500' },
  rowSub: { color: '#666', fontSize: 12, marginTop: 2 },
  removeText: { color: '#e44', fontSize: 13 },
  addText: { color: '#4af', fontSize: 13, fontWeight: '600' },
  candidatesBox: { marginTop: 12 },
  candidatesTitle: { color: '#aaa', fontSize: 12, marginBottom: 6 },
});
