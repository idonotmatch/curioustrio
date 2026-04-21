import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Swipeable from 'react-native-gesture-handler/Swipeable';

export function SummaryRecentActivity({
  styles,
  recent,
  pendingExpensesCount,
  gmailRefreshTimestamp,
  gmailRefreshVerb,
  formatRelativeTime,
  formatDate,
  onPressSeeAll,
  onPressExpense,
  onDeleteExpense,
}) {
  function renderDeleteAction(id) {
    return (
      <TouchableOpacity
        style={styles.deleteAction}
        onPress={() => Alert.alert('Delete expense', 'This cannot be undone.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => onDeleteExpense(id) },
        ])}
      >
        <Ionicons name="trash-outline" size={18} color="#fff" />
        <Text style={styles.deleteActionText}>Delete</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.recent}>
      <View style={styles.recentHeader}>
        <View style={styles.recentHeading}>
          <Text style={styles.sectionLabelCompact}>Recent</Text>
          <Text style={styles.recentMeta}>
            {`${pendingExpensesCount} pending`}
            {gmailRefreshTimestamp ? ` · Gmail ${gmailRefreshVerb} ${formatRelativeTime(gmailRefreshTimestamp)}` : ''}
          </Text>
        </View>
        <TouchableOpacity onPress={onPressSeeAll}>
          <Text style={styles.seeAll}>See all</Text>
        </TouchableOpacity>
      </View>

      {recent.map((expense) => (
        <Swipeable
          key={expense.id}
          renderRightActions={() => renderDeleteAction(expense.id)}
          overshootRight={false}
        >
          <TouchableOpacity
            style={styles.recentRow}
            onPress={() => onPressExpense(expense.id)}
          >
            <Text style={styles.recentMerchant} numberOfLines={1}>
              {expense.merchant || expense.description || '—'}
            </Text>
            <Text style={styles.recentDate}>{formatDate(expense.date)}</Text>
            <Text style={[styles.recentAmount, Number(expense.amount) < 0 && styles.recentRefund]}>
              {Number(expense.amount) < 0 ? '−' : ''}${Math.abs(Number(expense.amount)).toFixed(2)}
            </Text>
          </TouchableOpacity>
        </Swipeable>
      ))}

      {recent.length === 0 ? <Text style={styles.emptyText}>No confirmed expenses yet.</Text> : null}
    </View>
  );
}
