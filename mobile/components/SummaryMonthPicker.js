import { Modal, View, Text, TouchableOpacity } from 'react-native';

export function SummaryMonthPicker({
  styles,
  visible,
  onClose,
  months,
  selectedMonth,
  onSelectMonth,
  periodLabel,
  startDay,
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.monthPickerOverlay}>
        <View style={styles.monthPickerSheet}>
          <Text style={styles.monthPickerTitle}>Select month</Text>
          {months.map((month) => (
            <TouchableOpacity
              key={month}
              style={[styles.monthOption, month === selectedMonth && styles.monthOptionActive]}
              onPress={() => onSelectMonth(month)}
            >
              <Text style={[styles.monthOptionText, month === selectedMonth && styles.monthOptionTextActive]}>
                {periodLabel(month, startDay)}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.monthPickerClose} onPress={onClose}>
            <Text style={styles.monthPickerCloseText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
