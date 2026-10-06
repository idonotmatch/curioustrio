import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Linking, Platform
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useCategories } from '../../hooks/useCategories';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { usePendingExpenseReviewActions } from '../../hooks/usePendingExpenseReviewActions';
import { useExpenseDetailController } from '../../hooks/useExpenseDetailController';
import { DismissReasonSheet } from '../../components/DismissReasonSheet';
import { LocationPicker } from '../../components/LocationPicker';
import { DismissKeyboardScrollView } from '../../components/DismissKeyboardScrollView';
import { PendingExpenseReviewPanel } from '../../components/PendingExpenseReviewPanel';
import { ExpenseDetailActions } from '../../components/ExpenseDetailActions';
import { ExpenseItemsSection } from '../../components/ExpenseItemsSection';
import { ExpenseVisibilityControls } from '../../components/ExpenseVisibilityControls';
import { RecurringExpenseModal } from '../../components/RecurringExpenseModal';
import { InlineError } from '../../components/ui/States';
import { toLocalDateString } from '../../services/date';
import { colors } from '../../theme/tokens';
import {
  formatImportedAt,
  formatEmailText,
  formatEmailSnippet,
  formatCurrency,
  formatShortDate,
  buildReviewFocusSummary,
  buildReviewDecisionFacts,
  buildTreatmentSuggestionSummary,
  buildPriorityReviewFields,
  formatItemStructuredMeta,
  itemMatchLabel,
  itemSubmeta,
  summarizeItemSignals,
} from '../../services/expenseDetailPresentation';
import { fieldProvenance, sourcePresentation } from '../../services/provenancePresentation';
import { formatMoneyInput, sanitizeMoneyInput } from '../../services/moneyInput';

const TRACK_ONLY_REASONS = [
  { value: 'business', label: 'Business' },
  { value: 'reimbursable', label: 'Reimbursable' },
  { value: 'different_budget', label: 'Different budget' },
  { value: 'shared_not_mine', label: 'Shared, not mine' },
  { value: 'transfer_like', label: 'Transfer-like' },
  { value: 'other', label: 'Other' },
];


export default function ExpenseDetailScreen() {
  const { id, expense: expenseParam } = useLocalSearchParams();
  const router = useRouter();
  const { categories } = useCategories();
  const { userId: currentUserId } = useCurrentUser();
  const {
    expense,
    loading,
    loadError,
    retryLoad,
    editing,
    setEditing,
    saving,
    deleting,
    actioning,
    setActioning,
    showDismissReasonSheet,
    setShowDismissReasonSheet,
    merchant,
    setMerchant,
    amount,
    setAmount,
    date,
    setDate,
    notes,
    setNotes,
    categoryId,
    setCategoryId,
    paymentMethod,
    setPaymentMethod,
    cardLast4,
    setCardLast4,
    cardLabel,
    setCardLabel,
    isPrivate,
    setIsPrivate,
    excludeFromBudget,
    setExcludeFromBudget,
    budgetExclusionReason,
    setBudgetExclusionReason,
    items,
    setItemsExpanded,
    itemsExpanded,
    itemsEdits,
    setItemsEdits,
    locationData,
    setLocationData,
    recurringPreference,
    showRecurringModal,
    setShowRecurringModal,
    recurringFrequencyDays,
    setRecurringFrequencyDays,
    recurringNotes,
    setRecurringNotes,
    secondaryDetailsExpanded,
    setSecondaryDetailsExpanded,
    activeReviewField,
    setActiveReviewField,
    itemDecisionId,
    handleItemMatchDecision,
    canEdit,
    canAdjustReviewControls,
    handleSave,
    handleDelete,
    saveRecurringPreference,
    removeRecurringPreference,
    savingControls,
    persistReviewControlsIfNeeded,
    handleTogglePrivate,
    handleToggleTrackOnly,
    handleSelectBudgetExclusionReason,
  } = useExpenseDetailController({
    id,
    expenseParam,
    currentUserId,
    router,
  });
  const [editDetailsReady, setEditDetailsReady] = useState(false);
  const itemSignals = summarizeItemSignals(items);

  useEffect(() => {
    if (!editing) {
      setEditDetailsReady(false);
      return undefined;
    }
    let active = true;
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (active) setEditDetailsReady(true);
      });
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [editing]);

  const reviewState = expense?.status === 'pending' && expense?.source === 'email';
  const gmailReviewHint = expense?.gmail_review_hint || null;
  const isPendingEmailReview = reviewState;
  const isItemsFirstReview = gmailReviewHint?.review_mode === 'items_first';
  const isQuickCheckReview = gmailReviewHint?.review_mode === 'quick_check';
  const { approvePendingExpense, dismissPendingExpense } = usePendingExpenseReviewActions({
    expenseId: id,
    expense,
    router,
    setActioning,
    setShowDismissReasonSheet,
    persistReviewControlsIfNeeded,
    isItemsFirstReview,
    isQuickCheckReview,
  });

  useEffect(() => {
    if (!isPendingEmailReview) return;
    if (!Array.isArray(items) || items.length === 0) return;
    if (itemsExpanded) return;
    setItemsExpanded(true);
    if (isItemsFirstReview) {
      setEditing(true);
      setActiveReviewField((current) => current || 'items');
    }
  }, [isPendingEmailReview, items, itemsExpanded, isItemsFirstReview]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.textDisabled} /></View>;
  if (!expense) {
    return (
      <View style={styles.loadFailure}>
        <InlineError
          title={loadError?.status === 404 ? 'Expense unavailable' : 'Could not load expense'}
          body={loadError?.status === 404
            ? 'It may have been deleted or is no longer available to this account.'
            : loadError?.message || 'Check your connection and try again.'}
          actionLabel="Try again"
          onAction={retryLoad}
        />
      </View>
    );
  }

  const formattedDate = (() => {
    const d = new Date((expense.date || '').slice(0, 10) + 'T12:00:00');
    return isNaN(d) ? expense.date : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  })();
  const isRefund = Number(expense.amount) < 0;
  const categoryLabel = expense.category_parent_name || expense.category_name || 'Uncategorized';
  const ownerLabel = expense.user_name || 'You';
  const sourceInfo = sourcePresentation(expense);
  const provenanceFields = fieldProvenance(expense, gmailReviewHint);
  const categoryReasoning = expense.category_reasoning || null;
  const treatmentSuggestion = gmailReviewHint?.treatment_suggestion || null;
  const importedAtLabel = formatImportedAt(gmailReviewHint?.imported_at);
  const subjectLine = formatEmailText(gmailReviewHint?.message_subject || expense?.email_subject);
  const emailSnippet = formatEmailSnippet(gmailReviewHint?.message_snippet || expense?.email_snippet);
  const importMetaBits = [gmailReviewHint?.from_address || expense?.email_from_address, importedAtLabel].filter(Boolean);
  const treatmentSuggestionSummary = buildTreatmentSuggestionSummary(treatmentSuggestion);
  const reviewFocusSummary = buildReviewFocusSummary(gmailReviewHint);
  const reviewDecisionFacts = buildReviewDecisionFacts({
    expense,
    gmailReviewHint,
    formattedDate,
    importedAtLabel,
    categoryLabel,
  });
  const priorityReviewFields = isPendingEmailReview
    ? buildPriorityReviewFields({ expense, gmailReviewHint, formattedDate, categoryLabel })
    : [];
  const showSecondaryDetails = !isPendingEmailReview || secondaryDetailsExpanded;
  const displayIsPrivate = isPendingEmailReview ? isPrivate : (editing ? isPrivate : expense.is_private);
  const displayExcludeFromBudget = isPendingEmailReview ? excludeFromBudget : (editing ? excludeFromBudget : expense.exclude_from_budget);
  const itemReviewContext = Array.isArray(expense.item_review_context) ? expense.item_review_context : [];
  function activateReviewField(fieldKey) {
    setEditing(true);
    setActiveReviewField(fieldKey);
    if (fieldKey === 'items') setItemsExpanded(true);
  }

  function applyTreatmentSuggestion() {
    if (!treatmentSuggestion) return;
    if (treatmentSuggestion.suggested_category_id) {
      setCategoryId(treatmentSuggestion.suggested_category_id);
    }
    if (treatmentSuggestion.suggested_payment_method) {
      setPaymentMethod(treatmentSuggestion.suggested_payment_method);
      setCardLabel(treatmentSuggestion.suggested_card_label || '');
      setCardLast4(treatmentSuggestion.suggested_card_last4 || '');
    }
    if (treatmentSuggestion.suggested_private) {
      setIsPrivate(true);
    }
    if (treatmentSuggestion.suggested_track_only) {
      setExcludeFromBudget(true);
      if (treatmentSuggestion.budget_exclusion_reason) {
        setBudgetExclusionReason(treatmentSuggestion.budget_exclusion_reason);
      }
    }
  }

  return (
    <DismissKeyboardScrollView style={styles.container}>
      <Stack.Screen options={{
        title: expense.merchant,
        headerRight: editing || !canEdit ? undefined : () => (
          <TouchableOpacity
            onPress={() => setEditing(true)}
            style={styles.headerEditButton}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Edit expense"
          >
            <Ionicons name="pencil-outline" size={20} color={colors.text} />
          </TouchableOpacity>
        ),
      }} />

      {/* Hero */}
      <View style={styles.hero}>
        {editing && canEdit && !isPendingEmailReview ? (
          <View style={styles.editRow}>
            <TextInput
              style={[styles.editInput, { flex: 1 }, activeReviewField === 'merchant' && styles.editInputFocused]}
              value={merchant}
              onChangeText={setMerchant}
              placeholderTextColor={colors.textDisabled}
              placeholder="Merchant"
              autoCorrect
              spellCheck
              autoCapitalize="words"
              textContentType="organizationName"
            />
            <TextInput
              style={[styles.editInput, styles.editAmount, activeReviewField === 'amount' && styles.editInputFocused]}
              value={amount}
              onChangeText={(value) => setAmount(sanitizeMoneyInput(value))}
              onBlur={() => setAmount(formatMoneyInput(amount))}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textDisabled}
            />
          </View>
        ) : (
          <>
            <Text style={styles.merchant}>{expense.merchant}</Text>
            <Text style={[styles.amount, isRefund && styles.amountRefund]}>
              {isRefund ? '−' : ''}${Math.abs(Number(expense.amount)).toFixed(2)}
            </Text>
            <View style={styles.heroMetaWrap}>
              <View style={styles.heroMetaChip}>
                <Text style={styles.heroMetaText}>{formattedDate}</Text>
              </View>
              <View style={styles.heroMetaChip}>
                <Text style={styles.heroMetaText}>{categoryLabel}</Text>
              </View>
              <View style={styles.heroMetaChip}>
                <Text style={styles.heroMetaText}>{sourceInfo.label}</Text>
              </View>
              {expense.user_name ? (
                <View style={[styles.heroMetaChip, styles.heroMetaChipMuted]}>
                  <Text style={styles.heroMetaText}>{ownerLabel}</Text>
                </View>
              ) : null}
              {displayIsPrivate ? (
                <View style={[styles.heroMetaChip, styles.heroMetaChipMuted]}>
                  <Text style={styles.heroMetaText}>Private</Text>
                </View>
              ) : null}
              {displayExcludeFromBudget ? (
                <View style={[styles.heroMetaChip, styles.heroMetaChipMuted]}>
                  <Text style={styles.heroMetaText}>Track only</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.provenanceSummary}>
              <Text style={styles.provenanceSummaryTitle}>{sourceInfo.detail}</Text>
              {provenanceFields.length ? (
                <Text style={styles.provenanceSummaryMeta}>
                  {provenanceFields.map((field) => `${field.label}: ${field.value}`).join(' · ')}
                </Text>
              ) : null}
            </View>
          </>
        )}
      </View>

      {isPendingEmailReview ? (
        <PendingExpenseReviewPanel
          styles={styles}
          activeReviewField={activeReviewField}
          subjectLine={subjectLine}
          expenseMerchant={expense?.merchant}
          reviewDecisionFacts={reviewDecisionFacts}
          reviewFocusSummary={reviewFocusSummary}
          treatmentSuggestion={treatmentSuggestion}
          treatmentSuggestionSummary={treatmentSuggestionSummary}
          importMetaBits={importMetaBits}
          emailSnippet={emailSnippet}
          automationRecommendation={gmailReviewHint?.automation_recommendation || null}
          categoryExplanation={gmailReviewHint?.category_explanation || null}
          priorityReviewFields={priorityReviewFields}
          isItemsFirstReview={isItemsFirstReview}
          editing={editing}
          activateReviewField={activateReviewField}
          applyTreatmentSuggestion={applyTreatmentSuggestion}
          isPrivate={isPrivate}
          excludeFromBudget={excludeFromBudget}
          canAdjustReviewControls={canAdjustReviewControls}
          handleTogglePrivate={handleTogglePrivate}
          handleToggleTrackOnly={handleToggleTrackOnly}
          handleSelectBudgetExclusionReason={handleSelectBudgetExclusionReason}
          savingControls={savingControls}
          trackOnlyReasons={TRACK_ONLY_REASONS}
          budgetExclusionReason={budgetExclusionReason}
          secondaryDetailsExpanded={secondaryDetailsExpanded}
          setSecondaryDetailsExpanded={setSecondaryDetailsExpanded}
          items={items}
          formatCurrency={formatCurrency}
          setItemsExpanded={setItemsExpanded}
          merchant={merchant}
          setMerchant={setMerchant}
          amount={amount}
          setAmount={setAmount}
          date={date}
          setDate={setDate}
          categoryId={categoryId}
          setCategoryId={setCategoryId}
          categories={categories}
          formattedDate={formattedDate}
          toLocalDateString={toLocalDateString}
        />
      ) : reviewState ? (
        <View style={styles.reviewBanner}>
          <Text style={styles.reviewBannerEyebrow}>
            {isQuickCheckReview ? 'Quick check' : 'Gmail import'}
          </Text>
          <Text style={styles.reviewBannerTitle}>
            {subjectLine || expense?.merchant || 'Gmail import awaiting review'}
          </Text>
          {expense?.merchant && subjectLine && subjectLine.toLowerCase() !== `${expense.merchant}`.toLowerCase() ? (
            <Text style={styles.reviewBannerText}>{expense.merchant}</Text>
          ) : null}
          {reviewDecisionFacts.length ? (
            <View style={styles.reviewFactGrid}>
              {reviewDecisionFacts.map((fact) => (
                <View key={`${fact.label}:${fact.value}`} style={styles.reviewFactChip}>
                  <Text style={styles.reviewFactLabel}>{fact.label}</Text>
                  <Text style={styles.reviewFactValue} numberOfLines={1}>{fact.value}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {canEdit && showSecondaryDetails ? (
        <View style={styles.recurringCard}>
          <View style={styles.recurringHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.recurringTitle}>Recurring</Text>
              <Text style={styles.recurringSubtitle}>
                {recurringPreference
                  ? recurringPreference.expected_frequency_days
                    ? `Marked recurring · about every ${recurringPreference.expected_frequency_days} days`
                    : 'Marked recurring'
                  : 'Flag this as a common purchase so Adlo can learn from it sooner'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setShowRecurringModal(true)} disabled={actioning}>
              <Text style={styles.recurringAction}>{recurringPreference ? 'Edit' : 'Mark'}</Text>
            </TouchableOpacity>
          </View>
          {recurringPreference?.notes ? (
            <Text style={styles.recurringNotePreview}>{recurringPreference.notes}</Text>
          ) : null}
        </View>
      ) : null}

      {!isPendingEmailReview && itemReviewContext.length > 0 ? (
        <View style={styles.itemHistoryCard}>
          <Text style={styles.itemHistoryEyebrow}>Item patterns</Text>
          <Text style={styles.itemHistoryTitle}>Recent item history from your own spend</Text>
          {itemReviewContext.map((entry) => {
            const merchantCount = Array.isArray(entry.merchants) ? entry.merchants.length : 0;
            const merchantLine = merchantCount > 1
              ? `${merchantCount} merchants`
              : entry.merchants?.[0] || null;
            const latest = entry.latest_purchase || null;
            const subline = [
              latest?.merchant || null,
              latest?.date ? formatShortDate(latest.date) : null,
              latest?.amount != null ? formatCurrency(latest.amount) : null,
            ].filter(Boolean).join('  •  ') || null;
            const occurrenceCount = Number(entry.occurrence_count || 0);
            const cadence = Number(entry.average_gap_days || 0);
            const medianAmount = formatCurrency(entry.median_amount);
            const summary = occurrenceCount >= 3 && cadence > 0
              ? `${entry.item_name || 'This item'} has shown up ${occurrenceCount} times, about every ${cadence} days${medianAmount ? ` at around ${medianAmount}` : ''}.`
              : occurrenceCount >= 2
                ? `${entry.item_name || 'This item'} has shown up ${occurrenceCount} times recently${medianAmount ? ` at around ${medianAmount}` : ''}.`
                : `${entry.item_name || 'This item'} has some recent history${medianAmount ? ` around ${medianAmount}` : ''}.`;
            return (
              <View key={entry.group_key} style={styles.itemHistoryRow}>
                <View style={styles.itemHistoryText}>
                  <Text style={styles.itemHistoryName}>{entry.item_name || 'Untitled item'}</Text>
                  <Text style={styles.itemHistorySummary}>{summary}</Text>
                  {subline ? <Text style={styles.itemHistoryMeta}>{subline}</Text> : null}
                </View>
                <View style={styles.itemHistoryRight}>
                  {merchantLine ? <Text style={styles.itemHistoryBadge}>{merchantLine}</Text> : null}
                  {entry.median_unit_price != null ? (
                    <Text style={styles.itemHistoryUnit}>
                      {formatCurrency(entry.median_unit_price)} / {entry.normalized_total_size_unit || 'unit'}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {!isPendingEmailReview && categoryReasoning?.label ? (
        <View style={styles.categoryReasoningCard}>
          <Text style={styles.categoryReasoningEyebrow}>Category signal</Text>
          <Text style={styles.categoryReasoningTitle}>{categoryReasoning.label}</Text>
          {categoryReasoning.detail ? (
            <Text style={styles.categoryReasoningBody}>{categoryReasoning.detail}</Text>
          ) : null}
          {Number.isFinite(categoryReasoning?.decision_count) || Number.isFinite(categoryReasoning?.merchant_hit_count) ? (
            <View style={styles.categoryReasoningMetaWrap}>
              {Number.isFinite(categoryReasoning?.decision_count) ? (
                <View style={styles.categoryReasoningMetaChip}>
                  <Text style={styles.categoryReasoningMetaText}>
                    {categoryReasoning.decision_count} learned {categoryReasoning.decision_count === 1 ? 'decision' : 'decisions'}
                  </Text>
                </View>
              ) : null}
              {Number.isFinite(categoryReasoning?.merchant_hit_count) && categoryReasoning.merchant_hit_count > 0 ? (
                <View style={styles.categoryReasoningMetaChip}>
                  <Text style={styles.categoryReasoningMetaText}>
                    {categoryReasoning.merchant_hit_count} merchant {categoryReasoning.merchant_hit_count === 1 ? 'match' : 'matches'}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {editing && editDetailsReady && canEdit && !isPendingEmailReview ? (
        <View style={styles.editDetailsCard}>
          <Text style={styles.editDetailsTitle}>Details</Text>
          <View style={activeReviewField === 'date' ? styles.reviewFieldWrapActive : null}>
            <Row label="Date">
              <DateTimePicker
                value={date ? new Date(date + 'T12:00:00') : new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'compact' : 'default'}
                maximumDate={new Date()}
                onChange={(_, selected) => {
                  if (selected) setDate(toLocalDateString(selected));
                }}
                themeVariant="dark"
                style={styles.datePicker}
              />
            </Row>
          </View>
          <View style={activeReviewField === 'category' ? styles.reviewFieldWrapActive : null}>
            <Row label="Category">
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
            </Row>
          </View>
        </View>
      ) : null}

      {/* Fields */}
      <View style={styles.section}>

        <Row label="Payment">
          {editing && editDetailsReady ? (
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

        {editing && editDetailsReady && (paymentMethod === 'debit' || paymentMethod === 'credit') && (
          <Row label="Card">
            <View style={{ flexDirection: 'row', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
              <TextInput
                style={[styles.editInputInline, { flex: 1 }]}
                placeholder="nickname"
                placeholderTextColor={colors.textDisabled}
                value={cardLabel}
                onChangeText={setCardLabel}
              />
              <TextInput
                style={[styles.editInputInline, { width: 50 }]}
                placeholder="last4"
                placeholderTextColor={colors.textDisabled}
                value={cardLast4}
                onChangeText={t => setCardLast4(t.replace(/\D/g, '').slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>
          </Row>
        )}

        {!isPendingEmailReview ? (
          <ExpenseVisibilityControls
            styles={styles}
            isPrivate={isPrivate}
            excludeFromBudget={excludeFromBudget}
            budgetExclusionReason={budgetExclusionReason}
            canAdjust={canEdit}
            savingControls={savingControls}
            trackOnlyReasons={TRACK_ONLY_REASONS}
            onTogglePrivate={handleTogglePrivate}
            onToggleTrackOnly={handleToggleTrackOnly}
            onSelectBudgetExclusionReason={handleSelectBudgetExclusionReason}
          />
        ) : null}
      </View>

      {showSecondaryDetails && ((editing && editDetailsReady && canEdit) || locationData || expense.place_name || expense.address) ? (
        <View style={styles.locationSection}>
          {editing && editDetailsReady && canEdit ? (
            <LocationPicker
              onLocation={setLocationData}
              locationData={locationData}
              merchant={merchant}
            />
          ) : (expense.place_name || expense.address) ? (
            (() => {
              const persistedCoords = [Number(expense.location_latitude), Number(expense.location_longitude)];
              const legacyCoords = expense.mapkit_stable_id?.split(',').map(Number);
              const coords = expense.location_latitude != null && expense.location_longitude != null
                ? persistedCoords
                : legacyCoords;
              const hasCoords = coords?.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1]);
              const locationLabel = expense.place_name || expense.address;
              const mapsUrl = hasCoords
                ? `maps://?ll=${coords[0]},${coords[1]}&q=${encodeURIComponent(locationLabel)}`
                : `maps://?q=${encodeURIComponent(expense.address || expense.place_name)}`;
              return (
                <TouchableOpacity style={styles.locationCard} onPress={() => Linking.openURL(mapsUrl)}>
                  <View style={styles.locationInfo}>
                    <Text style={styles.locationName}>{locationLabel}</Text>
                    {expense.address ? <Text style={styles.locationAddress}>{expense.address}</Text> : null}
                  </View>
                  <Ionicons name="map-outline" size={18} color={colors.textDisabled} />
                </TouchableOpacity>
              );
            })()
          ) : null}
        </View>
      ) : null}

      {showSecondaryDetails && ((editing && editDetailsReady && canEdit) || expense.notes) && (
        <View style={styles.noteCard}>
          <Text style={styles.noteCardLabel}>Notes</Text>
          {editing && editDetailsReady && canEdit ? (
            <TextInput
              style={styles.noteInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add a note"
              placeholderTextColor={colors.textDisabled}
              multiline
            />
          ) : (
            <Text style={styles.noteText}>{expense.notes}</Text>
          )}
        </View>
      )}

      <ExpenseItemsSection
        styles={styles}
        items={items}
        itemsExpanded={itemsExpanded}
        setItemsExpanded={setItemsExpanded}
        activeReviewField={activeReviewField}
        editing={editing && editDetailsReady}
        canEdit={canEdit}
        itemsEdits={itemsEdits}
        setItemsEdits={setItemsEdits}
        amount={amount}
        itemSignals={itemSignals}
        itemMatchLabel={itemMatchLabel}
        formatItemStructuredMeta={formatItemStructuredMeta}
        itemSubmeta={itemSubmeta}
        itemDecisionId={itemDecisionId}
        onItemMatchDecision={handleItemMatchDecision}
      />

      <ExpenseDetailActions
        styles={styles}
        expense={expense}
        editing={editing}
        canEdit={canEdit}
        saving={saving}
        handleSave={handleSave}
        actioning={actioning}
        approvePendingExpense={approvePendingExpense}
        openDismissReasonSheet={() => setShowDismissReasonSheet(true)}
        isItemsFirstReview={isItemsFirstReview}
        isQuickCheckReview={isQuickCheckReview}
        deleting={deleting}
        handleDelete={handleDelete}
        onReviewDuplicate={(flag) => router.push({
          pathname: '/duplicate-review',
          params: { expense_id: expense.id, flag_id: flag?.id || '' },
        })}
      />

      <RecurringExpenseModal
        styles={styles}
        visible={showRecurringModal}
        onClose={() => setShowRecurringModal(false)}
        recurringPreference={recurringPreference}
        recurringFrequencyDays={recurringFrequencyDays}
        setRecurringFrequencyDays={setRecurringFrequencyDays}
        recurringNotes={recurringNotes}
        setRecurringNotes={setRecurringNotes}
        removeRecurringPreference={removeRecurringPreference}
        saveRecurringPreference={saveRecurringPreference}
        actioning={actioning}
      />
      <DismissReasonSheet
        visible={showDismissReasonSheet}
        busy={actioning}
        onClose={() => !actioning && setShowDismissReasonSheet(false)}
        onSelect={dismissPendingExpense}
      />
    </DismissKeyboardScrollView>
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
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  loadFailure: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: 20 },
  muted: { color: colors.textDisabled },
  headerEditButton: { width: 44, height: 44, marginRight: -8, alignItems: 'center', justifyContent: 'center' },

  hero: { padding: 24, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: colors.surface },
  merchant: { fontSize: 20, color: colors.text, fontWeight: '600', letterSpacing: -0.3 },
  amount: { fontSize: 36, color: colors.text, fontWeight: '600', marginTop: 4, letterSpacing: -1 },
  amountRefund: { color: colors.success },
  heroMetaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  heroMetaChip: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  heroMetaChipMuted: {
    backgroundColor: colors.surface,
  },
  heroMetaText: { color: colors.textMuted, fontSize: 12, fontWeight: '500' },
  provenanceSummary: {
    marginTop: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.textInverse,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  provenanceSummaryTitle: { color: colors.textSubtle, fontSize: 12, lineHeight: 17 },
  provenanceSummaryMeta: { color: colors.textDisabled, fontSize: 11, lineHeight: 16, marginTop: 4 },
  reviewBanner: {
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: -4,
    backgroundColor: colors.warningMuted,
    borderWidth: 1,
    borderColor: colors.warningMuted,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  reviewBannerEyebrow: { color: colors.warning, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  reviewBannerTitle: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  reviewBannerText: { color: colors.text, fontSize: 12, lineHeight: 17, marginTop: 4 },
  reviewBannerSubjectBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.warningMuted,
  },
  reviewBannerSubjectLabel: {
    color: colors.warning,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  reviewBannerSubjectValue: { color: colors.text, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  reviewFactGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  reviewFactChip: {
    minWidth: 100,
    maxWidth: '48%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.warningMuted,
    backgroundColor: colors.warningMuted,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  reviewFactLabel: { color: colors.warning, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  reviewFactValue: { color: colors.text, fontSize: 12, fontWeight: '600' },
  reviewFocusBlock: {
    marginTop: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.warningMuted,
    backgroundColor: colors.warningMuted,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  reviewFocusTitle: { color: colors.text, fontSize: 12, fontWeight: '600', marginBottom: 3 },
  reviewFocusBody: { color: colors.text, fontSize: 12, lineHeight: 17 },
  reviewPatternBlock: {
    marginTop: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.successMuted,
    backgroundColor: colors.successMuted,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  reviewPatternLabel: { color: colors.success, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  reviewPatternBody: { color: colors.text, fontSize: 12, lineHeight: 17 },
  reviewBannerMeta: { color: colors.textSubtle, fontSize: 11, lineHeight: 16, marginBottom: 6 },
  reviewBannerEmailContext: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.warningMuted,
  },
  reviewBannerEmailLabel: {
    color: colors.warning,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  reviewBannerEmailSnippet: { color: colors.text, fontSize: 12, lineHeight: 18 },
  reviewProvenanceCard: {
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: -4,
    backgroundColor: colors.warningMuted,
    borderWidth: 1,
    borderColor: colors.warningMuted,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  reviewProvenanceHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6 },
  reviewSectionEyebrow: { color: colors.textSubtle, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  reviewProvenanceTitle: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  reviewProvenanceMeta: { color: colors.text, fontSize: 12, lineHeight: 17, marginTop: 6 },
  reviewReasonBlock: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.warningMuted,
    paddingTop: 10,
    gap: 4,
  },
  reviewReasonLabel: { color: colors.text, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  reviewReasonBody: { color: colors.text, fontSize: 12, lineHeight: 18 },
  reviewPathRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  reviewProvenanceHint: { color: colors.text, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  reviewSnippetBlock: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.warningMuted,
    paddingTop: 10,
    gap: 4,
  },
  reviewSnippetLabel: { color: colors.textSubtle, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  reviewProvenanceSnippet: { color: colors.text, fontSize: 12, lineHeight: 18 },
  reviewSummaryCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: -4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.textInverse,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  reviewSummaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  headerCopyBlock: { flex: 1, minWidth: 0 },
  headerActionWrap: { flexShrink: 0, alignSelf: 'flex-start', paddingLeft: 4 },
  reviewSummaryTitle: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  reviewSummarySubtitle: { color: colors.textSubtle, fontSize: 12, lineHeight: 17, marginTop: 5 },
  reviewSummaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reviewSummaryChip: {
    minWidth: 104,
    maxWidth: '48%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  reviewSummaryChipLabel: { color: colors.textSubtle, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  reviewSummaryChipValue: { color: colors.text, fontSize: 13, fontWeight: '600' },
  inlineEditFieldList: {
    gap: 10,
  },
  inlineEditFieldCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  inlineEditAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 28,
  },
  inlineEditAmountDollar: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginRight: 4,
  },
  inlineEditAmountInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  inlineEditTextInput: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    paddingVertical: 0,
    paddingHorizontal: 0,
    minHeight: 28,
  },
  inlineEditStaticValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    minHeight: 24,
  },
  inlineEditDateRow: {
    minHeight: 32,
    justifyContent: 'center',
    marginLeft: -6,
  },
  inlineEditDatePicker: {
    alignSelf: 'flex-start',
  },
  inlineEditCategoryScroller: {
    marginTop: 2,
    maxHeight: 36,
  },
  inlineEditCategoryRow: {
    flexDirection: 'row',
    gap: 6,
    paddingRight: 4,
  },
  inlineEditCategoryChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  inlineEditCategoryChipActive: {
    borderColor: colors.info,
    backgroundColor: colors.infoMuted,
  },
  inlineEditCategoryChipText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  inlineEditCategoryChipTextActive: {
    color: colors.text,
  },
  reviewAttentionBody: { color: colors.text, fontSize: 12, lineHeight: 18, marginTop: 4 },
  priorityFieldsCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: -4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.textInverse,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  priorityFieldsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  priorityFieldsEyebrow: { color: colors.textDisabled, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  priorityFieldsTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  priorityFieldsAction: { color: colors.info, fontSize: 13, fontWeight: '600', marginTop: 2, flexShrink: 0 },
  reviewControlsCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: -4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.textInverse,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  reviewControlsEyebrow: { color: colors.textDisabled, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  reviewControlsTitle: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 10 },
  reviewSuggestionCard: {
    marginTop: 2,
    marginBottom: 10,
    backgroundColor: colors.successMuted,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.successMuted,
    padding: 12,
  },
  reviewSuggestionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  reviewSuggestionCopy: { flex: 1 },
  reviewSuggestionEyebrow: { color: colors.success, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  reviewSuggestionTitle: { color: colors.text, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  reviewSuggestionDetail: { color: colors.text, fontSize: 11, lineHeight: 16, marginTop: 6 },
  reviewSuggestionMeta: { color: colors.text, fontSize: 11, lineHeight: 16, marginTop: 6 },
  reviewSuggestionAction: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.success,
    backgroundColor: colors.successMuted,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  reviewSuggestionActionText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  priorityFieldRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  priorityFieldRowActive: { backgroundColor: colors.infoMuted, marginHorizontal: -12, paddingHorizontal: 12, borderRadius: 8 },
  priorityFieldTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  priorityFieldLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600', flex: 1, minWidth: 0, paddingTop: 2 },
  priorityFieldValue: { color: colors.text, fontSize: 15, fontWeight: '600', marginTop: 5 },
  priorityFieldReason: { color: colors.text, fontSize: 12, lineHeight: 18, marginTop: 4 },
  secondaryDetailsToggle: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: -2,
    paddingVertical: 10,
    paddingHorizontal: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  secondaryDetailsEyebrow: { color: colors.textDisabled, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  secondaryDetailsTitle: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  recurringCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.textInverse,
    padding: 14,
  },
  recurringHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  recurringTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  recurringSubtitle: { color: colors.textDisabled, fontSize: 13, lineHeight: 18, marginTop: 4 },
  recurringAction: { color: colors.info, fontSize: 14, fontWeight: '600' },
  recurringNotePreview: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: 10 },
  categoryReasoningCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.textInverse,
    padding: 14,
  },
  categoryReasoningEyebrow: { color: colors.textDisabled, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  categoryReasoningTitle: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  categoryReasoningBody: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  categoryReasoningMetaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  categoryReasoningMetaChip: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  categoryReasoningMetaText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  itemHistoryCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.textInverse,
    padding: 14,
  },
  itemHistoryEyebrow: { color: colors.textDisabled, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  itemHistoryTitle: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  itemHistoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  itemHistoryText: { flex: 1, minWidth: 0 },
  itemHistoryName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  itemHistorySummary: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  itemHistoryMeta: { color: colors.textSubtle, fontSize: 12, marginTop: 5 },
  itemHistoryRight: { alignItems: 'flex-end', gap: 6, maxWidth: 110 },
  itemHistoryBadge: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: colors.borderSubtle,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    overflow: 'hidden',
  },
  itemHistoryUnit: { color: colors.info, fontSize: 11, fontWeight: '600', textAlign: 'right' },
  editDetailsCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.textInverse,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 2,
  },
  editDetailsTitle: {
    color: colors.textDisabled,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },

  editRow: { flexDirection: 'row', gap: 10 },
  editInput: { backgroundColor: colors.surface, borderRadius: 8, padding: 10, color: colors.text, fontSize: 15, borderWidth: 1, borderColor: colors.textInverse },
  editInputFocused: { borderColor: colors.info, backgroundColor: colors.infoMuted },
  editAmount: { width: 100 },
  editInputInline: { color: colors.text, fontSize: 14, textAlign: 'right', flex: 1, padding: 4 },
  datePicker: { width: 140, height: 36, marginRight: -8 },
  reviewFieldWrapActive: {
    borderWidth: 1,
    borderColor: colors.infoMuted,
    backgroundColor: colors.infoMuted,
    borderRadius: 10,
    marginHorizontal: -8,
    paddingHorizontal: 8,
  },

  section: { paddingHorizontal: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.surface },
  label: { fontSize: 13, color: colors.textDisabled, width: 90 },
  trackOnlyTextWrap: { flex: 1, paddingRight: 12 },
  trackOnlyHint: { color: colors.textDisabled, fontSize: 11, lineHeight: 16, marginTop: 2, maxWidth: 220 },
  trackOnlyReasonBlock: { marginBottom: 16 },
  trackOnlyReasonLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 10 },
  reasonChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  reasonChipActive: {
    borderColor: colors.successMuted,
    backgroundColor: colors.successMuted,
  },
  reasonChipText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  reasonChipTextActive: { color: colors.text },
  valueWrap: { flex: 1, alignItems: 'flex-end' },
  value: { fontSize: 14, color: colors.text, textAlign: 'right' },
  noteCard: {
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 4,
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.textInverse,
  },
  noteCardLabel: {
    color: colors.textDisabled,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  noteText: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
  },
  noteInput: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    minHeight: 84,
    padding: 0,
    textAlignVertical: 'top',
  },

  catChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.textInverse },
  catChipActive: { backgroundColor: colors.text, borderColor: colors.text },
  catChipText: { fontSize: 12, color: colors.textDisabled },
  catChipTextActive: { color: colors.textInverse, fontWeight: '600' },

  locationSection: { marginHorizontal: 20, marginTop: 4 },
  locationCard: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 4, padding: 14, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.textInverse },
  locationInfo: { flex: 1 },
  locationName: { color: colors.text, fontSize: 13, fontWeight: '500' },
  locationAddress: { color: colors.textDisabled, fontSize: 11, marginTop: 2 },

  dupSection: { margin: 20, padding: 12, backgroundColor: colors.warningMuted, borderRadius: 8, borderWidth: 1, borderColor: colors.warningMuted },
  dupTitle: { color: colors.warning, fontWeight: '600', fontSize: 13, marginBottom: 4 },
  dupItem: { color: colors.textSubtle, fontSize: 12, marginTop: 2 },
  dupReviewBtn: { marginTop: 10, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.warning, paddingHorizontal: 12 },
  dupReviewBtnText: { color: colors.textInverse, fontSize: 13, fontWeight: '700' },

  saveBtn: { margin: 20, marginBottom: 8, backgroundColor: colors.text, borderRadius: 10, padding: 14, alignItems: 'center' },
  saveBtnText: { color: colors.textInverse, fontWeight: '600', fontSize: 15 },
  pendingActions: { flexDirection: 'row', marginHorizontal: 20, marginTop: 20, gap: 10 },
  approveBtn: { flex: 1, backgroundColor: colors.success, borderRadius: 10, padding: 14, alignItems: 'center' },
  approveBtnText: { color: colors.text, fontWeight: '600', fontSize: 15 },
  dismissBtn: { flex: 1, backgroundColor: colors.borderSubtle, borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.borderStrong },
  dismissBtnText: { color: colors.danger, fontWeight: '600', fontSize: 15 },
  deleteBtn: { margin: 20, marginTop: 8, padding: 14, alignItems: 'center' },
  deleteBtnText: { color: colors.danger, fontSize: 14 },

  itemsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, marginTop: 4, marginBottom: 4, padding: 14, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.textInverse },
  itemsHeaderActive: { borderColor: colors.infoMuted, backgroundColor: colors.infoMuted },
  itemsHeaderText: { fontSize: 13, color: colors.textDisabled, fontWeight: '500' },
  itemsHeaderTextActive: { color: colors.text },
  itemsList: { marginHorizontal: 20, marginBottom: 4, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.textInverse, overflow: 'hidden' },
  itemSummaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 },
  itemSummaryChip: { borderRadius: 8, backgroundColor: colors.successMuted, paddingHorizontal: 10, paddingVertical: 5 },
  itemSummaryChipMuted: { borderRadius: 8, backgroundColor: colors.surfaceRaised, paddingHorizontal: 10, paddingVertical: 5 },
  itemSummaryChipText: { color: colors.success, fontSize: 11, fontWeight: '700' },
  itemSummaryChipTextMuted: { color: colors.textSubtle, fontSize: 11, fontWeight: '700' },
  itemReadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, gap: 12 },
  itemReadText: { flex: 1, minWidth: 0, gap: 4 },
  itemReadTop: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 },
  itemReadDesc: { fontSize: 13, color: colors.text, flexShrink: 1, fontWeight: '600' },
  itemReadMeta: { fontSize: 12, color: colors.textMuted },
  itemReadSubmeta: { fontSize: 11, color: colors.textDisabled },
  itemReadAmount: { fontSize: 13, color: colors.textSubtle, paddingLeft: 8, paddingTop: 1, fontWeight: '700' },
  itemMatchChip: { borderRadius: 8, backgroundColor: colors.infoMuted, paddingHorizontal: 8, paddingVertical: 4 },
  itemMatchChipText: { color: colors.info, fontSize: 10, fontWeight: '700' },
  itemMatchReview: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  itemMatchReviewTitle: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  itemMatchReviewCandidate: { color: colors.text, fontWeight: '700' },
  itemMatchReviewContext: { color: colors.textDisabled, fontSize: 11, lineHeight: 16, marginTop: 2 },
  itemMatchReviewActions: { flexDirection: 'row', gap: 8, marginTop: 9 },
  itemMatchReviewButton: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    backgroundColor: colors.surfaceRaised,
  },
  itemMatchReviewButtonPrimary: { borderColor: colors.successBorder, backgroundColor: colors.successMuted },
  itemMatchReviewButtonDisabled: { opacity: 0.55 },
  itemMatchReviewButtonText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  itemMatchReviewButtonTextPrimary: { color: colors.success },
  itemEditCard: { gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  itemEditRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemEditDesc: { flex: 1, minWidth: 0, color: colors.text, fontSize: 13, padding: 4 },
  itemEditMetricsRow: { flexDirection: 'row', gap: 8 },
  itemEditMetricField: { flex: 1, minWidth: 0 },
  itemEditMetricFieldWide: { flex: 1.3, minWidth: 0 },
  itemEditMetricLabel: { color: colors.textDisabled, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  itemEditMetricInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    color: colors.text,
    fontSize: 13,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  itemRemoveBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  itemRemoveText: { color: colors.textDisabled, fontSize: 20, lineHeight: 22 },
  addItemRow: { paddingHorizontal: 14, paddingVertical: 10 },
  addItemText: { color: colors.textDisabled, fontSize: 13 },
  itemBalance: { paddingHorizontal: 14, paddingBottom: 10 },
  itemBalanceText: { fontSize: 12 },
  itemBalanceOk: { color: colors.success },
  itemBalanceWarn: { color: colors.warning },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlayStrong,
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.textInverse,
    padding: 18,
  },
  modalTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  modalSubtitle: { color: colors.textSubtle, fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 18 },
  modalLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  modalInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  modalTextarea: { minHeight: 90, textAlignVertical: 'top' },
  modalHelp: { color: colors.textSubtle, fontSize: 12, marginBottom: 16 },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  modalRightActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  modalDelete: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  modalCancel: { color: colors.textSubtle, fontSize: 14, fontWeight: '600' },
  modalSave: { color: colors.info, fontSize: 14, fontWeight: '700' },
});
