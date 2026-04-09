import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  ScrollView,
} from 'react-native';
import { Stack } from 'expo-router';
import { api } from '../services/api';

function cardKey(card = {}) {
  return `${card.payment_method || ''}:${card.card_label || ''}:${card.card_last4 || ''}`;
}

function cardDisplay(card = {}) {
  return `${card.card_label || 'Unnamed card'}${card.card_last4 ? ` ····${card.card_last4}` : ''}`;
}

export default function PaymentMethodsScreen() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftLast4, setDraftLast4] = useState('');

  const loadCards = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/expenses/cards');
      setCards(data || []);
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not load payment methods');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  function beginEdit(card) {
    setEditingKey(cardKey(card));
    setDraftLabel(card.card_label || '');
    setDraftLast4(card.card_last4 || '');
  }

  function cancelEdit() {
    setEditingKey(null);
    setDraftLabel('');
    setDraftLast4('');
  }

  async function saveEdit(card) {
    const key = cardKey(card);
    setSavingKey(key);
    try {
      await api.patch('/expenses/cards/rename', {
        payment_method: card.payment_method,
        card_label: card.card_label || null,
        card_last4: card.card_last4 || null,
        next_card_label: draftLabel || null,
        next_card_last4: draftLast4 || null,
      });
      cancelEdit();
      await loadCards();
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not update payment method');
    } finally {
      setSavingKey(null);
    }
  }

  async function forgetCard(card) {
    const key = cardKey(card);
    setSavingKey(key);
    try {
      await api.post('/expenses/cards/forget', {
        payment_method: card.payment_method,
        card_label: card.card_label || null,
        card_last4: card.card_last4 || null,
      });
      if (editingKey === key) cancelEdit();
      await loadCards();
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not remove payment method');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Saved Card Labels' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>SAVED CARD LABELS</Text>
        <Text style={styles.sectionIntro}>
          These are card labels remembered from past expense entries. You can rename or forget them here.
        </Text>

        {loading ? (
          <ActivityIndicator color="#666" style={styles.loader} />
        ) : cards.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No saved cards yet</Text>
            <Text style={styles.emptyBody}>
              Card labels you use while logging expenses will show up here for easier cleanup later.
            </Text>
          </View>
        ) : (
          cards.map((card) => {
            const key = cardKey(card);
            const editing = editingKey === key;
            const saving = savingKey === key;
            return (
              <View key={key} style={styles.cardRow}>
                <View style={styles.cardTop}>
                  <View style={styles.cardText}>
                    <Text style={styles.cardTitle}>{cardDisplay(card)}</Text>
                    <Text style={styles.cardMeta}>
                      {card.payment_method} · last used {new Date(card.last_used).toLocaleDateString()}
                    </Text>
                  </View>
                  {!editing ? (
                    <View style={styles.actionsRow}>
                      <TouchableOpacity onPress={() => beginEdit(card)} disabled={saving}>
                        <Text style={styles.editAction}>Rename</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => forgetCard(card)} disabled={saving}>
                        <Text style={styles.forgetAction}>{saving ? '...' : 'Forget'}</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>

                {editing ? (
                  <View style={styles.editor}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={draftLabel}
                      onChangeText={setDraftLabel}
                      placeholder="Card nickname"
                      placeholderTextColor="#555"
                    />
                    <TextInput
                      style={styles.last4Input}
                      value={draftLast4}
                      onChangeText={(value) => setDraftLast4(value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="Last 4"
                      placeholderTextColor="#555"
                      keyboardType="number-pad"
                      maxLength={4}
                    />
                    <TouchableOpacity onPress={() => saveEdit(card)} disabled={saving}>
                      <Text style={styles.saveAction}>{saving ? '...' : 'Save'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={cancelEdit} disabled={saving}>
                      <Text style={styles.cancelAction}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 40 },
  sectionTitle: { fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  sectionIntro: { color: '#777', fontSize: 13, lineHeight: 18, marginBottom: 18 },
  loader: { marginTop: 20, alignSelf: 'flex-start' },
  emptyCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 12,
    padding: 16,
  },
  emptyTitle: { color: '#f5f5f5', fontSize: 15, fontWeight: '600', marginBottom: 4 },
  emptyBody: { color: '#777', fontSize: 13, lineHeight: 18 },
  cardRow: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  cardText: { flex: 1, minWidth: 0 },
  cardTitle: { color: '#f5f5f5', fontSize: 15, fontWeight: '600' },
  cardMeta: { color: '#777', fontSize: 12, marginTop: 4 },
  actionsRow: { alignItems: 'flex-end', gap: 10 },
  editAction: { color: '#8ab4ff', fontSize: 13, fontWeight: '600' },
  forgetAction: { color: '#ef4444', fontSize: 13, fontWeight: '600' },
  editor: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  input: {
    backgroundColor: '#0b0b0b',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 10,
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  last4Input: {
    width: 76,
    backgroundColor: '#0b0b0b',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 10,
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  saveAction: { color: '#8ab4ff', fontSize: 13, fontWeight: '700' },
  cancelAction: { color: '#777', fontSize: 13, fontWeight: '600' },
});
