import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ExpenseVisibilityControls } from './ExpenseVisibilityControls';
import { PendingExpenseEmailCard } from './PendingExpenseEmailCard';
import { PendingExpenseApprovalCard } from './PendingExpenseApprovalCard';
import { PendingExpenseAttentionCard } from './PendingExpenseAttentionCard';
import { PendingExpenseItemsCard } from './PendingExpenseItemsCard';

export function PendingExpenseReviewPanel({
  styles,
  activeReviewField,
  subjectLine,
  expenseMerchant,
  reviewDecisionFacts,
  reviewFocusSummary,
  treatmentSuggestion,
  treatmentSuggestionSummary,
  importMetaBits,
  emailSnippet,
  automationRecommendation,
  categoryExplanation,
  priorityReviewFields,
  isItemsFirstReview,
  editing,
  activateReviewField,
  applyTreatmentSuggestion,
  isPrivate,
  excludeFromBudget,
  canAdjustReviewControls,
  handleTogglePrivate,
  handleToggleTrackOnly,
  handleSelectBudgetExclusionReason,
  savingControls,
  trackOnlyReasons,
  budgetExclusionReason,
  secondaryDetailsExpanded,
  setSecondaryDetailsExpanded,
  items,
  formatCurrency,
  setItemsExpanded,
  merchant,
  setMerchant,
  amount,
  setAmount,
  date,
  setDate,
  categoryId,
  setCategoryId,
  categories,
  formattedDate,
  toLocalDateString,
}) {
  const attentionFields = Array.isArray(priorityReviewFields)
    ? priorityReviewFields.filter((field) => {
        const reason = `${field?.reason || ''}`.toLowerCase();
        if (field?.key === 'items' && isItemsFirstReview) return true;
        return (
          reason.includes('often') ||
          reason.includes('cleanup') ||
          reason.includes('inferred') ||
          reason.includes('double-check')
        );
      })
    : [];

  const reviewItems = Array.isArray(items) ? items.filter((item) => item?.description) : [];
  const previewItems = reviewItems.slice(0, 3);
  const hasMoreItems = reviewItems.length > previewItems.length;
  const primaryReviewPath = automationRecommendation?.label || (isItemsFirstReview ? 'Check items first' : 'Review details');
  const categoryDetail = `${categoryExplanation?.detail || ''}`.trim();
  const itemsCard = reviewItems.length ? (
    <PendingExpenseItemsCard
      styles={styles}
      reviewItems={reviewItems}
      previewItems={previewItems}
      hasMoreItems={hasMoreItems}
      activeReviewField={activeReviewField}
      setItemsExpanded={setItemsExpanded}
      activateReviewField={activateReviewField}
      formatCurrency={formatCurrency}
    />
  ) : null;

  return (
    <>
      <PendingExpenseEmailCard
        styles={styles}
        subjectLine={subjectLine}
        expenseMerchant={expenseMerchant}
        importMetaBits={importMetaBits}
        automationRecommendation={automationRecommendation}
        reviewFocusSummary={reviewFocusSummary}
        primaryReviewPath={primaryReviewPath}
        emailSnippet={emailSnippet}
      />

      {isItemsFirstReview ? itemsCard : null}

      <PendingExpenseApprovalCard
        styles={styles}
        editing={editing}
        activateReviewField={activateReviewField}
        priorityReviewFields={priorityReviewFields}
        reviewDecisionFacts={reviewDecisionFacts}
        amount={amount}
        setAmount={setAmount}
        merchant={merchant}
        setMerchant={setMerchant}
        date={date}
        setDate={setDate}
        categoryId={categoryId}
        setCategoryId={setCategoryId}
        categories={categories}
        formattedDate={formattedDate}
        toLocalDateString={toLocalDateString}
      />

      <PendingExpenseAttentionCard
        styles={styles}
        attentionFields={attentionFields}
        editing={editing}
        activateReviewField={activateReviewField}
        activeReviewField={activeReviewField}
        reviewFocusSummary={reviewFocusSummary}
        categoryDetail={categoryDetail}
      />

      {!isItemsFirstReview ? itemsCard : null}

      <View style={styles.reviewControlsCard}>
        {treatmentSuggestionSummary ? (
          <View style={styles.reviewPatternBlock}>
            <Text style={styles.reviewPatternLabel}>Usually for similar expenses</Text>
            <Text style={styles.reviewPatternBody}>{treatmentSuggestionSummary}</Text>
          </View>
        ) : null}
        {treatmentSuggestion ? (
          <View style={styles.reviewSuggestionCard}>
            <View style={styles.reviewSuggestionHeader}>
              <View style={styles.reviewSuggestionCopy}>
                <Text style={styles.reviewSuggestionEyebrow}>Apply the usual handling</Text>
                <Text style={styles.reviewSuggestionTitle}>{treatmentSuggestionSummary || treatmentSuggestion.summary}</Text>
                <Text style={styles.reviewSuggestionDetail}>{treatmentSuggestion.detail}</Text>
                {treatmentSuggestion.suggested_category_name ? (
                  <Text style={styles.reviewSuggestionMeta}>
                    Usually categorized as {treatmentSuggestion.suggested_category_name}
                  </Text>
                ) : null}
                {treatmentSuggestion.suggested_payment_method ? (
                  <Text style={styles.reviewSuggestionMeta}>
                    Usually paid with {treatmentSuggestion.suggested_payment_method}
                    {treatmentSuggestion.suggested_card_label ? ` · ${treatmentSuggestion.suggested_card_label}` : ''}
                    {treatmentSuggestion.suggested_card_last4 ? ` ····${treatmentSuggestion.suggested_card_last4}` : ''}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity style={styles.reviewSuggestionAction} onPress={applyTreatmentSuggestion} activeOpacity={0.82}>
                <Text style={styles.reviewSuggestionActionText}>Use this</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <ExpenseVisibilityControls
          styles={styles}
          eyebrow="Review options"
          title="Decide how this should be counted before you approve it"
          isPrivate={isPrivate}
          excludeFromBudget={excludeFromBudget}
          budgetExclusionReason={budgetExclusionReason}
          canAdjust={canAdjustReviewControls}
          savingControls={savingControls}
          trackOnlyReasons={trackOnlyReasons}
          onTogglePrivate={handleTogglePrivate}
          onToggleTrackOnly={handleToggleTrackOnly}
          onSelectBudgetExclusionReason={handleSelectBudgetExclusionReason}
        />
      </View>

      <TouchableOpacity
        style={styles.secondaryDetailsToggle}
        onPress={() => setSecondaryDetailsExpanded((value) => !value)}
        activeOpacity={0.8}
      >
        <View>
          <Text style={styles.secondaryDetailsEyebrow}>Other details</Text>
          <Text style={styles.secondaryDetailsTitle}>
            {secondaryDetailsExpanded ? 'Hide payment, notes, location, and other details' : 'Show payment, notes, location, and other details'}
          </Text>
        </View>
        <Ionicons name={secondaryDetailsExpanded ? 'chevron-up' : 'chevron-forward'} size={16} color="#7d7d7d" />
      </TouchableOpacity>
    </>
  );
}
