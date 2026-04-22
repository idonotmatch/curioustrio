import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ExpenseVisibilityControls } from './ExpenseVisibilityControls';

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

  const approvalFacts = Array.isArray(reviewDecisionFacts)
    ? reviewDecisionFacts.filter((fact) => fact?.label !== 'Sender')
    : [];

  return (
    <>
      <View style={styles.reviewProvenanceCard}>
        <Text style={styles.reviewSectionEyebrow}>From email</Text>
        <Text style={styles.reviewProvenanceTitle}>
          {subjectLine || expenseMerchant || 'Gmail import awaiting review'}
        </Text>
        {importMetaBits.length ? <Text style={styles.reviewProvenanceMeta}>{importMetaBits.join('  ·  ')}</Text> : null}
        {emailSnippet ? <Text style={styles.reviewProvenanceSnippet} numberOfLines={2}>{emailSnippet}</Text> : null}
      </View>

      <View style={styles.reviewSummaryCard}>
        <View style={styles.reviewSummaryHeader}>
          <View>
            <Text style={styles.reviewSectionEyebrow}>Approve this expense</Text>
            <Text style={styles.reviewSummaryTitle}>These are the details that will be saved</Text>
            {expenseMerchant && subjectLine && subjectLine.toLowerCase() !== `${expenseMerchant}`.toLowerCase() ? (
              <Text style={styles.reviewSummarySubtitle}>{expenseMerchant}</Text>
            ) : null}
          </View>
          {!editing ? (
            <TouchableOpacity onPress={() => activateReviewField(priorityReviewFields[0]?.key || 'amount')} activeOpacity={0.8}>
              <Text style={styles.priorityFieldsAction}>Edit</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {approvalFacts.length ? (
          <View style={styles.reviewSummaryGrid}>
            {approvalFacts.map((fact) => (
              <View key={`${fact.label}:${fact.value}`} style={styles.reviewSummaryChip}>
                <Text style={styles.reviewSummaryChipLabel}>{fact.label}</Text>
                <Text style={styles.reviewSummaryChipValue} numberOfLines={1}>{fact.value}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {attentionFields.length ? (
        <View style={styles.priorityFieldsCard}>
          <View style={styles.priorityFieldsHeader}>
            <View>
              <Text style={styles.reviewSectionEyebrow}>Needs attention</Text>
              <Text style={styles.priorityFieldsTitle}>
                {reviewFocusSummary.title}
              </Text>
              <Text style={styles.reviewAttentionBody}>{reviewFocusSummary.body}</Text>
            </View>
            {!editing ? (
              <TouchableOpacity onPress={() => activateReviewField(attentionFields[0]?.key || 'amount')} activeOpacity={0.8}>
                <Text style={styles.priorityFieldsAction}>Review</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {attentionFields.map((field) => (
            <TouchableOpacity
              key={field.key}
              style={[styles.priorityFieldRow, activeReviewField === field.key && styles.priorityFieldRowActive]}
              onPress={() => activateReviewField(field.key)}
              activeOpacity={0.82}
            >
              <View style={styles.priorityFieldTop}>
                <Text style={styles.priorityFieldLabel}>{field.label}</Text>
                <Ionicons name="chevron-forward" size={14} color="#5f6b7a" />
              </View>
              <Text style={styles.priorityFieldValue}>{field.value}</Text>
              <Text style={styles.priorityFieldReason}>{field.reason}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

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

      <View style={styles.reviewFieldsHeader}>
        <Text style={styles.reviewFieldsEyebrow}>Expense details</Text>
        <Text style={styles.reviewFieldsTitle}>These are the details that will be saved</Text>
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
