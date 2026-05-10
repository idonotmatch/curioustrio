import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/tokens';

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
    backgroundColor: colors.overlayStrong,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.textInverse,
    padding: 18,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  subtitle: { color: colors.textSubtle, fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 18 },
  options: { gap: 10 },
  option: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  optionDisabled: { opacity: 0.5 },
  optionText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  cancel: { marginTop: 18, alignItems: 'center' },
  cancelText: { color: colors.textSubtle, fontSize: 14, fontWeight: '600' },
});
