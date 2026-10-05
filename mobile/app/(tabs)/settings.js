import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { useRecurring } from '../../hooks/useRecurring';
import { DismissKeyboardScrollView } from '../../components/DismissKeyboardScrollView';
import { INTERNAL_TOOLS_ENABLED } from '../../services/internalTools';
import { FRESHNESS_DOMAINS, markFreshnessStale } from '../../services/freshnessRegistry';
import { colors } from '../../theme/tokens';
import { InlineError } from '../../components/ui/States';

export default function SettingsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const { recurring, loading: recurringLoading, refresh: refreshRecurring } = useRecurring();

  const [budgetLimit, setBudgetLimit] = useState('');
  const [currentBudget, setCurrentBudget] = useState(null);
  const [budgetLoadError, setBudgetLoadError] = useState('');
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetMsg, setBudgetMsg] = useState('');
  const [budgetMsgIsError, setBudgetMsgIsError] = useState(false);
  const [pendingSuggestionsCount, setPendingSuggestionsCount] = useState(null);
  const [gmailStatus, setGmailStatus] = useState(null);
  const [gmailStatusState, setGmailStatusState] = useState('loading');
  const gmailNeedsAttention = gmailStatus?.connected
    && ['failed', 'partial'].includes(gmailStatus.last_sync_status);
  const budgetDirty = currentBudget?.limit == null
    ? Boolean(`${budgetLimit}`.trim())
    : Number(budgetLimit) !== Number(currentBudget.limit);
  const healthItems = [
    gmailStatusState === 'loading' ? 'Checking Gmail' : gmailStatusState === 'error' ? 'Gmail status unavailable' : gmailNeedsAttention ? 'Gmail needs attention' : gmailStatus?.connected ? 'Gmail connected' : 'Gmail needs setup',
    pendingSuggestionsCount == null ? 'Checking categories' : pendingSuggestionsCount < 0 ? 'Category status unavailable' : pendingSuggestionsCount > 0 ? `${pendingSuggestionsCount} category suggestion${pendingSuggestionsCount === 1 ? '' : 's'}` : 'Categories clear',
    recurringLoading ? 'Checking recurring' : recurring.length > 0 ? `${recurring.length} recurring expense${recurring.length === 1 ? '' : 's'}` : 'No recurring flags',
  ];

  const loadBudget = useCallback(async () => {
    try {
      const data = await api.get('/budgets?scope=personal');
      setCurrentBudget(data.total);
      setBudgetLoadError('');
      if (data.total?.limit) setBudgetLimit(String(data.total.limit));
    } catch (error) {
      setBudgetLoadError(error?.message || 'Could not load your budget.');
    }
  }, []);

  useEffect(() => {
    loadBudget();
  }, [loadBudget]);

  useEffect(() => {
    api.get('/categories')
      .then(d => setPendingSuggestionsCount(d.pending_suggestions_count || 0))
      .catch(() => setPendingSuggestionsCount(-1));
    api.get('/gmail/status')
      .then(d => {
        setGmailStatus(d || null);
        setGmailStatusState('ready');
      })
      .catch(() => {
        setGmailStatus(null);
        setGmailStatusState('error');
      });
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
      markFreshnessStale([
        FRESHNESS_DOMAINS.budget,
        FRESHNESS_DOMAINS.insights,
        FRESHNESS_DOMAINS.forecastMovement,
      ], { reason: 'budget_changed' });
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
      markFreshnessStale([
        FRESHNESS_DOMAINS.recurring,
        FRESHNESS_DOMAINS.insights,
      ], { reason: 'recurring_deleted' });
      refreshRecurring();
    } catch { /* ignore */ }
  }

  return (
    <DismissKeyboardScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      {params.welcome === 'budget' ? (
        <View style={styles.welcomeCard}>
          <Text style={styles.welcomeEyebrow}>Good first move</Text>
          <Text style={styles.welcomeTitle}>Pick a monthly budget.</Text>
          <Text style={styles.welcomeBody}>
            This gives Adlo something concrete to pace against before you have much history.
          </Text>
        </View>
      ) : null}

      <View style={styles.screenHeader}>
        <Text style={styles.eyebrow}>Settings</Text>
        <Text style={styles.screenTitle}>Control panel</Text>
        <Text style={styles.screenSubtitle}>Budget, import, and notification settings that keep Adlo current.</Text>
        <View style={styles.healthStrip}>
          {healthItems.map((item) => (
            <View key={item} style={styles.healthPill}>
              <View style={[
                styles.healthDot,
                item.includes('needs') || item.includes('suggestion') || item.includes('unavailable')
                  ? styles.healthDotAttention
                  : null,
              ]} />
              <Text style={styles.healthText} numberOfLines={1}>{item}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Budget */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>BUDGET</Text>
        <View style={styles.budgetRow}>
          <View style={styles.budgetRowLeft}>
            <Text style={styles.navRowText}>Monthly budget</Text>
          </View>
          <View style={styles.budgetRowRight}>
            <View style={styles.budgetInputShell}>
              <Text style={styles.budgetPrefix}>$</Text>
              <TextInput
                style={styles.budgetInput}
                value={budgetLimit}
                onChangeText={setBudgetLimit}
                placeholder="2000"
                placeholderTextColor={colors.textDisabled}
                keyboardType="numeric"
              />
            </View>
            <TouchableOpacity
              style={[styles.inlineSaveButton, (!budgetDirty || budgetSaving) && styles.buttonDisabled]}
              onPress={saveBudget}
              disabled={!budgetDirty || budgetSaving}
            >
              <Text style={styles.inlineSaveText}>{budgetSaving ? 'Saving' : budgetDirty ? 'Save' : 'Saved'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {budgetMsg ? <Text style={budgetMsgIsError ? styles.msgError : styles.msgText}>{budgetMsg}</Text> : null}
        {budgetLoadError ? (
          <InlineError
            title="Could not load budget"
            body={budgetLoadError}
            actionLabel="Try again"
            onAction={loadBudget}
            style={{ marginTop: 12 }}
          />
        ) : null}

        <TouchableOpacity style={styles.navRow} onPress={() => router.push('/budget-period')}>
          <View>
            <Text style={styles.navRowText}>Budget period</Text>
            <Text style={styles.navRowSub}>Manage your personal and household reset dates</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
        </TouchableOpacity>
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
          <View>
            <Text style={styles.navRowText}>Manage accounts</Text>
            <Text style={styles.navRowSub}>Household and account access</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.navRow} onPress={() => router.push('/gmail-import')}>
          <View>
            <Text style={styles.navRowText}>Manage Gmail import</Text>
            <Text style={styles.navRowSub}>
              {gmailStatus?.connected
                ? ['failed', 'partial'].includes(gmailStatus.last_sync_status)
                  ? 'Connected, last sync needs attention'
                  : 'Connected and ready to sync receipts'
                : gmailStatusState === 'loading'
                  ? 'Checking Gmail connection'
                  : gmailStatusState === 'error'
                    ? 'Could not check Gmail connection'
                    : 'Connect Gmail to import receipt emails'}
            </Text>
          </View>
          <View style={styles.navRowRight}>
            <View style={[
              styles.statusBadge,
              gmailStatus?.connected && !gmailNeedsAttention ? styles.statusBadgeGood : styles.statusBadgeAttention,
            ]}>
              <Text style={[
                styles.statusBadgeText,
                gmailStatus?.connected && !gmailNeedsAttention ? styles.statusBadgeTextGood : styles.statusBadgeTextAttention,
              ]}>
                {gmailNeedsAttention ? 'Check' : gmailStatus?.connected ? 'On' : gmailStatusState === 'loading' ? 'Checking' : gmailStatusState === 'error' ? 'Retry' : 'Setup'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navRow} onPress={() => router.push('/payment-methods')}>
          <View>
            <Text style={styles.navRowText}>Saved card labels</Text>
            <Text style={styles.navRowSub}>Name cards for cleaner review context</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>NOTIFICATIONS</Text>
        <TouchableOpacity style={styles.navRow} onPress={() => router.push('/notifications')}>
          <View>
            <Text style={styles.navRowText}>Manage notifications</Text>
            <Text style={styles.navRowSub}>Choose which nudges are worth interrupting you for</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
        </TouchableOpacity>
      </View>

      {INTERNAL_TOOLS_ENABLED ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>INTERNAL TOOLS</Text>
          <TouchableOpacity style={styles.navRow} onPress={() => router.push('/diagnostics')}>
            <View>
              <Text style={styles.navRowText}>Diagnostics</Text>
              <Text style={styles.navRowSub}>Check imports, insight surfacing, sync health, and recent failures</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Categories */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>CATEGORIES</Text>
        <TouchableOpacity style={styles.navRow} onPress={() => router.push('/categories')}>
          <View>
            <Text style={styles.navRowText}>Edit category details</Text>
            <Text style={styles.navRowSub}>
              {pendingSuggestionsCount > 0
                ? `${pendingSuggestionsCount} suggestion${pendingSuggestionsCount === 1 ? '' : 's'} waiting`
                : pendingSuggestionsCount == null
                  ? 'Checking category status'
                  : pendingSuggestionsCount < 0
                    ? 'Could not check category status'
                : 'Names and hierarchy are up to date'}
            </Text>
          </View>
          <View style={styles.navRowRight}>
            {pendingSuggestionsCount > 0 ? (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{pendingSuggestionsCount}</Text>
              </View>
            ) : null}
            <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
          </View>
        </TouchableOpacity>
      </View>

    </DismissKeyboardScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 40 },
  screenHeader: { marginBottom: 28 },
  eyebrow: { color: colors.textSubtle, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  screenTitle: { color: colors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5, marginBottom: 8 },
  screenSubtitle: { color: colors.textSubtle, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  healthStrip: { gap: 8 },
  healthPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  healthDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  healthDotAttention: { backgroundColor: colors.warning },
  healthText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  welcomeCard: {
    marginBottom: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  welcomeEyebrow: {
    color: colors.textSubtle,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  welcomeTitle: { color: colors.text, fontSize: 21, fontWeight: '700', marginBottom: 8 },
  welcomeBody: { color: colors.textSubtle, fontSize: 14, lineHeight: 20 },
  section: { marginBottom: 32, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, paddingBottom: 24 },
  sectionTitle: { fontSize: 12, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  subText: { color: colors.textDisabled, fontSize: 13, marginBottom: 12 },
  budgetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  budgetRowLeft: { flex: 1, paddingRight: 4 },
  budgetRowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  budgetInputShell: { width: 124, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 42 },
  budgetPrefix: { color: colors.textDisabled, fontSize: 16, marginRight: 4 },
  budgetInput: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '600', paddingVertical: 8 },
  inlineSaveButton: { minHeight: 42, minWidth: 58, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  inlineSaveText: { color: colors.background, fontSize: 14, fontWeight: '600' },
  buttonDisabled: { opacity: 0.5 },
  msgText: { color: colors.textMuted, fontSize: 13, marginTop: 10 },
  msgError: { color: colors.danger, fontSize: 13, marginTop: 10 },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  rowInfo: { flex: 1, marginRight: 12 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '500' },
  rowSub: { color: colors.textSubtle, fontSize: 14, marginTop: 2 },
  removeText: { color: colors.danger, fontSize: 14 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  navRowText: { color: colors.text, fontSize: 15 },
  navRowSub: { color: colors.textDisabled, fontSize: 13, marginTop: 2 },
  navRowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusBadge: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeGood: { backgroundColor: colors.successMuted, borderColor: colors.successBorder },
  statusBadgeAttention: { backgroundColor: colors.warningMuted, borderColor: colors.warningBorder },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  statusBadgeTextGood: { color: colors.success },
  statusBadgeTextAttention: { color: colors.warning },
  countBadge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: colors.warningMuted, borderWidth: 1, borderColor: colors.warningBorder, alignItems: 'center', justifyContent: 'center' },
  countBadgeText: { color: colors.warning, fontSize: 11, fontWeight: '700' },
});
