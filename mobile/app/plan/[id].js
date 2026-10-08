import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useHousehold } from '../../hooks/useHousehold';
import { api } from '../../services/api';
import { pushConfirmDraft } from '../../services/confirmNavigation';
import { toLocalDateString } from '../../services/date';
import { FRESHNESS_DOMAINS, markFreshnessStale } from '../../services/freshnessRegistry';
import { currency, fundingHistoryCopy, planChangeCopy, priceStatusCopy, strategyCopy } from '../../services/purchasePlanningPresentation';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Buttons';
import { colors, radius, spacing, typography } from '../../theme/tokens';

function numberInput(value) {
  return `${value || ''}`.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
}

function dateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function strategyOptions(snapshot = {}, breakdown = [], allocations = []) {
  const reservedCurrentBudget = allocations
    .filter((entry) => entry.source_type === 'current_headroom' && entry.state === 'reserved')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const reservedSources = allocations
    .filter((entry) => entry.source_type === 'funding_pool' && entry.state === 'reserved')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const currentBudget = breakdown
    .filter((entry) => entry.source_type === 'current_headroom')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), reservedCurrentBudget);
  const sources = breakdown
    .filter((entry) => entry.source_type === 'funding_pool')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), reservedSources);
  const recovery = breakdown.find((entry) => entry.source_type === 'future_recovery');
  return [
    {
      key: 'current_budget',
      icon: 'pie-chart-outline',
      title: 'Use this month’s budget',
      value: currentBudget > 0 ? currency(currentBudget) : 'No room yet',
      body: currentBudget > 0 ? 'Redirect room that is still available this period.' : 'Current spending leaves no dependable room for this path.',
      disabled: currentBudget <= 0,
    },
    {
      key: 'funding_sources',
      icon: 'wallet-outline',
      title: 'Use savings or another source',
      value: sources > 0 ? currency(sources) : 'Add a source',
      body: sources > 0 ? 'Use money you have explicitly made available to plans.' : 'Add savings or another budget you would consider using.',
      disabled: false,
    },
    {
      key: 'recover_over_time',
      icon: 'calendar-outline',
      title: 'Buy now and recover',
      value: recovery?.monthly_amount ? `${currency(recovery.monthly_amount)}/mo` : 'No gap',
      body: recovery?.months ? `Accept the overage, then offset it over ${recovery.months} months.` : 'The currently available paths already cover the estimated price.',
      disabled: !recovery,
    },
    {
      key: 'wait',
      icon: 'time-outline',
      title: 'Wait and build funding',
      value: snapshot.funding_gap > 0 ? `${currency(snapshot.funding_gap)} to build` : 'Optional',
      body: 'Keep considering without earmarking money yet.',
      disabled: false,
    },
  ];
}

export default function PlanDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { memberCount } = useHousehold();
  const isNew = id === 'new';
  const [plan, setPlan] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [allocations, setAllocations] = useState([]);
  const [history, setHistory] = useState([]);
  const [budgetOptions, setBudgetOptions] = useState([]);
  const [priceOptions, setPriceOptions] = useState([]);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [buffer, setBuffer] = useState('0');
  const [recoveryMonths, setRecoveryMonths] = useState('2');
  const [scope, setScope] = useState('personal');
  const [notes, setNotes] = useState('');
  const [productName, setProductName] = useState('');
  const [productVariant, setProductVariant] = useState('');
  const [productUrl, setProductUrl] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const [revisitOn, setRevisitOn] = useState('');
  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const [showDetails, setShowDetails] = useState(isNew);
  const [showProduct, setShowProduct] = useState(false);
  const [pendingAllocation, setPendingAllocation] = useState(null);
  const [allocationAmount, setAllocationAmount] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyAllocation, setBusyAllocation] = useState('');
  const [error, setError] = useState('');

  const hydrate = useCallback((data, { syncForm = true } = {}) => {
    const nextPlan = data?.plan || null;
    setPlan(nextPlan);
    setSnapshot(data?.snapshot || nextPlan?.latest_snapshot || null);
    setAllocations(Array.isArray(data?.allocations) ? data.allocations : []);
    setHistory(Array.isArray(data?.history) ? data.history : []);
    setBudgetOptions(Array.isArray(data?.budget_options) ? data.budget_options : []);
    setPriceOptions(Array.isArray(data?.price_options) ? data.price_options : []);
    if (nextPlan && syncForm) {
      setLabel(nextPlan.label || '');
      setAmount(`${nextPlan.estimated_amount || ''}`);
      setBuffer(`${nextPlan.minimum_buffer || 0}`);
      setRecoveryMonths(`${nextPlan.recovery_months || 2}`);
      setScope(nextPlan.scope || 'personal');
      setNotes(nextPlan.notes || '');
      setProductName(nextPlan.offer_watch?.metadata?.product_name || (nextPlan.offer_watch ? nextPlan.label : ''));
      setProductVariant(nextPlan.offer_watch?.variant?.description || '');
      setProductUrl(nextPlan.offer_watch?.url || '');
      setTargetPrice(nextPlan.offer_watch?.target_price
        ? `${nextPlan.offer_watch.target_price}`
        : nextPlan.decision_criteria?.target_price ? `${nextPlan.decision_criteria.target_price}` : '');
      setDecisionNote(nextPlan.decision_criteria?.note || '');
      setRevisitOn(nextPlan.revisit_on ? `${nextPlan.revisit_on}`.slice(0, 10) : '');
      setSelectedStrategy(nextPlan.selected_strategy || null);
      setShowProduct(Boolean(nextPlan.offer_watch));
    }
  }, []);

  const load = useCallback(async () => {
    if (isNew) return;
    try {
      setLoading(true);
      setError('');
      const cached = await api.get(`/plans/${id}`, { dedupe: false });
      hydrate(cached);
      setLoading(false);
      setRefreshing(true);
      try {
        hydrate(await api.post(`/plans/${id}/evaluate`, {}), { syncForm: false });
      } catch {
        // The cached plan remains usable if a fresh projection is temporarily unavailable.
      } finally {
        setRefreshing(false);
      }
    } catch (err) {
      setError(err?.message || 'Could not load this plan.');
      setLoading(false);
    }
  }, [hydrate, id, isNew]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const strategy = useMemo(() => strategyCopy(snapshot || {}), [snapshot]);
  const breakdown = Array.isArray(snapshot?.funding_breakdown) ? snapshot.funding_breakdown : [];
  const options = useMemo(() => strategyOptions(snapshot || {}, breakdown, allocations), [allocations, breakdown, snapshot]);

  function markPlansStale(reason) {
    markFreshnessStale([FRESHNESS_DOMAINS.watchedPlans], { reason });
  }

  async function savePlan() {
    const estimatedAmount = Number(amount);
    if (!label.trim() || !(estimatedAmount > 0)) {
      setError('Add a name and an estimated price.');
      return;
    }
    if (revisitOn.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(revisitOn.trim())) {
      setError('Use YYYY-MM-DD for the revisit date.');
      return;
    }
    if (productUrl.trim()) {
      try {
        const parsed = new URL(productUrl.trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid');
      } catch {
        setError('Add a valid http or https product link.');
        return;
      }
    }
    if (productUrl.trim() && !productName.trim()) {
      setError('Add the exact product or model so Adlo can compare the same item across sellers.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      const body = {
        label: label.trim(),
        estimated_amount: estimatedAmount,
        scope,
      };
      if (!isNew) {
        Object.assign(body, {
          minimum_buffer: Math.max(0, Number(buffer) || 0),
          recovery_months: Math.max(1, Math.min(6, Number(recoveryMonths) || 2)),
          notes: notes.trim() || null,
          selected_strategy: selectedStrategy,
          decision_criteria: {
            note: decisionNote.trim() || null,
            target_price: Number(targetPrice) > 0 ? Number(targetPrice) : null,
          },
          revisit_on: revisitOn.trim() || null,
        });
      }
      if (productName.trim() || productUrl.trim() || plan?.offer_watch) {
        body.product_watch = {
          product_name: productName.trim() || null,
          variant_description: productVariant.trim() || null,
          url: productUrl.trim() || null,
          target_price: Number(targetPrice) > 0 ? Number(targetPrice) : null,
          enabled: Boolean(productName.trim()),
          source_preference: 'best_available',
        };
      }
      const data = isNew ? await api.post('/plans', body) : await api.patch(`/plans/${id}`, body);
      markPlansStale(isNew ? 'purchase_plan_created' : 'purchase_plan_updated');
      if (isNew) {
        router.replace(`/plan/${data.plan.id}`);
        return;
      }
      hydrate(data, { syncForm: false });
      setShowDetails(false);
    } catch (err) {
      setError(err?.message || 'Could not save this plan.');
    } finally {
      setSaving(false);
    }
  }

  async function chooseStrategy(value) {
    if (!plan?.id || saving) return;
    const previous = selectedStrategy;
    setSelectedStrategy(value);
    try {
      setSaving(true);
      const data = await api.patch(`/plans/${id}`, { selected_strategy: value });
      hydrate(data, { syncForm: false });
      markPlansStale('purchase_plan_strategy_updated');
    } catch (err) {
      setSelectedStrategy(previous);
      setError(err?.message || 'Could not save that funding path.');
    } finally {
      setSaving(false);
    }
  }

  function beginEarmark(entry, index) {
    setPendingAllocation({ ...entry, key: `${entry.source_type}-${entry.pool_id || index}` });
    setAllocationAmount(`${Number(entry.amount || 0).toFixed(2)}`);
  }

  async function confirmEarmark() {
    const earmarkAmount = Number(allocationAmount);
    if (!pendingAllocation || !(earmarkAmount > 0) || earmarkAmount > Number(pendingAllocation.amount || 0)) {
      setError(`Choose an amount up to ${currency(pendingAllocation?.amount || 0)}.`);
      return;
    }
    try {
      setBusyAllocation(pendingAllocation.key);
      setError('');
      const data = await api.post(`/plans/${id}/allocations`, {
        source_type: pendingAllocation.source_type,
        pool_id: pendingAllocation.pool_id || null,
        amount: earmarkAmount,
      });
      hydrate(data, { syncForm: false });
      setPendingAllocation(null);
      markPlansStale('purchase_plan_funding_earmarked');
    } catch (err) {
      setError(err?.message || 'Could not earmark this amount.');
    } finally {
      setBusyAllocation('');
    }
  }

  async function release(allocation) {
    try {
      setBusyAllocation(allocation.id);
      hydrate(await api.delete(`/plans/${id}/allocations/${allocation.id}`), { syncForm: false });
      markPlansStale('purchase_plan_funding_released');
    } catch (err) {
      setError(err?.message || 'Could not release this earmark.');
    } finally {
      setBusyAllocation('');
    }
  }

  async function setState(state) {
    const labels = {
      ready: 'Mark this plan ready?',
      considering: 'Move this back to consideration?',
      abandoned: 'Pass on this purchase?',
      deferred: 'Pause this plan?',
    };
    Alert.alert(labels[state], state === 'abandoned' ? 'The plan will move to history.' : 'You can change this later.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Continue', style: state === 'abandoned' ? 'destructive' : 'default', onPress: async () => {
        try {
          await api.patch(`/plans/${id}`, { state });
          markPlansStale('purchase_plan_state_updated');
          router.replace('/plans');
        } catch (err) {
          setError(err?.message || 'Could not update this plan.');
        }
      } },
    ]);
  }

  function logPurchase() {
    pushConfirmDraft(router, {
      merchant: plan?.label || label,
      description: plan?.label || label,
      amount: Number(snapshot?.observed_price || plan?.estimated_amount || amount),
      date: toLocalDateString(),
      source: 'manual',
      purchase_plan_id: plan?.id,
    });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.loadingSkeleton}><View style={styles.skeletonHero} /><View style={styles.skeletonBand} /><View style={styles.skeletonBand} /></View>
      </SafeAreaView>
    );
  }

  if (!isNew && !plan) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.error}>{error || 'This plan is unavailable.'}</Text>
        <SecondaryButton title="Back to planning" onPress={() => router.replace('/plans')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.heroTitleRow}>
            <View style={styles.heroCopy}>
              <Text style={styles.eyebrow}>{isNew ? 'New consideration' : plan?.state === 'deferred' ? 'Paused' : plan?.state}</Text>
              <Text style={styles.title}>{isNew ? 'What are you considering?' : plan?.label}</Text>
            </View>
            {!isNew && refreshing ? <ActivityIndicator color={colors.textMuted} size="small" /> : null}
          </View>
          <Text style={styles.subtitle}>{isNew ? 'A name and rough price are enough to begin.' : 'See what it would take, choose a path, and decide when it feels right.'}</Text>
        </View>

        {isNew ? (
          <View style={styles.section}>
            <View style={styles.field}>
              <Text style={styles.label}>Purchase</Text>
              <TextInput style={styles.input} value={label} onChangeText={setLabel} placeholder="New laptop" placeholderTextColor={colors.textDisabled} autoFocus />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Rough price</Text>
              <TextInput style={styles.input} value={amount} onChangeText={(value) => setAmount(numberInput(value))} keyboardType="decimal-pad" placeholder="900" placeholderTextColor={colors.textDisabled} />
            </View>
            {memberCount > 1 ? (
              <View style={styles.segmented}>
                {['personal', 'household'].map((value) => (
                  <TouchableOpacity key={value} style={[styles.segment, scope === value && styles.segmentActive]} onPress={() => setScope(value)}>
                    <Text style={[styles.segmentText, scope === value && styles.segmentTextActive]}>{value === 'personal' ? 'Mine' : 'Household'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <TouchableOpacity style={styles.disclosureRow} onPress={() => setShowProduct((value) => {
              if (!value && !productName.trim()) setProductName(label.trim());
              return !value;
            })}>
              <Ionicons name="pricetag-outline" size={18} color={colors.textMuted} />
              <Text style={styles.disclosureText}>{showProduct ? 'Hide product details' : 'Watch an exact product'}</Text>
              <Ionicons name={showProduct ? 'chevron-up' : 'chevron-down'} size={17} color={colors.textSubtle} />
            </TouchableOpacity>
            {showProduct ? (
              <View style={styles.detailFields}>
                <View style={styles.field}><Text style={styles.label}>Exact product or model</Text><TextInput style={styles.input} value={productName} onChangeText={setProductName} placeholder="Apple MacBook Air 13-inch M4" placeholderTextColor={colors.textDisabled} /></View>
                <View style={styles.field}><Text style={styles.label}>Variant or specs</Text><TextInput style={styles.input} value={productVariant} onChangeText={setProductVariant} placeholder="16GB / 512GB / Midnight" placeholderTextColor={colors.textDisabled} /></View>
                <View style={styles.field}><Text style={styles.label}>Target price (optional)</Text><TextInput style={styles.input} value={targetPrice} onChangeText={(value) => setTargetPrice(numberInput(value))} keyboardType="decimal-pad" placeholder="850" placeholderTextColor={colors.textDisabled} /></View>
                <View style={styles.field}><Text style={styles.label}>Reference offer (optional)</Text><TextInput style={styles.input} value={productUrl} onChangeText={setProductUrl} autoCapitalize="none" keyboardType="url" placeholder="https://..." placeholderTextColor={colors.textDisabled} /><Text style={styles.fieldHint}>The link helps identify the item but does not limit comparisons to that seller.</Text></View>
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PrimaryButton title="Start considering" loading={saving} onPress={savePlan} />
          </View>
        ) : (
          <>
            {snapshot ? (
              <View style={styles.recommendation}>
                <View style={styles.recommendationTop}>
                  <View style={styles.recommendationCopy}>
                    <Text style={styles.strategyTitle}>{strategy.title}</Text>
                    <Text style={styles.strategyBody}>{strategy.body}</Text>
                  </View>
                  <Text style={styles.metric}>{currency(snapshot.evaluated_amount)}</Text>
                </View>
                {planChangeCopy(snapshot) ? <Text style={styles.change}>{planChangeCopy(snapshot)}</Text> : null}
                <View style={styles.metrics}>
                  <View style={styles.metricCell}><Text style={styles.metricLabel}>Could cover</Text><Text style={styles.metricValue}>{currency(snapshot.funded_amount)}</Text></View>
                  <View style={styles.metricCell}><Text style={styles.metricLabel}>Earmarked</Text><Text style={styles.metricValue}>{currency(snapshot.reserved_amount)}</Text></View>
                  <View style={styles.metricCell}><Text style={styles.metricLabel}>Still open</Text><Text style={styles.metricValue}>{currency(snapshot.funding_gap)}</Text></View>
                </View>
              </View>
            ) : null}

            {error ? (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                <Text style={styles.errorBannerText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.section}>
              <View style={styles.sectionHeadingRow}>
                <View style={styles.headingCopy}>
                  <Text style={styles.sectionTitle}>How would you pay for it?</Text>
                  <Text style={styles.sectionBody}>Save the path you are leaning toward. Adlo will keep comparing it with the other options.</Text>
                </View>
              </View>
              <View style={styles.optionList}>
                {options.map((option) => {
                  const active = selectedStrategy === option.key;
                  const recommended = (
                    (snapshot?.recommended_strategy === 'funded_now' && option.key === 'current_budget')
                    || (snapshot?.recommended_strategy === 'use_savings' && option.key === 'funding_sources')
                    || (snapshot?.recommended_strategy === 'rebalance_and_recover' && option.key === 'recover_over_time')
                    || (snapshot?.recommended_strategy === 'wait_and_save' && option.key === 'wait')
                  );
                  return (
                    <TouchableOpacity key={option.key} style={[styles.optionRow, active && styles.optionRowActive, option.disabled && styles.disabled]} onPress={() => !option.disabled && chooseStrategy(option.key)} disabled={option.disabled || saving}>
                      <View style={styles.optionIcon}><Ionicons name={option.icon} size={18} color={active ? colors.text : colors.textMuted} /></View>
                      <View style={styles.optionCopy}><View style={styles.optionTitleRow}><Text style={styles.optionTitle}>{option.title}</Text>{recommended ? <Text style={styles.recommended}>Adlo’s view</Text> : null}</View><Text style={styles.optionBody}>{option.body}</Text></View>
                      <View style={styles.optionValueWrap}><Text style={styles.optionValue}>{option.value}</Text><Ionicons name={active ? 'checkmark-circle' : 'chevron-forward'} size={18} color={active ? colors.success : colors.textSubtle} /></View>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {budgetOptions.length > 0 ? (
                <View style={styles.budgetContext}>
                  <Text style={styles.label}>Possible room to redirect</Text>
                  <Text style={styles.sectionBody}>These explain existing budget room; they are not extra money.</Text>
                  {budgetOptions.map((item) => <View key={item.category_id} style={styles.compactRow}><Text style={styles.compactName}>{item.name}</Text><Text style={styles.compactAmount}>{currency(item.remaining)} remaining</Text></View>)}
                </View>
              ) : null}
            </View>

            {snapshot ? (
              <View style={styles.section}>
                <View style={styles.sectionHeadingRow}>
                  <View style={styles.headingCopy}><Text style={styles.sectionTitle}>Earmark funding</Text><Text style={styles.sectionBody}>Earmarking only coordinates your plans. Adlo does not move money.</Text></View>
                  <TouchableOpacity style={styles.sourcesIcon} onPress={() => router.push('/funding-pools')} accessibilityLabel="Manage funding sources"><Ionicons name="wallet-outline" size={18} color={colors.text} /></TouchableOpacity>
                </View>
                <View style={styles.sourceList}>
                  {breakdown.filter((entry) => entry.source_type !== 'future_recovery').map((entry, index) => (
                    <View key={`${entry.source_type}-${entry.pool_id || index}`} style={styles.sourceRow}>
                      <View style={styles.sourceCopy}><Text style={styles.sourceName}>{entry.label}</Text>{entry.replenishment_required ? <Text style={styles.sourceMeta}>Replenish after use</Text> : null}</View>
                      <Text style={styles.sourceAmount}>{currency(entry.amount)}</Text>
                      {entry.reservable ? <TouchableOpacity style={styles.earmarkButton} onPress={() => beginEarmark(entry, index)} disabled={Boolean(busyAllocation)}><Text style={styles.earmarkText}>Earmark</Text></TouchableOpacity> : null}
                    </View>
                  ))}
                </View>
                {pendingAllocation ? (
                  <View style={styles.earmarkEditor}>
                    <View style={styles.headingCopy}><Text style={styles.sourceName}>Earmark from {pendingAllocation.label}</Text><Text style={styles.sourceMeta}>Up to {currency(pendingAllocation.amount)}</Text></View>
                    <TextInput style={styles.amountInput} value={allocationAmount} onChangeText={(value) => setAllocationAmount(numberInput(value))} keyboardType="decimal-pad" />
                    <PrimaryButton title="Confirm" loading={busyAllocation === pendingAllocation.key} onPress={confirmEarmark} style={styles.confirmButton} />
                    <TouchableOpacity style={styles.cancelIcon} onPress={() => setPendingAllocation(null)} accessibilityLabel="Cancel earmark"><Ionicons name="close" size={20} color={colors.textMuted} /></TouchableOpacity>
                  </View>
                ) : null}
                {allocations.some((item) => item.state === 'reserved') ? (
                  <View style={styles.reservedList}>
                    <Text style={styles.label}>Earmarked in Adlo</Text>
                    {allocations.filter((item) => item.state === 'reserved').map((allocation) => (
                      <View key={allocation.id} style={styles.reservedRow}>
                        <Text style={styles.compactName}>{allocation.pool_name || (allocation.source_type === 'current_headroom' ? 'Current budget room' : 'Funding source')}</Text>
                        <Text style={styles.compactAmount}>{currency(allocation.amount)}</Text>
                        <TouchableOpacity style={styles.removeButton} onPress={() => release(allocation)} disabled={Boolean(busyAllocation)} accessibilityLabel="Release earmarked funding"><Ionicons name="close-circle-outline" size={22} color={colors.textMuted} /></TouchableOpacity>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.section}>
              <View style={styles.headingCopy}>
                <Text style={styles.sectionTitle}>Product and price watch</Text>
                <Text style={styles.sectionBody}>Match the exact model across merchants. A reference link helps with identity but never limits the comparison to that seller.</Text>
              </View>
              <View style={styles.field}><Text style={styles.label}>Exact product or model</Text><TextInput style={styles.input} value={productName} onChangeText={setProductName} placeholder="Apple MacBook Air 13-inch M4" placeholderTextColor={colors.textDisabled} /></View>
              <View style={styles.field}><Text style={styles.label}>Variant or specs</Text><TextInput style={styles.input} value={productVariant} onChangeText={setProductVariant} placeholder="16GB / 512GB / Midnight" placeholderTextColor={colors.textDisabled} /></View>
              <View style={styles.field}><Text style={styles.label}>Target price (optional)</Text><TextInput style={styles.input} value={targetPrice} onChangeText={(value) => setTargetPrice(numberInput(value))} keyboardType="decimal-pad" placeholder="850" placeholderTextColor={colors.textDisabled} /></View>
              <View style={styles.field}><Text style={styles.label}>Reference offer (optional)</Text><TextInput style={styles.input} value={productUrl} onChangeText={setProductUrl} autoCapitalize="none" keyboardType="url" placeholder="https://..." placeholderTextColor={colors.textDisabled} /><Text style={styles.fieldHint}>Prices update as matching observations from other merchants enter Adlo.</Text></View>
              {plan?.offer_watch ? <Text style={styles.priceStatus}>{priceStatusCopy(plan.offer_watch, snapshot || {})}</Text> : null}
              {priceOptions.length > 0 ? (
                <View style={styles.offerList}>
                  <Text style={styles.label}>{priceOptions.length > 1 ? 'Best observed offers' : 'Observed offer'}</Text>
                  {priceOptions.slice(0, 3).map((offer, index) => (
                    <View key={`${offer.merchant}-${offer.url || index}`} style={styles.offerRow}>
                      <View style={styles.offerCopy}><Text style={styles.offerMerchant}>{offer.merchant || 'Unknown seller'}</Text><Text style={styles.offerMeta}>{dateLabel(offer.observed_at)}{index === 0 ? ' · Best observed' : ''}</Text></View>
                      <Text style={styles.offerPrice}>{currency(offer.price, 2)}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <PrimaryButton title={plan?.offer_watch ? 'Update price watch' : 'Start price watch'} loading={saving} onPress={savePlan} disabled={!productName.trim()} />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>What would make this a yes?</Text>
              <TextInput style={[styles.input, styles.notes]} value={decisionNote} onChangeText={setDecisionNote} placeholder="Fully funded, a lower price, or a clear need" placeholderTextColor={colors.textDisabled} multiline />
              <View style={styles.field}><Text style={styles.label}>Revisit on</Text><TextInput style={styles.input} value={revisitOn} onChangeText={setRevisitOn} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textDisabled} /></View>
              <PrimaryButton title="Save decision criteria" loading={saving} onPress={savePlan} />
            </View>

            {fundingHistoryCopy(history) ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>While you considered it</Text>
                <Text style={styles.historyLead}>{fundingHistoryCopy(history)}</Text>
                <View style={styles.timeline}>
                  {history.slice(0, 4).map((entry, index) => (
                    <View key={entry.id || `${entry.created_at}-${index}`} style={styles.timelineRow}>
                      <View style={[styles.timelineDot, index === 0 && styles.timelineDotActive]} />
                      <View style={styles.timelineCopy}><Text style={styles.timelineTitle}>{entry.material_change === 'initial' ? 'Plan started' : entry.material_change === 'improved' ? 'Funding improved' : entry.material_change === 'worsened' ? 'Funding tightened' : 'No material change'}</Text><Text style={styles.timelineMeta}>{dateLabel(entry.created_at)} · {currency(entry.reserved_amount)} earmarked · {currency(entry.funding_gap)} open</Text></View>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.section}>
              <TouchableOpacity style={styles.disclosureRow} onPress={() => setShowDetails((value) => !value)}>
                <Ionicons name="options-outline" size={18} color={colors.textMuted} />
                <Text style={styles.disclosureText}>Plan details</Text>
                <Ionicons name={showDetails ? 'chevron-up' : 'chevron-down'} size={17} color={colors.textSubtle} />
              </TouchableOpacity>
              {showDetails ? (
                <View style={styles.detailFields}>
                  <View style={styles.field}><Text style={styles.label}>Name</Text><TextInput style={styles.input} value={label} onChangeText={setLabel} /></View>
                  <View style={styles.twoCol}>
                    <View style={styles.field}><Text style={styles.label}>Estimated price</Text><TextInput style={styles.input} value={amount} onChangeText={(value) => setAmount(numberInput(value))} keyboardType="decimal-pad" /></View>
                    <View style={styles.field}><Text style={styles.label}>Keep as buffer</Text><TextInput style={styles.input} value={buffer} onChangeText={(value) => setBuffer(numberInput(value))} keyboardType="decimal-pad" /></View>
                  </View>
                  <View style={styles.field}><Text style={styles.label}>Recovery window</Text><View style={styles.segmented}>{[1, 2, 3, 4, 6].map((months) => <TouchableOpacity key={months} style={[styles.segment, Number(recoveryMonths) === months && styles.segmentActive]} onPress={() => setRecoveryMonths(`${months}`)}><Text style={[styles.segmentText, Number(recoveryMonths) === months && styles.segmentTextActive]}>{months}m</Text></TouchableOpacity>)}</View></View>
                  <TextInput style={[styles.input, styles.notes]} value={notes} onChangeText={setNotes} placeholder="Notes and tradeoffs" placeholderTextColor={colors.textDisabled} multiline />
                  <PrimaryButton title="Save details" loading={saving} onPress={savePlan} />
                </View>
              ) : null}
            </View>

            <View style={styles.actions}>
              {plan?.state === 'considering' ? <PrimaryButton title="Mark ready" icon="flag-outline" onPress={() => setState('ready')} /> : null}
              {plan?.state === 'ready' ? <PrimaryButton title="Log purchase" icon="checkmark" onPress={logPurchase} /> : <SecondaryButton title="Log purchase now" icon="checkmark" onPress={logPurchase} />}
              {plan?.state === 'ready' ? <SecondaryButton title="Keep considering" icon="time-outline" onPress={() => setState('considering')} /> : null}
              {plan?.state === 'deferred' ? <SecondaryButton title="Resume consideration" icon="play" onPress={() => setState('considering')} /> : <SecondaryButton title="Pause" icon="pause" onPress={() => setState('deferred')} />}
              <TouchableOpacity style={styles.stopButton} onPress={() => setState('abandoned')}><Text style={styles.stopText}>Pass on this purchase</Text></TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  content: { padding: spacing.xl, paddingBottom: 56, gap: spacing.xxl },
  loadingSkeleton: { flex: 1, padding: spacing.xl, gap: spacing.xl },
  skeletonHero: { height: 88, backgroundColor: colors.surfaceRaised, borderRadius: radius.md },
  skeletonBand: { height: 150, backgroundColor: colors.surfaceRaised, borderRadius: radius.md },
  hero: { gap: spacing.sm },
  heroTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroCopy: { flex: 1, gap: spacing.xs },
  eyebrow: { ...typography.eyebrow, color: colors.info, textTransform: 'capitalize' },
  title: { ...typography.screenTitle, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted },
  recommendation: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: spacing.xl, gap: spacing.lg },
  recommendationTop: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  recommendationCopy: { flex: 1, gap: spacing.sm },
  strategyTitle: { color: colors.text, fontSize: 19, fontWeight: '750' },
  strategyBody: { ...typography.body, color: colors.textMuted },
  metric: { color: colors.text, fontSize: 25, fontWeight: '750' },
  change: { color: colors.success, fontSize: 13, fontWeight: '700' },
  metrics: { flexDirection: 'row', gap: spacing.sm },
  metricCell: { flex: 1, gap: 4 },
  metricLabel: { color: colors.textSubtle, fontSize: 11, lineHeight: 15 },
  metricValue: { color: colors.text, fontSize: 15, fontWeight: '700' },
  section: { gap: spacing.md },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headingCopy: { flex: 1, gap: 4 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  sectionBody: { ...typography.bodySmall, color: colors.textMuted },
  field: { gap: spacing.sm },
  fieldHint: { color: colors.textSubtle, fontSize: 11, lineHeight: 16 },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '650' },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceRaised, color: colors.text, paddingHorizontal: spacing.md, fontSize: 15 },
  notes: { minHeight: 82, paddingTop: spacing.md, textAlignVertical: 'top' },
  twoCol: { flexDirection: 'row', gap: spacing.md },
  segmented: { minHeight: 44, flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, minHeight: 44 },
  segmentActive: { backgroundColor: colors.accentMuted },
  segmentText: { color: colors.textMuted, fontSize: 13, fontWeight: '650' },
  segmentTextActive: { color: colors.text },
  disclosureRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  disclosureText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '650' },
  optionList: { borderTopWidth: 1, borderTopColor: colors.border },
  optionRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.sm },
  optionRowActive: { backgroundColor: colors.surfaceMuted },
  optionIcon: { width: 34, height: 34, borderRadius: radius.md, backgroundColor: colors.surfacePressed, alignItems: 'center', justifyContent: 'center' },
  optionCopy: { flex: 1, gap: 3 },
  optionTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  optionTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  recommended: { color: colors.info, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  optionBody: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  optionValueWrap: { alignItems: 'flex-end', gap: spacing.sm, maxWidth: 94 },
  optionValue: { color: colors.text, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  disabled: { opacity: 0.45 },
  budgetContext: { gap: spacing.sm, paddingTop: spacing.sm },
  compactRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  compactName: { flex: 1, color: colors.textMuted, fontSize: 13 },
  compactAmount: { color: colors.text, fontSize: 13, fontWeight: '650' },
  sourcesIcon: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  sourceList: { borderTopWidth: 1, borderTopColor: colors.border },
  sourceRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  sourceCopy: { flex: 1, gap: 2 },
  sourceName: { color: colors.text, fontSize: 14, fontWeight: '650' },
  sourceMeta: { color: colors.textSubtle, fontSize: 11 },
  sourceAmount: { color: colors.text, fontSize: 14, fontWeight: '700' },
  earmarkButton: { minHeight: 44, minWidth: 78, borderRadius: radius.sm, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  earmarkText: { color: colors.textInverse, fontSize: 12, fontWeight: '750' },
  earmarkEditor: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  amountInput: { width: 76, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised, color: colors.text, paddingHorizontal: spacing.sm, textAlign: 'right' },
  confirmButton: { minHeight: 44, paddingHorizontal: spacing.md },
  cancelIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  reservedList: { gap: spacing.sm, paddingTop: spacing.sm },
  reservedRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  removeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  historyLead: { ...typography.body, color: colors.textMuted },
  timeline: { gap: 0 },
  timelineRow: { minHeight: 52, flexDirection: 'row', gap: spacing.md },
  timelineDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.borderStrong, marginTop: 5 },
  timelineDotActive: { backgroundColor: colors.info },
  timelineCopy: { flex: 1, gap: 3, paddingBottom: spacing.md },
  timelineTitle: { color: colors.text, fontSize: 13, fontWeight: '650' },
  timelineMeta: { color: colors.textSubtle, fontSize: 11 },
  detailFields: { gap: spacing.md },
  priceStatus: { color: colors.info, fontSize: 12 },
  offerList: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, gap: spacing.sm },
  offerRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, paddingBottom: spacing.sm },
  offerCopy: { flex: 1, gap: 2 },
  offerMerchant: { color: colors.text, fontSize: 14, fontWeight: '650' },
  offerMeta: { color: colors.textSubtle, fontSize: 11 },
  offerPrice: { color: colors.text, fontSize: 15, fontWeight: '700' },
  error: { color: colors.danger, ...typography.bodySmall },
  errorBanner: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.dangerBorder, borderRadius: radius.sm, backgroundColor: colors.dangerMuted, paddingHorizontal: spacing.md },
  errorBannerText: { flex: 1, color: colors.danger, ...typography.bodySmall },
  actions: { gap: spacing.md },
  stopButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  stopText: { color: colors.danger, fontSize: 14, fontWeight: '650' },
});
