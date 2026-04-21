import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';

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
        </View>
      ) : null}

      {editing && canEdit ? (
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save changes'}</Text>
        </TouchableOpacity>
      ) : null}

      {!editing && expense?.status === 'pending' ? (
        <View style={styles.pendingActions}>
          <TouchableOpacity
            style={[styles.approveBtn, actioning && { opacity: 0.5 }]}
            disabled={actioning}
            onPress={approvePendingExpense}
          >
            <Text style={styles.approveBtnText}>
              {isItemsFirstReview ? 'Approve after item check' : isQuickCheckReview ? 'Approve after quick check' : 'Approve'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dismissBtn, actioning && { opacity: 0.5 }]}
            disabled={actioning}
            onPress={openDismissReasonSheet}
          >
            <Text style={styles.dismissBtnText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {canEdit ? (
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} disabled={deleting}>
          {deleting
            ? <ActivityIndicator color="#ef4444" size="small" />
            : <Text style={styles.deleteBtnText}>Delete expense</Text>}
        </TouchableOpacity>
      ) : null}
    </>
  );
}
