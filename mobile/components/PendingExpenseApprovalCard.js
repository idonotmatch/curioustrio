import { Platform, ScrollView, TextInput, View, Text, TouchableOpacity } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

function EditableSummaryFields({
  styles,
  amount,
  setAmount,
  merchant,
  setMerchant,
  date,
  setDate,
  categoryId,
  setCategoryId,
  categories,
  formattedDate,
  toLocalDateString,
}) {
  const reviewCategories = Array.isArray(categories) ? categories : [];

  return (
    <View style={styles.inlineEditFieldList}>
      <View style={styles.inlineEditFieldCard}>
        <Text style={styles.reviewSummaryChipLabel}>Total</Text>
        <View style={styles.inlineEditAmountRow}>
          <Text style={styles.inlineEditAmountDollar}>$</Text>
          <TextInput
            style={styles.inlineEditAmountInput}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor="#555"
          />
        </View>
      </View>

      <View style={styles.inlineEditFieldCard}>
        <Text style={styles.reviewSummaryChipLabel}>Merchant</Text>
        <TextInput
          style={styles.inlineEditTextInput}
          value={merchant}
          onChangeText={setMerchant}
          placeholder="Merchant"
          placeholderTextColor="#555"
        />
      </View>

      <View style={styles.inlineEditFieldCard}>
        <Text style={styles.reviewSummaryChipLabel}>Date</Text>
        <Text style={styles.inlineEditStaticValue}>{formattedDate || 'Select a date'}</Text>
        <View style={styles.inlineEditDateRow}>
          <DateTimePicker
            value={date ? new Date(`${date}T12:00:00`) : new Date()}
            mode="date"
            display={Platform.OS === 'ios' ? 'compact' : 'default'}
            maximumDate={new Date()}
            onChange={(_, selected) => {
              if (selected) setDate(toLocalDateString(selected));
            }}
            themeVariant="dark"
            style={styles.inlineEditDatePicker}
          />
        </View>
      </View>

      <View style={styles.inlineEditFieldCard}>
        <Text style={styles.reviewSummaryChipLabel}>Category</Text>
        <Text style={styles.inlineEditStaticValue} numberOfLines={1}>
          {reviewCategories.find((category) => category.id === categoryId)?.name || 'Select a category'}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.inlineEditCategoryScroller}>
          <View style={styles.inlineEditCategoryRow}>
            {reviewCategories.map((category) => (
              <TouchableOpacity
                key={category.id}
                style={[styles.inlineEditCategoryChip, categoryId === category.id && styles.inlineEditCategoryChipActive]}
                onPress={() => setCategoryId(category.id)}
                activeOpacity={0.82}
              >
                <Text style={[styles.inlineEditCategoryChipText, categoryId === category.id && styles.inlineEditCategoryChipTextActive]}>
                  {category.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

export function PendingExpenseApprovalCard({
  styles,
  editing,
  activateReviewField,
  priorityReviewFields,
  reviewDecisionFacts,
  amount,
  setAmount,
  merchant,
  setMerchant,
  date,
  setDate,
  categoryId,
  setCategoryId,
  categories,
  formattedDate,
  toLocalDateString,
}) {
  const approvalFacts = Array.isArray(reviewDecisionFacts)
    ? reviewDecisionFacts.filter((fact) => fact?.label !== 'Sender')
    : [];

  return (
    <View style={styles.reviewSummaryCard}>
      <View style={styles.reviewSummaryHeader}>
        <View style={styles.headerCopyBlock}>
          <Text style={styles.reviewSectionEyebrow}>Approve this expense</Text>
          <Text style={styles.reviewSummaryTitle}>{editing ? 'Edit what will be saved' : 'Confirm what will be saved'}</Text>
          <Text style={styles.reviewSummarySubtitle}>
            {editing
              ? 'Update the saved fields here, then approve when they look right.'
              : 'Approve as-is or edit the core details before saving.'}
          </Text>
        </View>
        {!editing ? (
          <TouchableOpacity style={styles.headerActionWrap} onPress={() => activateReviewField(priorityReviewFields[0]?.key || 'amount')} activeOpacity={0.8}>
            <Text style={styles.priorityFieldsAction} numberOfLines={1}>Edit</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {approvalFacts.length ? (
        editing ? (
          <EditableSummaryFields
            styles={styles}
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
        ) : (
          <View style={styles.reviewSummaryGrid}>
            {approvalFacts.map((fact) => (
              <View key={`${fact.label}:${fact.value}`} style={styles.reviewSummaryChip}>
                <Text style={styles.reviewSummaryChipLabel}>{fact.label}</Text>
                <Text style={styles.reviewSummaryChipValue} numberOfLines={1}>{fact.value}</Text>
              </View>
            ))}
          </View>
        )
      ) : null}
    </View>
  );
}
