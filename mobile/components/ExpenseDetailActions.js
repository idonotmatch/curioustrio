import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { colors } from '../theme/tokens';

export function ExpenseDetailActions({
  styles,
  expense,
  editing,
  canEdit,
  saving,
  handleSave,
  actioning,
  approvePendingExpense,
  openDismissReasonSheet,
  isItemsFirstReview,
  isQuickCheckReview,
  deleting,
  handleDelete,
  onReviewDuplicate,
}) {
  return (
    <>
      {expense?.duplicate_flags?.length > 0 ? (
        <View style={styles.dupSection}>
          <Text style={styles.dupTitle}>Possible duplicate</Text>
          {expense.duplicate_flags.map((flag) => (
            <Text key={flag.id} style={styles.dupItem}>
              Confidence: {flag.confidence} · {flag.status}
            </Text>
          ))}
          <TouchableOpacity style={styles.dupReviewBtn} onPress={() => onReviewDuplicate?.(expense.duplicate_flags[0])} accessibilityRole="button" accessibilityLabel="Compare possible duplicate expenses">
            <Text style={styles.dupReviewBtnText}>Compare expenses</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {editing && canEdit ? (
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving} accessibilityRole="button" accessibilityLabel="Save expense changes" accessibilityState={{ disabled: saving, busy: saving }}>
          {saving ? <ActivityIndicator color={colors.textInverse} size="small" /> : <Text style={styles.saveBtnText}>Save changes</Text>}
        </TouchableOpacity>
      ) : null}

      {!editing && expense?.status === 'pending' && !expense?.duplicate_flags?.length ? (
        <View style={styles.pendingActions}>
          <TouchableOpacity
            style={[styles.approveBtn, actioning && { opacity: 0.5 }]}
            disabled={actioning}
            onPress={approvePendingExpense}
            accessibilityRole="button"
            accessibilityLabel={isItemsFirstReview ? 'Approve after item check' : isQuickCheckReview ? 'Approve after quick check' : 'Approve expense'}
            accessibilityState={{ disabled: Boolean(actioning), busy: Boolean(actioning) }}
          >
            <Text style={styles.approveBtnText}>
              {isItemsFirstReview ? 'Approve after item check' : isQuickCheckReview ? 'Approve after quick check' : 'Approve'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dismissBtn, actioning && { opacity: 0.5 }]}
            disabled={actioning}
            onPress={openDismissReasonSheet}
            accessibilityRole="button"
            accessibilityLabel="Dismiss pending expense"
            accessibilityState={{ disabled: Boolean(actioning), busy: Boolean(actioning) }}
          >
            <Text style={styles.dismissBtnText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {canEdit ? (
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} disabled={deleting} accessibilityRole="button" accessibilityLabel="Delete expense" accessibilityState={{ disabled: deleting, busy: deleting }}>
          {deleting
            ? <ActivityIndicator color={colors.danger} size="small" />
            : <Text style={styles.deleteBtnText}>Delete expense</Text>}
        </TouchableOpacity>
      ) : null}
    </>
  );
}
