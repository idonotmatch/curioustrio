import { View, Text, Modal, TextInput, TouchableOpacity } from 'react-native';

export function RecurringExpenseModal({
  styles,
  visible,
  onClose,
  recurringPreference,
  recurringFrequencyDays,
  setRecurringFrequencyDays,
  recurringNotes,
  setRecurringNotes,
  removeRecurringPreference,
  saveRecurringPreference,
  actioning,
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Recurring purchase</Text>
          <Text style={styles.modalSubtitle}>
            Mark this so Adlo can treat it as a common recurring purchase and make better timing and price recommendations.
          </Text>

          <Text style={styles.modalLabel}>How often do you usually buy this?</Text>
          <TextInput
            style={styles.modalInput}
            value={recurringFrequencyDays}
            onChangeText={(value) => setRecurringFrequencyDays(value.replace(/\D/g, '').slice(0, 3))}
            placeholder="e.g. 14"
            placeholderTextColor="#555"
            keyboardType="number-pad"
          />
          <Text style={styles.modalHelp}>Days between purchases. Leave blank if you are not sure yet.</Text>

          <Text style={styles.modalLabel}>Anything else we should know?</Text>
          <TextInput
            style={[styles.modalInput, styles.modalTextarea]}
            value={recurringNotes}
            onChangeText={setRecurringNotes}
            placeholder="Optional note"
            placeholderTextColor="#555"
            multiline
          />

          <View style={styles.modalActions}>
            {recurringPreference ? (
              <TouchableOpacity onPress={removeRecurringPreference} disabled={actioning}>
                <Text style={styles.modalDelete}>Remove flag</Text>
              </TouchableOpacity>
            ) : <View />}
            <View style={styles.modalRightActions}>
              <TouchableOpacity onPress={onClose} disabled={actioning}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveRecurringPreference} disabled={actioning}>
                <Text style={styles.modalSave}>{actioning ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
