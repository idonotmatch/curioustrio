import { View, Text, TouchableOpacity, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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
  return (
    <>
      <View style={styles.reviewBanner}>
        <Text style={styles.reviewBannerEyebrow}>
          {isItemsFirstReview ? 'Items first' : 'Gmail import'}
        </Text>
        <Text style={styles.reviewBannerTitle}>
          {subjectLine || expenseMerchant || 'Gmail import awaiting review'}
        </Text>
        {expenseMerchant && subjectLine && subjectLine.toLowerCase() !== `${expenseMerchant}`.toLowerCase() ? (
          <Text style={styles.reviewBannerText}>{expenseMerchant}</Text>
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
        <View style={styles.reviewFocusBlock}>
          <Text style={styles.reviewFocusTitle}>{reviewFocusSummary.title}</Text>
          <Text style={styles.reviewFocusBody}>{reviewFocusSummary.body}</Text>
        </View>
        {treatmentSuggestionSummary ? (
          <View style={styles.reviewPatternBlock}>
            <Text style={styles.reviewPatternLabel}>Usually for similar expenses</Text>
            <Text style={styles.reviewPatternBody}>{treatmentSuggestionSummary}</Text>
          </View>
        ) : null}
        {importMetaBits.length || emailSnippet ? (
          <View style={styles.reviewBannerEmailContext}>
            {importMetaBits.length ? (
              <Text style={styles.reviewBannerMeta}>{importMetaBits.join('  ·  ')}</Text>
            ) : null}
            {emailSnippet ? (
              <>
                <Text style={styles.reviewBannerEmailLabel}>Email preview</Text>
                <Text style={styles.reviewBannerEmailSnippet} numberOfLines={2}>{emailSnippet}</Text>
              </>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.priorityFieldsCard}>
        <View style={styles.priorityFieldsHeader}>
          <View>
            <Text style={styles.priorityFieldsEyebrow}>Check these details</Text>
            <Text style={styles.priorityFieldsTitle}>
              {isItemsFirstReview ? 'Start with the items, then confirm the basics' : 'Confirm the key facts before approving'}
            </Text>
          </View>
          {!editing ? (
            <TouchableOpacity onPress={() => activateReviewField(priorityReviewFields[0]?.key || 'amount')} activeOpacity={0.8}>
              <Text style={styles.priorityFieldsAction}>Edit</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {priorityReviewFields.map((field) => (
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

      <View style={styles.reviewControlsCard}>
        <Text style={styles.reviewControlsEyebrow}>Review options</Text>
        <Text style={styles.reviewControlsTitle}>Decide how this should be counted before you approve it</Text>

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

        <View style={[styles.row, { paddingVertical: 12 }]}>
          <Text style={styles.label}>Private</Text>
          <Switch
            value={isPrivate}
            onValueChange={canAdjustReviewControls ? handleTogglePrivate : undefined}
            disabled={!canAdjustReviewControls || savingControls}
            trackColor={{ false: '#1f1f1f', true: '#6366f1' }}
            thumbColor={isPrivate ? '#fff' : '#555'}
          />
        </View>

        <View style={[styles.row, { paddingVertical: 12 }]}>
          <View style={styles.trackOnlyTextWrap}>
            <Text style={styles.label}>Track only</Text>
            <Text style={styles.trackOnlyHint}>Save it without counting it toward your budget.</Text>
          </View>
          <Switch
            value={excludeFromBudget}
            onValueChange={canAdjustReviewControls ? handleToggleTrackOnly : undefined}
            disabled={!canAdjustReviewControls || savingControls}
            trackColor={{ false: '#1f1f1f', true: '#0f3a2b' }}
            thumbColor={excludeFromBudget ? '#fff' : '#555'}
          />
        </View>

        {excludeFromBudget ? (
          <View style={styles.trackOnlyReasonBlock}>
            <Text style={styles.trackOnlyReasonLabel}>Why are you tracking it separately?</Text>
            <View style={styles.reasonChipWrap}>
              {trackOnlyReasons.map((reason) => {
                const selected = budgetExclusionReason === reason.value;
                return (
                  <TouchableOpacity
                    key={reason.value}
                    style={[styles.reasonChip, selected && styles.reasonChipActive]}
                    onPress={() => canAdjustReviewControls ? handleSelectBudgetExclusionReason(reason.value) : undefined}
                    activeOpacity={0.82}
                    disabled={!canAdjustReviewControls || savingControls}
                  >
                    <Text style={[styles.reasonChipText, selected && styles.reasonChipTextActive]}>{reason.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}
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
