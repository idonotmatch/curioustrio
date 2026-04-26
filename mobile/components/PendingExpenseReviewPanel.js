import { Platform, ScrollView, TextInput, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
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

  const approvalFacts = Array.isArray(reviewDecisionFacts)
    ? reviewDecisionFacts.filter((fact) => fact?.label !== 'Sender')
    : [];
  const reviewItems = Array.isArray(items) ? items.filter((item) => item?.description) : [];
  const previewItems = reviewItems.slice(0, 3);
  const hasMoreItems = reviewItems.length > previewItems.length;
  const primaryReviewPath = automationRecommendation?.label || (isItemsFirstReview ? 'Check items first' : 'Review details');
  const categoryDetail = `${categoryExplanation?.detail || ''}`.trim();
  const reviewCategories = Array.isArray(categories) ? categories : [];

  function renderEditableSummaryChip(fact) {
    if (!fact?.label) return null;
    const lowerLabel = `${fact.label}`.toLowerCase();

    if (lowerLabel === 'total') {
      return (
        <View key={`${fact.label}:${fact.value}`} style={styles.reviewSummaryChip}>
          <Text style={styles.reviewSummaryChipLabel}>{fact.label}</Text>
          <View style={styles.inlineSummaryInputWrap}>
            <Text style={styles.inlineSummaryDollar}>$</Text>
            <TextInput
              style={styles.inlineSummaryInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="#555"
            />
          </View>
        </View>
      );
    }

    if (lowerLabel === 'merchant') {
      return (
        <View key={`${fact.label}:${fact.value}`} style={styles.reviewSummaryChip}>
          <Text style={styles.reviewSummaryChipLabel}>{fact.label}</Text>
          <TextInput
            style={styles.inlineSummaryInputText}
            value={merchant}
            onChangeText={setMerchant}
            placeholder="Merchant"
            placeholderTextColor="#555"
          />
        </View>
      );
    }

    if (lowerLabel === 'date') {
      return (
        <View key={`${fact.label}:${fact.value}`} style={styles.reviewSummaryChip}>
          <Text style={styles.reviewSummaryChipLabel}>{fact.label}</Text>
          <Text style={styles.inlineSummaryStaticValue}>{formattedDate || fact.value}</Text>
          <View style={styles.inlineDatePickerWrap}>
            <DateTimePicker
              value={date ? new Date(`${date}T12:00:00`) : new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'compact' : 'default'}
              maximumDate={new Date()}
              onChange={(_, selected) => {
                if (selected) setDate(toLocalDateString(selected));
              }}
              themeVariant="dark"
              style={styles.inlineDatePicker}
            />
          </View>
        </View>
      );
    }

    if (lowerLabel === 'category') {
      return (
        <View key={`${fact.label}:${fact.value}`} style={styles.reviewSummaryChip}>
          <Text style={styles.reviewSummaryChipLabel}>{fact.label}</Text>
          <Text style={styles.inlineSummaryStaticValue} numberOfLines={1}>{fact.value}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.inlineCategoryScroller}>
            <View style={styles.inlineCategoryRow}>
              {reviewCategories.map((category) => (
                <TouchableOpacity
                  key={category.id}
                  style={[styles.inlineCategoryChip, categoryId === category.id && styles.inlineCategoryChipActive]}
                  onPress={() => setCategoryId(category.id)}
                  activeOpacity={0.82}
                >
                  <Text style={[styles.inlineCategoryChipText, categoryId === category.id && styles.inlineCategoryChipTextActive]}>
                    {category.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      );
    }

    return (
      <View key={`${fact.label}:${fact.value}`} style={styles.reviewSummaryChip}>
        <Text style={styles.reviewSummaryChipLabel}>{fact.label}</Text>
        <Text style={styles.reviewSummaryChipValue} numberOfLines={1}>{fact.value}</Text>
      </View>
    );
  }

  return (
    <>
      <View style={styles.reviewProvenanceCard}>
        <Text style={styles.reviewSectionEyebrow}>From email</Text>
        <Text style={styles.reviewProvenanceTitle}>
          {subjectLine || expenseMerchant || 'Gmail import awaiting review'}
        </Text>
        {importMetaBits.length ? <Text style={styles.reviewProvenanceMeta}>{importMetaBits.join('  ·  ')}</Text> : null}
        <Text style={styles.reviewProvenanceSnippet} numberOfLines={1}>
          {automationRecommendation?.reason || reviewFocusSummary.body}
        </Text>
        <Text style={styles.reviewProvenanceHint}>{primaryReviewPath}</Text>
        {emailSnippet ? <Text style={styles.reviewProvenanceSnippet} numberOfLines={1}>{emailSnippet}</Text> : null}
      </View>

      <View style={styles.reviewSummaryCard}>
        <View style={styles.reviewSummaryHeader}>
          <View style={styles.headerCopyBlock}>
            <Text style={styles.reviewSectionEyebrow}>Approve this expense</Text>
            <Text style={styles.reviewSummaryTitle}>Confirm what will be saved</Text>
          </View>
          {!editing ? (
            <TouchableOpacity style={styles.headerActionWrap} onPress={() => activateReviewField(priorityReviewFields[0]?.key || 'amount')} activeOpacity={0.8}>
              <Text style={styles.priorityFieldsAction} numberOfLines={1}>Edit</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {approvalFacts.length ? (
          <View style={styles.reviewSummaryGrid}>
            {editing
              ? approvalFacts.map((fact) => renderEditableSummaryChip(fact))
              : approvalFacts.map((fact) => (
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
            <View style={styles.headerCopyBlock}>
              <Text style={styles.reviewSectionEyebrow}>Needs attention</Text>
              <Text style={styles.priorityFieldsTitle}>
                {reviewFocusSummary.title}
              </Text>
              <Text style={styles.reviewAttentionBody}>{reviewFocusSummary.body}</Text>
            </View>
            {!editing ? (
              <TouchableOpacity style={styles.headerActionWrap} onPress={() => activateReviewField(attentionFields[0]?.key || 'amount')} activeOpacity={0.8}>
                <Text style={styles.priorityFieldsAction} numberOfLines={1}>Review</Text>
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
              <Text style={styles.priorityFieldReason}>
                {field.key === 'category' && categoryDetail ? categoryDetail : field.reason}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {reviewItems.length > 0 ? (
        <View style={styles.priorityFieldsCard}>
          <View style={styles.priorityFieldsHeader}>
            <View style={styles.headerCopyBlock}>
              <Text style={styles.reviewSectionEyebrow}>Extracted items</Text>
              <Text style={styles.priorityFieldsTitle}>
                {reviewItems.length} {reviewItems.length === 1 ? 'item' : 'items'} found in the email
              </Text>
              <Text style={styles.reviewAttentionBody}>
                Check that the product names and amounts match what was actually ordered.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.headerActionWrap}
              onPress={() => {
                setItemsExpanded(true);
                activateReviewField('items');
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.priorityFieldsAction} numberOfLines={1}>Review</Text>
            </TouchableOpacity>
          </View>
          {previewItems.map((item, index) => (
            <TouchableOpacity
              key={`${item.description}:${index}`}
              style={[styles.priorityFieldRow, activeReviewField === 'items' && styles.priorityFieldRowActive]}
              onPress={() => {
                setItemsExpanded(true);
                activateReviewField('items');
              }}
              activeOpacity={0.82}
            >
              <View style={styles.priorityFieldTop}>
                <Text style={styles.priorityFieldLabel}>{item.description}</Text>
                <Text style={styles.priorityFieldLabel}>
                  {formatCurrency(item.amount) || '—'}
                </Text>
              </View>
              {item.brand ? <Text style={styles.priorityFieldReason}>{item.brand}</Text> : null}
            </TouchableOpacity>
          ))}
          {hasMoreItems ? (
            <TouchableOpacity
              style={styles.priorityFieldRow}
              onPress={() => {
                setItemsExpanded(true);
                activateReviewField('items');
              }}
              activeOpacity={0.82}
            >
              <Text style={styles.priorityFieldsAction}>View all {reviewItems.length} items</Text>
            </TouchableOpacity>
          ) : null}
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
