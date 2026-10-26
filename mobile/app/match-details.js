import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { DismissKeyboardScrollView } from '../components/DismissKeyboardScrollView';
import { InlineError } from '../components/ui/States';
import { invalidateExpenseMutationCaches } from '../services/expenseMutationEffects';
import { colors, spacing, typography } from '../theme/tokens';

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function identityTitle(domain, identity = {}) {
  if (domain === 'merchant') return identity.display_name || 'Merchant';
  if (domain === 'payment') return [identity.display_label || 'Card', identity.card_last4 ? `····${identity.card_last4}` : null].filter(Boolean).join(' ');
  return identity.place_name || identity.address || 'Place';
}

function candidateTitle(domain, candidate = {}) {
  if (domain === 'merchant') return candidate.display_name || 'Merchant';
  if (domain === 'payment') return [candidate.display_label || candidate.payment_method, candidate.card_last4 ? `····${candidate.card_last4}` : null].filter(Boolean).join(' ');
  return candidate.place_name || candidate.address || 'Place';
}

function MatchSection({ domain, identity, aliases, candidates, count, onChanged }) {
  const [saving, setSaving] = useState('');
  const [draft, setDraft] = useState({});
  const [alias, setAlias] = useState('');

  useEffect(() => {
    if (!identity) return;
    if (domain === 'merchant') {
      setDraft({ display_name: identity.display_name || '', chain_key: identity.chain_key || '', branch_key: identity.branch_key || '', seller_context: identity.seller_context || '' });
    } else if (domain === 'payment') {
      setDraft({ display_label: identity.display_label || '', card_last4: identity.card_last4 || '', issuer: identity.issuer || '', network: identity.network || '' });
    } else {
      setDraft({ place_name: identity.place_name || '', address: identity.address || '', chain_key: identity.chain_key || '', branch_key: identity.branch_key || '' });
    }
  }, [domain, identity?.id]);

  if (!identity) return null;

  const fields = domain === 'merchant'
    ? [['display_name', 'Merchant name'], ['chain_key', 'Chain or parent brand'], ['branch_key', 'Branch identifier'], ['seller_context', 'Seller or marketplace context']]
    : domain === 'payment'
      ? [['display_label', 'Card nickname'], ['card_last4', 'Last 4 digits'], ['issuer', 'Issuer'], ['network', 'Network']]
      : [['place_name', 'Place name'], ['address', 'Address'], ['chain_key', 'Chain'], ['branch_key', 'Branch identifier']];

  async function save() {
    setSaving('save');
    try {
      await api.patch(`/identities/${domain}/${identity.id}`, draft);
      await invalidateExpenseMutationCaches({ includePending: false });
      await onChanged();
    } catch (error) {
      Alert.alert('Could not save match details', error?.message || 'Please try again.');
    } finally {
      setSaving('');
    }
  }

  async function addAlias() {
    if (!alias.trim()) return;
    setSaving('alias');
    try {
      await api.post(`/identities/${domain}/${identity.id}/aliases`, { alias: alias.trim() });
      setAlias('');
      await onChanged();
    } catch (error) {
      Alert.alert('Could not add alias', error?.message || 'Please try again.');
    } finally {
      setSaving('');
    }
  }

  function separate() {
    Alert.alert(
      `Separate this ${domain}`,
      `This expense will keep its own ${domain} identity. Other history will stay unchanged.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Separate',
          style: 'destructive',
          onPress: async () => {
            setSaving('separate');
            try {
              await api.post(`/identities/expenses/${identity.expense_id || ''}/${domain}/separate`, {});
              await invalidateExpenseMutationCaches({ includePending: false });
              await onChanged();
            } catch (error) {
              Alert.alert('Could not separate identity', error?.message || 'Please try again.');
            } finally {
              setSaving('');
            }
          },
        },
      ]
    );
  }

  function merge(candidate) {
    Alert.alert(
      'Combine identities?',
      `${identityTitle(domain, identity)} will be combined with ${candidateTitle(domain, candidate)}. Existing expenses stay intact and use one shared identity.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Combine',
          onPress: async () => {
            setSaving(`merge:${candidate.id}`);
            try {
              await api.post(`/identities/${domain}/${candidate.id}/merge`, { source_entity_id: identity.id });
              await invalidateExpenseMutationCaches({ includePending: false });
              await onChanged();
            } catch (error) {
              Alert.alert('Could not combine identities', error?.message || 'Please try again.');
            } finally {
              setSaving('');
            }
          },
        },
      ]
    );
  }

  function markMoved(candidate) {
    Alert.alert(
      'Mark this as a previous location?',
      `${identityTitle(domain, identity)} will remain attached to past expenses and point to ${candidateTitle(domain, candidate)} as the newer location.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark moved',
          onPress: async () => {
            setSaving(`moved:${candidate.id}`);
            try {
              await api.post(`/identities/place/${identity.id}/moved-to`, { target_entity_id: candidate.id });
              await onChanged();
            } catch (error) {
              Alert.alert('Could not update place history', error?.message || 'Please try again.');
            } finally {
              setSaving('');
            }
          },
        },
      ]
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIcon}><Ionicons name={domain === 'merchant' ? 'storefront-outline' : domain === 'payment' ? 'card-outline' : 'location-outline'} size={18} color={colors.text} /></View>
        <View style={styles.sectionCopy}>
          <Text style={styles.sectionTitle}>{identityTitle(domain, identity)}</Text>
          <Text style={styles.sectionMeta}>{Number(count || 0)} linked expense{Number(count || 0) === 1 ? '' : 's'}</Text>
        </View>
      </View>

      <View style={styles.fields}>
        {fields.map(([key, label]) => (
          <View key={key} style={styles.field}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TextInput
              style={styles.input}
              value={`${draft[key] || ''}`}
              onChangeText={(value) => setDraft((current) => ({ ...current, [key]: key === 'card_last4' ? value.replace(/\D/g, '').slice(0, 4) : value }))}
              autoCorrect={key !== 'card_last4'}
              keyboardType={key === 'card_last4' ? 'number-pad' : 'default'}
              maxLength={key === 'card_last4' ? 4 : undefined}
              accessibilityLabel={label}
            />
          </View>
        ))}
      </View>
      <TouchableOpacity style={styles.primaryButton} onPress={save} disabled={Boolean(saving)} accessibilityRole="button">
        {saving === 'save' ? <ActivityIndicator color={colors.textInverse} /> : <><Ionicons name="checkmark" size={18} color={colors.textInverse} /><Text style={styles.primaryText}>Save identity</Text></>}
      </TouchableOpacity>

      {domain !== 'payment' ? (
        <View style={styles.aliasBlock}>
          <Text style={styles.blockLabel}>Recognized names</Text>
          {aliases?.length ? <Text style={styles.aliasList}>{aliases.map((entry) => entry.alias_name).filter(Boolean).slice(0, 6).join(' · ')}</Text> : null}
          <View style={styles.aliasRow}>
            <TextInput style={[styles.input, styles.aliasInput]} value={alias} onChangeText={setAlias} placeholder={`Add ${domain} alias`} placeholderTextColor={colors.textDisabled} accessibilityLabel={`Add ${domain} alias`} />
            <TouchableOpacity style={styles.iconButton} onPress={addAlias} disabled={!alias.trim() || Boolean(saving)} accessibilityRole="button" accessibilityLabel="Add alias"><Ionicons name="add" size={20} color={colors.text} /></TouchableOpacity>
          </View>
        </View>
      ) : null}

      {candidates?.length ? (
        <View style={styles.mergeBlock}>
          <Text style={styles.blockLabel}>Combine with an existing identity</Text>
          {candidates.slice(0, 5).map((candidate) => (
            <View key={candidate.id} style={styles.candidateRow}>
              <View style={styles.candidateCopy}><Text style={styles.candidateTitle}>{candidateTitle(domain, candidate)}</Text><Text style={styles.candidateMeta}>{candidate.expense_count || 0} expenses</Text></View>
              {domain === 'place' ? (
                <TouchableOpacity style={styles.candidateAction} onPress={() => markMoved(candidate)} disabled={Boolean(saving)} accessibilityRole="button" accessibilityLabel="Mark as newer location">
                  {saving === `moved:${candidate.id}` ? <ActivityIndicator color={colors.textMuted} /> : <Ionicons name="arrow-forward-outline" size={18} color={colors.textMuted} />}
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.candidateAction} onPress={() => merge(candidate)} disabled={Boolean(saving)} accessibilityRole="button" accessibilityLabel="Combine identities">
                {saving === `merge:${candidate.id}` ? <ActivityIndicator color={colors.textMuted} /> : <Ionicons name="link-outline" size={18} color={colors.textMuted} />}
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
      <TouchableOpacity style={styles.separateButton} onPress={separate} disabled={Boolean(saving)} accessibilityRole="button">
        <Ionicons name="unlink-outline" size={17} color={colors.warning} />
        <Text style={styles.separateText}>This expense is a different {domain}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function MatchDetailsScreen() {
  const params = useLocalSearchParams();
  const expenseId = firstParam(params.expense_id);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!expenseId) return;
    setError('');
    try {
      const next = await api.get(`/identities/expenses/${expenseId}`, { dedupe: false });
      for (const domain of ['merchant', 'payment', 'place']) {
        if (next?.[`${domain}_identity`]) next[`${domain}_identity`].expense_id = expenseId;
      }
      setData(next);
    } catch (err) {
      setError(err?.message || 'Could not load matching details');
    } finally {
      setLoading(false);
    }
  }, [expenseId]);

  useEffect(() => { load(); }, [load]);

  const sections = useMemo(() => ['merchant', 'payment', 'place'].filter((domain) => data?.[`${domain}_identity`]), [data]);

  return (
    <>
      <Stack.Screen options={{ title: 'Matching details', headerBackTitle: 'Expense' }} />
      <DismissKeyboardScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Text style={styles.eyebrow}>Linked history</Text>
          <Text style={styles.title}>How Adlo recognizes this expense</Text>
          <Text style={styles.body}>Correct names and aliases here. Separating a bad match affects this expense without deleting its original data.</Text>
        </View>
        {loading ? <View style={styles.loading}><ActivityIndicator color={colors.textMuted} /><Text style={styles.loadingText}>Loading match evidence...</Text></View> : null}
        {error ? <InlineError title="Matching details unavailable" body={error} onAction={load} /> : null}
        {!loading && !error && sections.length === 0 ? <Text style={styles.empty}>No merchant, card, or place identity has been attached yet.</Text> : null}
        {sections.map((domain) => (
          <MatchSection
            key={`${domain}:${data[`${domain}_identity`]?.id}`}
            domain={domain}
            identity={data[`${domain}_identity`]}
            aliases={data[`${domain}_aliases`]}
            candidates={data.candidates?.[domain] || []}
            count={data[`${domain}_expense_count`]}
            onChanged={load}
          />
        ))}
      </DismissKeyboardScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: 48, gap: spacing.xl },
  intro: { gap: spacing.sm },
  eyebrow: { color: colors.textSubtle, ...typography.eyebrow },
  title: { color: colors.text, ...typography.title },
  body: { color: colors.textMuted, ...typography.body },
  loading: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  loadingText: { color: colors.textSubtle, fontSize: 13 },
  empty: { color: colors.textMuted, ...typography.body },
  section: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.lg, gap: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sectionIcon: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  sectionCopy: { flex: 1, minWidth: 0 },
  sectionTitle: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '700' },
  sectionMeta: { color: colors.textSubtle, fontSize: 12, marginTop: 2 },
  fields: { gap: spacing.md },
  field: { gap: spacing.sm },
  fieldLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  input: { minHeight: 44, color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: spacing.md, fontSize: 14 },
  primaryButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: 8, backgroundColor: colors.text },
  primaryText: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },
  aliasBlock: { gap: spacing.sm },
  blockLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  aliasList: { color: colors.textSubtle, fontSize: 12, lineHeight: 18 },
  aliasRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  aliasInput: { flex: 1 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surfaceRaised },
  mergeBlock: { gap: 0 },
  candidateRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  candidateCopy: { flex: 1, minWidth: 0 },
  candidateTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  candidateMeta: { color: colors.textSubtle, fontSize: 11, marginTop: 2 },
  candidateAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  separateButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start' },
  separateText: { color: colors.warning, fontSize: 13, fontWeight: '650' },
});
