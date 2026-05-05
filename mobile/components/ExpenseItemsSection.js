import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createEditableExpenseItem, updateEditableExpenseItem } from '../services/itemEditing';

export function ExpenseItemsSection({
  styles,
  items,
  itemsExpanded,
  setItemsExpanded,
  activeReviewField,
  editing,
  canEdit,
  itemsEdits,
  setItemsEdits,
  amount,
  itemSignals,
  itemMatchLabel,
  formatItemStructuredMeta,
  itemSubmeta,
}) {
  const showSection = items.length > 0 || (editing && canEdit);
  if (!showSection) return null;

  return (
    <>
      <TouchableOpacity
        style={[styles.itemsHeader, activeReviewField === 'items' && styles.itemsHeaderActive]}
        onPress={() => setItemsExpanded((value) => !value)}
        activeOpacity={0.7}
      >
        <Text style={[styles.itemsHeaderText, activeReviewField === 'items' && styles.itemsHeaderTextActive]}>
          {items.length > 0 ? `${items.length} ${items.length === 1 ? 'item' : 'items'}` : 'Items'}
        </Text>
        <Ionicons name={itemsExpanded ? 'chevron-up' : 'chevron-forward'} size={14} color={activeReviewField === 'items' ? '#f5f5f5' : '#444'} />
      </TouchableOpacity>

      {itemsExpanded ? (
        <View style={styles.itemsList}>
          {editing && canEdit ? (
            <>
              {itemsEdits.map((item, index) => (
                <View key={index} style={styles.itemEditCard}>
                  <View style={styles.itemEditRow}>
                    <TextInput
                      style={styles.itemEditDesc}
                      value={item.description}
                      onChangeText={(value) => setItemsEdits((current) => current.map((entry, entryIndex) => (
                        entryIndex === index ? updateEditableExpenseItem(entry, 'description', value) : entry
                      )))}
                      placeholder="Description"
                      placeholderTextColor="#444"
                    />
                    <TouchableOpacity
                      onPress={() => setItemsEdits((current) => current.filter((_, entryIndex) => entryIndex !== index))}
                      style={styles.itemRemoveBtn}
                    >
                      <Text style={styles.itemRemoveText}>×</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.itemEditMetricsRow}>
                    <View style={styles.itemEditMetricField}>
                      <Text style={styles.itemEditMetricLabel}>Qty</Text>
                      <TextInput
                        style={styles.itemEditMetricInput}
                        value={item.quantity}
                        onChangeText={(value) => setItemsEdits((current) => current.map((entry, entryIndex) => (
                          entryIndex === index ? updateEditableExpenseItem(entry, 'quantity', value) : entry
                        )))}
                        placeholder="1"
                        placeholderTextColor="#444"
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={styles.itemEditMetricField}>
                      <Text style={styles.itemEditMetricLabel}>Each</Text>
                      <TextInput
                        style={styles.itemEditMetricInput}
                        value={item.unit_price}
                        onChangeText={(value) => setItemsEdits((current) => current.map((entry, entryIndex) => (
                          entryIndex === index ? updateEditableExpenseItem(entry, 'unit_price', value) : entry
                        )))}
                        placeholder="0.00"
                        placeholderTextColor="#444"
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={styles.itemEditMetricFieldWide}>
                      <Text style={styles.itemEditMetricLabel}>Total</Text>
                      <TextInput
                        style={styles.itemEditMetricInput}
                        value={item.amount}
                        onChangeText={(value) => setItemsEdits((current) => current.map((entry, entryIndex) => (
                          entryIndex === index ? updateEditableExpenseItem(entry, 'amount', value) : entry
                        )))}
                        placeholder="0.00"
                        placeholderTextColor="#444"
                        keyboardType="decimal-pad"
                      />
                    </View>
                  </View>
                </View>
              ))}

              <TouchableOpacity
                onPress={() => setItemsEdits((current) => [...current, createEditableExpenseItem({
                  description: '',
                  amount: '',
                  quantity: '',
                  unit_price: '',
                })])}
                style={styles.addItemRow}
              >
                <Text style={styles.addItemText}>+ Add item</Text>
              </TouchableOpacity>

              <ItemBalanceSummary styles={styles} itemsEdits={itemsEdits} amount={amount} />
            </>
          ) : (
            <>
              <View style={styles.itemSummaryRow}>
                {itemSignals.matched > 0 ? (
                  <View style={styles.itemSummaryChip}>
                    <Text style={styles.itemSummaryChipText}>{itemSignals.matched} matched</Text>
                  </View>
                ) : null}
                {itemSignals.unitPriced > 0 ? (
                  <View style={styles.itemSummaryChip}>
                    <Text style={styles.itemSummaryChipText}>{itemSignals.unitPriced} unit priced</Text>
                  </View>
                ) : null}
                {itemSignals.nonProduct > 0 ? (
                  <View style={styles.itemSummaryChipMuted}>
                    <Text style={styles.itemSummaryChipTextMuted}>{itemSignals.nonProduct} fees or extras</Text>
                  </View>
                ) : null}
              </View>

              {items.map((item, index) => {
                const matchLabel = itemMatchLabel(item);
                const structuredMeta = formatItemStructuredMeta(item);
                const submeta = itemSubmeta(item);

                return (
                  <View key={index} style={styles.itemReadRow}>
                    <View style={styles.itemReadText}>
                      <View style={styles.itemReadTop}>
                        <Text style={styles.itemReadDesc}>{item.description || 'Untitled item'}</Text>
                        {matchLabel ? (
                          <View style={styles.itemMatchChip}>
                            <Text style={styles.itemMatchChipText}>{matchLabel}</Text>
                          </View>
                        ) : null}
                      </View>
                      {structuredMeta ? <Text style={styles.itemReadMeta}>{structuredMeta}</Text> : null}
                      {submeta ? <Text style={styles.itemReadSubmeta}>{submeta}</Text> : null}
                    </View>
                    {item.amount != null ? (
                      <Text style={styles.itemReadAmount}>${Number(item.amount).toFixed(2)}</Text>
                    ) : null}
                  </View>
                );
              })}
            </>
          )}
        </View>
      ) : null}
    </>
  );
}

function ItemBalanceSummary({ styles, itemsEdits, amount }) {
  const itemSum = itemsEdits.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const total = parseFloat(amount) || 0;
  const hasAmounts = itemsEdits.some((item) => item.amount !== '');
  if (!hasAmounts || total === 0) return null;

  const diff = total - itemSum;
  const balanced = Math.abs(diff) < 0.01;

  return (
    <View style={styles.itemBalance}>
      <Text style={[styles.itemBalanceText, balanced ? styles.itemBalanceOk : styles.itemBalanceWarn]}>
        {balanced
          ? '✓ Items match total'
          : diff > 0
            ? `$${diff.toFixed(2)} unaccounted`
            : `$${Math.abs(diff).toFixed(2)} over total`}
      </Text>
    </View>
  );
}
