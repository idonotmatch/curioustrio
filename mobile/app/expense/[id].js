import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Switch, Linking, Platform
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useState, useEffect } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { invalidateCache } from '../../services/cache';
import { useCategories } from '../../hooks/useCategories';

export default function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { categories } = useCategories();
  const [expense, setExpense] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actioning, setActioning] = useState(false);

  // Edit state
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [categoryId, setCategoryId] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('unknown');
  const [cardLast4, setCardLast4] = useState('');
  const [cardLabel, setCardLabel] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [items, setItems] = useState([]);
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const [itemsEdits, setItemsEdits] = useState([]);

  useEffect(() => {
    api.get(`/expenses/${id}`)
      .then(e => {
        setExpense(e);
        setMerchant(e.merchant || '');
        setAmount(String(Math.abs(Number(e.amount))));
        setDate(e.date ? e.date.slice(0, 10) : '');
        setNotes(e.notes || '');
        setCategoryId(e.category_id || null);
        setPaymentMethod(e.payment_method || 'unknown');
        setCardLast4(e.card_last4 || '');
        setCardLabel(e.card_label || '');
        setIsPrivate(e.is_private || false);
        setItems(e.items || []);
        setItemsEdits((e.items || []).map(it => ({
          description: it.description,
          amount: it.amount != null ? String(it.amount) : '',
        })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave() {
    setSaving(true);
    try {
      const expenseMonth = (date || '').slice(0, 7) || new Date().toISOString().slice(0, 7);
      const updated = await api.patch(`/expenses/${id}`, {
        merchant,
        amount: parseFloat(amount),
        date,
        notes,
        category_id: categoryId,
        payment_method: paymentMethod,
        card_last4: cardLast4 || null,
        card_label: cardLabel || null,
        is_private: isPrivate,
        items: itemsEdits
          .filter(it => it.description.trim())
          .map(it => ({ description: it.description.trim(), amount: it.amount ? parseFloat(it.amount) : null })),
      });
      setExpense(updated);
      setEditing(false);
      setItems(itemsEdits.filter(it => it.description.trim()).map(it => ({ description: it.description.trim(), amount: it.amount ? parseFloat(it.amount) : null })));
      invalidateCache(`cache:expenses:${expenseMonth}`);
      invalidateCache(`cache:budget:${expenseMonth}:personal`);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    Alert.alert('Delete expense', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setDeleting(true);
          try {
            const month = (expense?.date || '').slice(0, 7);
            await api.delete(`/expenses/${id}`);
            if (month) {
              invalidateCache(`cache:expenses:${month}`);
              invalidateCache(`cache:budget:${month}:personal`);
            }
            router.back();
          } catch (e) {
            Alert.alert('Error', e.message);
            setDeleting(false);
          }
        },
      },
    ]);
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color="#555" /></View>;
  if (!expense) return <View style={styles.center}><Text style={styles.muted}>Expense not found.</Text></View>;

  const formattedDate = (() => {
    const d = new Date((expense.date || '').slice(0, 10) + 'T12:00:00');
    return isNaN(d) ? expense.date : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  })();
  const sourceLabel = { manual: 'Manual entry', camera: 'Receipt scan', email: 'Email import', refund: 'Refund' };
  const isRefund = Number(expense.amount) < 0;

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{
        title: expense.merchant,
        headerRight: editing ? undefined : () => (
          <TouchableOpacity onPress={() => setEditing(true)} style={{ marginRight: 4 }}>
            <Ionicons name="pencil-outline" size={20} color="#f5f5f5" />
          </TouchableOpacity>
        ),
      }} />

      {/* Hero */}
      <View style={styles.hero}>
        {editing ? (
          <View style={styles.editRow}>
            <TextInput style={[styles.editInput, { flex: 1 }]} value={merchant} onChangeText={setMerchant} placeholderTextColor="#444" placeholder="Merchant" />
            <TextInput style={[styles.editInput, styles.editAmount]} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#444" />
          </View>
        ) : (
          <>
            <Text style={styles.merchant}>{expense.merchant}</Text>
            <Text style={[styles.amount, isRefund && styles.amountRefund]}>
              {isRefund ? '−' : ''}${Math.abs(Number(expense.amount)).toFixed(2)}
            </Text>
          </>
        )}
      </View>

      {/* Fields */}
      <View style={styles.section}>
        <Row label="Date">
          {editing ? (
            <DateTimePicker
              value={date ? new Date(date + 'T12:00:00') : new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'compact' : 'default'}
              maximumDate={new Date()}
              onChange={(_, selected) => {
                if (selected) setDate(selected.toISOString().slice(0, 10));
              }}
              themeVariant="dark"
              style={styles.datePicker}
            />
          ) : (
            <Text style={styles.value}>{formattedDate}</Text>
          )}
        </Row>
        <Row label="Source"><Text style={styles.value}>{sourceLabel[expense.source] || expense.source}</Text></Row>
        {expense.place_name && (
          <Row label="Location"><Text style={styles.value}>{expense.place_name}{expense.address ? `\n${expense.address}` : ''}</Text></Row>
        )}
        <Row label="Notes">
          {editing
            ? <TextInput style={styles.editInputInline} value={notes} onChangeText={setNotes} placeholder="Add a note" placeholderTextColor="#444" multiline />
            : <Text style={styles.value}>{expense.notes || '—'}</Text>}
        </Row>
        <Row label="Category">
          {editing ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 36 }}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(categories || []).map(c => (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.catChip, categoryId === c.id && styles.catChipActive]}
                    onPress={() => setCategoryId(c.id)}
                  >
                    <Text style={[styles.catChipText, categoryId === c.id && styles.catChipTextActive]}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          ) : (
            <Text style={styles.value}>{expense.category_name || '—'}</Text>
          )}
        </Row>

        <Row label="Payment">
          {editing ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 36 }}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {['cash', 'debit', 'credit', 'unknown'].map(m => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.catChip, paymentMethod === m && styles.catChipActive]}
                    onPress={() => setPaymentMethod(m)}
                  >
                    <Text style={[styles.catChipText, paymentMethod === m && styles.catChipTextActive]}>
                      {m === 'unknown' ? 'other' : m}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          ) : (
            <Text style={styles.value}>
              {expense.payment_method && expense.payment_method !== 'unknown'
                ? `${expense.payment_method}${expense.card_label ? ` · ${expense.card_label}` : ''}${expense.card_last4 ? ` ····${expense.card_last4}` : ''}`
                : '—'}
            </Text>
          )}
        </Row>

        {editing && (paymentMethod === 'debit' || paymentMethod === 'credit') && (
          <Row label="Card">
            <View style={{ flexDirection: 'row', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
              <TextInput
                style={[styles.editInputInline, { flex: 1 }]}
                placeholder="nickname"
                placeholderTextColor="#444"
                value={cardLabel}
                onChangeText={setCardLabel}
              />
              <TextInput
                style={[styles.editInputInline, { width: 50 }]}
                placeholder="last4"
                placeholderTextColor="#444"
                value={cardLast4}
                onChangeText={t => setCardLast4(t.replace(/\D/g, '').slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>
          </Row>
        )}

        <View style={[styles.row, { paddingVertical: 12 }]}>
          <Text style={styles.label}>Private</Text>
          <Switch
            value={isPrivate}
            onValueChange={editing ? setIsPrivate : undefined}
            disabled={!editing}
            trackColor={{ false: '#1f1f1f', true: '#6366f1' }}
            thumbColor={isPrivate ? '#fff' : '#555'}
          />
        </View>
      </View>

      {(items.length > 0 || editing) && (
        <TouchableOpacity
          style={styles.itemsHeader}
          onPress={() => setItemsExpanded(e => !e)}
          activeOpacity={0.7}
        >
          <Text style={styles.itemsHeaderText}>
            {items.length > 0 ? `${items.length} ${items.length === 1 ? 'item' : 'items'}` : 'Items'}
          </Text>
          <Ionicons name={itemsExpanded ? 'chevron-up' : 'chevron-forward'} size={14} color="#444" />
        </TouchableOpacity>
      )}

      {itemsExpanded && (
        <View style={styles.itemsList}>
          {editing ? (
            <>
              {itemsEdits.map((item, i) => (
                <View key={i} style={styles.itemEditRow}>
                  <TextInput
                    style={styles.itemEditDesc}
                    value={item.description}
                    onChangeText={v => setItemsEdits(prev => prev.map((it, idx) => idx === i ? { ...it, description: v } : it))}
                    placeholder="Description"
                    placeholderTextColor="#444"
                  />
                  <TextInput
                    style={styles.itemEditAmount}
                    value={item.amount}
                    onChangeText={v => setItemsEdits(prev => prev.map((it, idx) => idx === i ? { ...it, amount: v } : it))}
                    placeholder="0.00"
                    placeholderTextColor="#444"
                    keyboardType="decimal-pad"
                  />
                  <TouchableOpacity
                    onPress={() => setItemsEdits(prev => prev.filter((_, idx) => idx !== i))}
                    style={styles.itemRemoveBtn}
                  >
                    <Text style={styles.itemRemoveText}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity
                onPress={() => setItemsEdits(prev => [...prev, { description: '', amount: '' }])}
                style={styles.addItemRow}
              >
                <Text style={styles.addItemText}>+ Add item</Text>
              </TouchableOpacity>
              {(() => {
                const itemSum = itemsEdits.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
                const total = parseFloat(amount) || 0;
                const hasAmounts = itemsEdits.some(it => it.amount !== '');
                if (!hasAmounts || total === 0) return null;
                const diff = total - itemSum;
                const balanced = Math.abs(diff) < 0.01;
                return (
                  <View style={styles.itemBalance}>
                    <Text style={[styles.itemBalanceText, balanced ? styles.itemBalanceOk : styles.itemBalanceWarn]}>
                      {balanced
                        ? '✓ Items match total'
                        : diff > 0
                          ? `$${diff.toFixed(2)} unaccounted`
                          : `$${Math.abs(diff).toFixed(2)} over total`}
                    </Text>
                  </View>
                );
              })()}
            </>
          ) : (
            items.map((item, i) => (
              <View key={i} style={styles.itemReadRow}>
                <Text style={styles.itemReadDesc}>{item.description}</Text>
                {item.amount != null && (
                  <Text style={styles.itemReadAmount}>${Number(item.amount).toFixed(2)}</Text>
                )}
              </View>
            ))
          )}
        </View>
      )}

      {/* Location */}
      {expense.place_name && (() => {
        const coords = expense.mapkit_stable_id?.split(',').map(Number);
        const hasCoords = coords?.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1]);
        const mapsUrl = hasCoords
          ? `maps://?ll=${coords[0]},${coords[1]}&q=${encodeURIComponent(expense.place_name)}`
          : `maps://?q=${encodeURIComponent(expense.address || expense.place_name)}`;
        return (
          <TouchableOpacity style={styles.locationCard} onPress={() => Linking.openURL(mapsUrl)}>
            <View style={styles.locationInfo}>
              <Text style={styles.locationName}>{expense.place_name}</Text>
              {expense.address ? <Text style={styles.locationAddress}>{expense.address}</Text> : null}
            </View>
            <Ionicons name="map-outline" size={18} color="#444" />
          </TouchableOpacity>
        );
      })()}

      {/* Duplicate flags */}
      {expense.duplicate_flags?.length > 0 && (
        <View style={styles.dupSection}>
          <Text style={styles.dupTitle}>Possible duplicate</Text>
          {expense.duplicate_flags.map(f => (
            <Text key={f.id} style={styles.dupItem}>Confidence: {f.confidence} · {f.status}</Text>
          ))}
        </View>
      )}

      {/* Actions */}
      {editing && (
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save changes'}</Text>
        </TouchableOpacity>
      )}

      {!editing && expense.status === 'pending' && (
        <View style={styles.pendingActions}>
          <TouchableOpacity
            style={[styles.approveBtn, actioning && { opacity: 0.5 }]}
            disabled={actioning}
            onPress={async () => {
              setActioning(true);
              try { await api.post(`/expenses/${id}/approve`); router.back(); }
              catch (e) { Alert.alert('Error', e.message); setActioning(false); }
            }}
          >
            <Text style={styles.approveBtnText}>Approve</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dismissBtn, actioning && { opacity: 0.5 }]}
            disabled={actioning}
            onPress={async () => {
              setActioning(true);
              try { await api.post(`/expenses/${id}/dismiss`); router.back(); }
              catch (e) { Alert.alert('Error', e.message); setActioning(false); }
            }}
          >
            <Text style={styles.dismissBtnText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} disabled={deleting}>
        {deleting
          ? <ActivityIndicator color="#ef4444" size="small" />
          : <Text style={styles.deleteBtnText}>Delete expense</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

function Row({ label, children }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueWrap}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
  muted: { color: '#555' },

  hero: { padding: 24, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: '#111' },
  merchant: { fontSize: 20, color: '#f5f5f5', fontWeight: '600', letterSpacing: -0.3 },
  amount: { fontSize: 36, color: '#f5f5f5', fontWeight: '600', marginTop: 4, letterSpacing: -1 },
  amountRefund: { color: '#4ade80' },

  editRow: { flexDirection: 'row', gap: 10 },
  editInput: { backgroundColor: '#111', borderRadius: 8, padding: 10, color: '#f5f5f5', fontSize: 15, borderWidth: 1, borderColor: '#1f1f1f' },
  editAmount: { width: 100 },
  editInputInline: { color: '#f5f5f5', fontSize: 14, textAlign: 'right', flex: 1, padding: 4 },
  datePicker: { marginRight: -8 },

  section: { paddingHorizontal: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#111' },
  label: { fontSize: 13, color: '#444', width: 90 },
  valueWrap: { flex: 1, alignItems: 'flex-end' },
  value: { fontSize: 14, color: '#f5f5f5', textAlign: 'right' },

  catChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: '#111', borderWidth: 1, borderColor: '#1f1f1f' },
  catChipActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  catChipText: { fontSize: 12, color: '#555' },
  catChipTextActive: { color: '#000', fontWeight: '600' },

  locationCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginTop: 4, marginBottom: 4, padding: 14, backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#1f1f1f' },
  locationInfo: { flex: 1 },
  locationName: { color: '#f5f5f5', fontSize: 13, fontWeight: '500' },
  locationAddress: { color: '#555', fontSize: 11, marginTop: 2 },

  dupSection: { margin: 20, padding: 12, backgroundColor: '#141008', borderRadius: 8, borderWidth: 1, borderColor: '#2a1f00' },
  dupTitle: { color: '#f59e0b', fontWeight: '600', fontSize: 13, marginBottom: 4 },
  dupItem: { color: '#78716c', fontSize: 12, marginTop: 2 },

  saveBtn: { margin: 20, marginBottom: 8, backgroundColor: '#f5f5f5', borderRadius: 10, padding: 14, alignItems: 'center' },
  saveBtnText: { color: '#000', fontWeight: '600', fontSize: 15 },
  pendingActions: { flexDirection: 'row', marginHorizontal: 20, marginTop: 20, gap: 10 },
  approveBtn: { flex: 1, backgroundColor: '#22c55e', borderRadius: 10, padding: 14, alignItems: 'center' },
  approveBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  dismissBtn: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#2a2a2a' },
  dismissBtnText: { color: '#ef4444', fontWeight: '600', fontSize: 15 },
  deleteBtn: { margin: 20, marginTop: 8, padding: 14, alignItems: 'center' },
  deleteBtnText: { color: '#ef4444', fontSize: 14 },

  itemsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, marginTop: 4, marginBottom: 4, padding: 14, backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#1f1f1f' },
  itemsHeaderText: { fontSize: 13, color: '#444', fontWeight: '500' },
  itemsList: { marginHorizontal: 20, marginBottom: 4, backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#1f1f1f', overflow: 'hidden' },
  itemReadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  itemReadDesc: { fontSize: 13, color: '#f5f5f5', flex: 1 },
  itemReadAmount: { fontSize: 13, color: '#888', paddingLeft: 8 },
  itemEditRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  itemEditDesc: { flex: 1, color: '#f5f5f5', fontSize: 13, padding: 4 },
  itemEditAmount: { width: 64, color: '#f5f5f5', fontSize: 13, padding: 4, textAlign: 'right' },
  itemRemoveBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  itemRemoveText: { color: '#555', fontSize: 20, lineHeight: 22 },
  addItemRow: { paddingHorizontal: 14, paddingVertical: 10 },
  addItemText: { color: '#555', fontSize: 13 },
  itemBalance: { paddingHorizontal: 14, paddingBottom: 10 },
  itemBalanceText: { fontSize: 12 },
  itemBalanceOk: { color: '#4ade80' },
  itemBalanceWarn: { color: '#f59e0b' },
});
