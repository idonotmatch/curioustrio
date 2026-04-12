import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export const DISMISS_REASON_OPTIONS = [
  { value: 'not_an_expense', label: 'Not an expense' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'business_or_track_only', label: 'Business or track only' },
  { value: 'transfer_or_payment', label: 'Transfer or payment' },
  { value: 'wrong_details', label: 'Wrong details' },
  { value: 'other', label: 'Other' },
];

export function DismissReasonSheet({ visible, onClose, onSelect, busy = false }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Why dismiss this import?</Text>
          <Text style={styles.subtitle}>
            This helps us learn what should stay out of your review queue next time.
          </Text>
          <View style={styles.options}>
            {DISMISS_REASON_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.option, busy && styles.optionDisabled]}
                disabled={busy}
                activeOpacity={0.82}
                onPress={() => onSelect(option.value)}
              >
                <Text style={styles.optionText}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.cancel} onPress={onClose} disabled={busy}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#111',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 18,
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  subtitle: { color: '#8e8e8e', fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 18 },
  options: { gap: 10 },
  option: {
    backgroundColor: '#0b0b0b',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  optionDisabled: { opacity: 0.5 },
  optionText: { color: '#f5f5f5', fontSize: 14, fontWeight: '600' },
  cancel: { marginTop: 18, alignItems: 'center' },
  cancelText: { color: '#8a8a8a', fontSize: 14, fontWeight: '600' },
});
