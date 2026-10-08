import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { api } from '../services/api';
import { FRESHNESS_DOMAINS, markFreshnessStale } from '../services/freshnessRegistry';
import { currency } from '../services/purchasePlanningPresentation';
import { PrimaryButton, SecondaryButton } from '../components/ui/Buttons';
import { colors, radius, spacing, typography } from '../theme/tokens';

const SOURCE_TYPES = [
  { key: 'savings', label: 'Savings' },
  { key: 'budget_pool', label: 'Budget' },
  { key: 'general_reserve', label: 'Reserve' },
];

function numberInput(value) {
  return `${value || ''}`.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
}

function sourceTypeLabel(value) {
  return SOURCE_TYPES.find((item) => item.key === value)?.label || 'Other';
}

export default function FundingSourcesScreen() {
  const [items, setItems] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [protectedAmount, setProtectedAmount] = useState('0');
  const [sourceType, setSourceType] = useState('savings');
  const [replenish, setReplenish] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get('/plans/funding-pools', { dedupe: false });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setError('');
    } catch (err) {
      setError(err?.message || 'Could not load funding sources.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function resetForm() {
    setEditingId(null);
    setName('');
    setAmount('');
    setProtectedAmount('0');
    setSourceType('savings');
    setReplenish(false);
    setError('');
  }

  function editSource(source) {
    setEditingId(source.id);
    setName(source.name || '');
    setAmount(`${Number(source.available_amount || 0).toFixed(2)}`);
    setProtectedAmount(`${Number(source.protected_amount || 0).toFixed(2)}`);
    setSourceType(source.pool_type || 'savings');
    setReplenish(Boolean(source.replenishment_required));
    setError('');
  }

  async function saveSource() {
    const available = Number(amount);
    const protectedValue = Number(protectedAmount || 0);
    if (!name.trim() || !Number.isFinite(available) || available < 0 || !Number.isFinite(protectedValue) || protectedValue < 0 || protectedValue > available) {
      setError('Add a name and make sure the protected amount is not more than the balance.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      await api.post('/plans/funding-pools', {
        id: editingId,
        name: name.trim(),
        pool_type: sourceType,
        available_amount: available,
        protected_amount: protectedValue,
        replenishment_required: replenish,
      });
      markFreshnessStale([FRESHNESS_DOMAINS.watchedPlans], { reason: 'planning_funding_source_updated' });
      resetForm();
      await load();
    } catch (err) {
      setError(err?.message || 'Could not save this funding source.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={styles.title}>Funding sources</Text>
          <Text style={styles.subtitle}>Money you would consider using for a planned purchase. Adlo tracks earmarks here but never moves the money.</Text>
        </View>

        {loading ? (
          <View style={styles.skeletonList}>{[0, 1].map((key) => <View key={key} style={styles.skeletonRow} />)}</View>
        ) : items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="wallet-outline" size={24} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No funding sources yet</Text>
            <Text style={styles.empty}>Add only money you would realistically consider. You can keep any portion untouched.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {items.map((source) => (
              <TouchableOpacity key={source.id} style={styles.sourceRow} onPress={() => editSource(source)} activeOpacity={0.82} accessibilityRole="button" accessibilityLabel={`Edit ${source.name}`}>
                <View style={styles.sourceCopy}>
                  <View style={styles.nameRow}>
                    <Text style={styles.sourceName}>{source.name}</Text>
                    <Text style={styles.sourceType}>{sourceTypeLabel(source.pool_type)}</Text>
                  </View>
                  <Text style={styles.sourceMeta}>{currency(source.usable_amount)} uncommitted · {currency(source.reserved_amount)} earmarked · {currency(source.protected_amount)} untouched</Text>
                </View>
                <View style={styles.balanceColumn}>
                  <Text style={styles.sourceAmount}>{currency(source.available_amount)}</Text>
                  <Ionicons name="create-outline" size={17} color={colors.textSubtle} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.form}>
          <View style={styles.formHeading}>
            <View style={styles.sourceCopy}>
              <Text style={styles.sectionTitle}>{editingId ? 'Edit source' : 'Add a source'}</Text>
              <Text style={styles.formBody}>The balance is informational. “Keep untouched” is excluded from every plan.</Text>
            </View>
            {editingId ? <TouchableOpacity style={styles.closeButton} onPress={resetForm} accessibilityLabel="Cancel editing"><Ionicons name="close" size={20} color={colors.textMuted} /></TouchableOpacity> : null}
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Travel savings" placeholderTextColor={colors.textDisabled} />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Type</Text>
            <View style={styles.segmented}>
              {SOURCE_TYPES.map((type) => (
                <TouchableOpacity key={type.key} style={[styles.segment, sourceType === type.key && styles.segmentActive]} onPress={() => setSourceType(type.key)}>
                  <Text style={[styles.segmentText, sourceType === type.key && styles.segmentTextActive]}>{type.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.amountRow}>
            <View style={styles.field}>
              <Text style={styles.label}>Current balance</Text>
              <TextInput style={styles.input} value={amount} onChangeText={(value) => setAmount(numberInput(value))} keyboardType="decimal-pad" placeholder="1200" placeholderTextColor={colors.textDisabled} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Keep untouched</Text>
              <TextInput style={styles.input} value={protectedAmount} onChangeText={(value) => setProtectedAmount(numberInput(value))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textDisabled} />
            </View>
          </View>
          <View style={styles.switchRow}>
            <View style={styles.sourceCopy}>
              <Text style={styles.sourceName}>Plan to put it back</Text>
              <Text style={styles.sourceMeta}>Count money used from this source as a future recovery goal.</Text>
            </View>
            <Switch value={replenish} onValueChange={setReplenish} trackColor={{ false: colors.surfacePressed, true: colors.accentMuted }} thumbColor={replenish ? colors.accent : colors.textSubtle} />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton title={editingId ? 'Save source' : 'Add source'} loading={saving} onPress={saveSource} />
          {editingId ? <SecondaryButton title="Cancel" onPress={resetForm} disabled={saving} /> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: 52, gap: spacing.xxl },
  hero: { gap: spacing.sm },
  title: { ...typography.screenTitle, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted },
  list: { borderTopWidth: 1, borderTopColor: colors.border },
  skeletonList: { gap: 1, backgroundColor: colors.border },
  skeletonRow: { height: 78, backgroundColor: colors.surfaceRaised },
  emptyState: { minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  empty: { ...typography.bodySmall, color: colors.textSubtle, textAlign: 'center' },
  sourceRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.md },
  sourceCopy: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  sourceName: { color: colors.text, fontSize: 15, fontWeight: '650' },
  sourceType: { color: colors.info, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  sourceMeta: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  balanceColumn: { alignItems: 'flex-end', gap: spacing.sm },
  sourceAmount: { color: colors.text, fontSize: 16, fontWeight: '700' },
  form: { gap: spacing.md },
  formHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  formBody: { ...typography.bodySmall, color: colors.textMuted },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  field: { flex: 1, gap: spacing.sm },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceRaised, color: colors.text, paddingHorizontal: spacing.md, fontSize: 15 },
  amountRow: { flexDirection: 'row', gap: spacing.md },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '650' },
  segmented: { minHeight: 44, flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  segment: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  segmentActive: { backgroundColor: colors.accentMuted },
  segmentText: { color: colors.textMuted, fontSize: 13, fontWeight: '650' },
  segmentTextActive: { color: colors.text },
  switchRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  error: { color: colors.danger, ...typography.bodySmall },
});
