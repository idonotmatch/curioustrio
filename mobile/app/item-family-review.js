import { useCallback, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { invalidateCacheByPrefix } from '../services/cache';
import { refreshInsightsAfterFeedback } from '../services/insightFeedbackEffects';
import { PrimaryButton, SecondaryButton } from '../components/ui/Buttons';
import { EmptyState, InlineError, SkeletonRow } from '../components/ui/States';
import { openExpenseDetail } from '../services/openExpenseDetail';
import {
  formatMatchSource,
  getCandidateSide,
  getCandidateSummary,
  getPurchaseMeta,
} from '../services/itemFamilyReviewPresentation';
import { colors, spacing, typography } from '../theme/tokens';

function PurchaseEvidence({ purchase, onOpen }) {
  const source = formatMatchSource(purchase.source_type);
  const meta = getPurchaseMeta(purchase);
  const canOpen = Boolean(purchase.expense_id);
  return (
    <TouchableOpacity
      style={styles.purchaseRow}
      onPress={() => onOpen(purchase)}
      disabled={!canOpen}
      activeOpacity={canOpen ? 0.82 : 1}
      accessibilityRole={canOpen ? 'button' : undefined}
      accessibilityLabel={canOpen ? `Open purchase from ${purchase.merchant || 'unknown merchant'}` : undefined}
    >
      <View style={styles.purchaseCopy}>
        <Text style={styles.purchaseMerchant}>{purchase.merchant || 'Unknown merchant'}</Text>
        {meta ? <Text style={styles.purchaseMeta}>{meta}</Text> : null}
        {source ? <Text style={styles.purchaseSource}>{source}</Text> : null}
      </View>
      {canOpen ? <Ionicons name="chevron-forward" size={15} color={colors.textDisabled} /> : null}
    </TouchableOpacity>
  );
}

function HistoryEvidence({ candidate, side, index, onOpenExpense }) {
  const history = getCandidateSide(candidate, side);
  const firstDate = getPurchaseMeta({ date: history.firstPurchasedAt });
  const lastDate = getPurchaseMeta({ date: history.lastPurchasedAt });
  const dateRange = history.firstPurchasedAt && history.lastPurchasedAt
    ? `${history.firstPurchasedAt === history.lastPurchasedAt ? 'Seen' : 'History'} ${history.firstPurchasedAt === history.lastPurchasedAt
      ? lastDate
      : `${firstDate} to ${lastDate}`}`
    : null;
  return (
    <View style={styles.history}>
      <View style={styles.historyHeading}>
        <View style={[styles.historyMarker, index === 1 && styles.historyMarkerSecond]}>
          <Text style={styles.historyMarkerText}>{index === 0 ? 'A' : 'B'}</Text>
        </View>
        <View style={styles.historyTitleCopy}>
          <Text style={styles.identityLabel}>{history.label}</Text>
          <Text style={styles.identityMeta}>
            {[
              history.count ? `${history.count} purchase${history.count === 1 ? '' : 's'}` : null,
              history.merchants.slice(0, 2).join(', ') || null,
              dateRange,
            ].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
      {history.purchases.length ? (
        <View style={styles.purchaseList}>
          {history.purchases.map((purchase, purchaseIndex) => (
            <PurchaseEvidence
              key={`${purchase.expense_id || purchase.date || 'purchase'}:${purchaseIndex}`}
              purchase={purchase}
              onOpen={onOpenExpense}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function CandidateRow({ candidate, reviewing, onReview, onOpenExpense }) {
  const summary = getCandidateSummary(candidate);
  return (
    <View style={styles.candidate}>
      <View style={styles.candidateHeading}>
        <View style={styles.matchIcon}>
          <Ionicons name="git-compare-outline" size={17} color={colors.info} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>{summary.eyebrow}</Text>
          <Text style={styles.familyName}>Same product?</Text>
          <Text style={styles.matchImpact}>Combining these histories improves price and timing comparisons.</Text>
        </View>
      </View>

      <View style={styles.histories}>
        {['left', 'right'].map((side, index) => (
          <HistoryEvidence
            key={side}
            candidate={candidate}
            side={side}
            index={index}
            onOpenExpense={onOpenExpense}
          />
        ))}
      </View>

      <View style={styles.actions}>
        <SecondaryButton
          title="Keep separate"
          onPress={() => onReview(candidate, 'different')}
          disabled={reviewing}
          style={styles.action}
          accessibilityLabel={`Keep ${candidate.left_label} and ${candidate.right_label} separate`}
        />
        <PrimaryButton
          title="Same item"
          icon="checkmark"
          onPress={() => onReview(candidate, 'same')}
          loading={reviewing}
          style={styles.action}
          accessibilityLabel={`Confirm ${candidate.left_label} and ${candidate.right_label} are the same item family`}
        />
      </View>
    </View>
  );
}

export default function ItemFamilyReviewScreen() {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reviewingId, setReviewingId] = useState(null);
  const [lastReview, setLastReview] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const result = await api.get('/recurring/item-family-suggestions?limit=12');
      setSuggestions(Array.isArray(result) ? result : []);
    } catch (err) {
      setError(err?.message || 'Could not load possible matches');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  async function review(candidate, decision) {
    if (!candidate?.id || reviewingId) return;
    setReviewingId(candidate.id);
    setError('');
    try {
      await api.post(`/recurring/item-family-suggestions/${encodeURIComponent(candidate.id)}/review`, { decision });
      setSuggestions((current) => current.filter((item) => item.id !== candidate.id));
      setLastReview({ candidate, decision });
      await Promise.all([
        invalidateCacheByPrefix('cache:item-trends:'),
        invalidateCacheByPrefix('cache:recurring-item:'),
        refreshInsightsAfterFeedback(),
      ]);
    } catch (err) {
      setError(err?.message || 'Could not save this match');
    } finally {
      setReviewingId(null);
    }
  }

  async function undoLastReview() {
    const candidate = lastReview?.candidate;
    if (!candidate?.id || reviewingId) return;
    setReviewingId(candidate.id);
    setError('');
    try {
      await api.post(`/recurring/item-family-suggestions/${encodeURIComponent(candidate.id)}/review`, { decision: 'undo' });
      setSuggestions((current) => [candidate, ...current.filter((item) => item.id !== candidate.id)]);
      setLastReview(null);
      await Promise.all([
        invalidateCacheByPrefix('cache:item-trends:'),
        invalidateCacheByPrefix('cache:recurring-item:'),
        refreshInsightsAfterFeedback(),
      ]);
    } catch (err) {
      setError(err?.message || 'Could not undo this match');
    } finally {
      setReviewingId(null);
    }
  }

  function handleOpenExpense(purchase) {
    openExpenseDetail(router, {
      id: purchase.expense_id,
      merchant: purchase.merchant,
      amount: purchase.expense_amount,
      date: purchase.date,
      source: purchase.source_type,
    });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Review item matches', headerBackTitle: 'Item trends' }} />
      <FlatList
        data={suggestions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <CandidateRow
            candidate={item}
            reviewing={reviewingId === item.id}
            onReview={review}
            onOpenExpense={handleOpenExpense}
          />
        )}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load({ refresh: true })}
            tintColor={colors.text}
          />
        )}
        contentContainerStyle={styles.content}
        ListHeaderComponent={(
          <View style={styles.header}>
            <Text style={styles.intro}>Compare the purchase evidence, then decide whether two receipt labels belong to one product history.</Text>
            {lastReview ? (
              <View style={styles.savedBanner}>
                <Ionicons name="checkmark-circle-outline" size={18} color={colors.success} />
                <Text style={styles.savedText}>
                  {lastReview.decision === 'same' ? 'Match saved' : 'Items kept separate'}
                </Text>
                <TouchableOpacity
                  onPress={undoLastReview}
                  disabled={Boolean(reviewingId)}
                  style={styles.undoButton}
                  accessibilityRole="button"
                  accessibilityLabel="Undo last item match review"
                >
                  <Text style={styles.undoText}>Undo</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {error && suggestions.length > 0 ? (
              <InlineError
                title="Match was not saved"
                body={error}
                onAction={() => load({ refresh: true })}
              />
            ) : null}
          </View>
        )}
        ListEmptyComponent={loading ? (
          <View style={styles.skeletons}>
            <SkeletonRow lines={3} />
            <SkeletonRow lines={3} />
          </View>
        ) : error ? (
          <InlineError
            title="Could not load possible matches"
            body={error}
            onAction={() => load({ refresh: true })}
          />
        ) : (
          <EmptyState
            icon="checkmark-circle-outline"
            title="No matches to review"
            body="New matches appear as your receipt history grows."
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 48 },
  header: { gap: spacing.md, paddingBottom: spacing.lg },
  intro: { color: colors.textMuted, ...typography.body },
  candidate: {
    paddingVertical: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    gap: spacing.md,
  },
  candidateHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  matchIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.infoMuted,
    borderWidth: 1,
    borderColor: colors.infoBorder,
  },
  headingCopy: { flex: 1, gap: 2 },
  eyebrow: { color: colors.textSubtle, ...typography.eyebrow },
  familyName: { color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: '750' },
  matchImpact: { color: colors.textMuted, ...typography.bodySmall, paddingTop: 2 },
  histories: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  history: { paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, gap: spacing.md },
  historyHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  historyMarker: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.infoMuted,
    borderWidth: 1,
    borderColor: colors.infoBorder,
  },
  historyMarkerSecond: { backgroundColor: colors.successMuted, borderColor: colors.successBorder },
  historyMarkerText: { color: colors.text, fontSize: 11, fontWeight: '800' },
  historyTitleCopy: { flex: 1, minWidth: 0, gap: 3 },
  identityLabel: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  identityMeta: { color: colors.textSubtle, ...typography.bodySmall },
  purchaseList: { marginLeft: 36, borderLeftWidth: 1, borderLeftColor: colors.border },
  purchaseRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  purchaseCopy: { flex: 1, minWidth: 0, gap: 2 },
  purchaseMerchant: { color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '700' },
  purchaseMeta: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  purchaseSource: { color: colors.textSubtle, fontSize: 11, lineHeight: 15 },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.xs },
  action: { flex: 1, minWidth: 0, paddingHorizontal: spacing.sm },
  skeletons: { gap: spacing.md },
  savedBanner: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.successBorder,
    borderRadius: 8,
    backgroundColor: colors.successMuted,
  },
  savedText: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '700' },
  undoButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xs },
  undoText: { color: colors.success, fontSize: 13, fontWeight: '750' },
});
