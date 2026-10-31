import { Modal, View, Text, TouchableOpacity } from 'react-native';
import { AdaptiveSheet } from './layout/AdaptiveLayout';

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
        <AdaptiveSheet
          style={styles.monthPickerSheet}
          accessibilityViewIsModal
          accessibilityLabel="Select month"
          onAccessibilityEscape={onClose}
        >
          <Text style={styles.monthPickerTitle}>Select month</Text>
          {months.map((month) => (
            <TouchableOpacity
              key={month}
              style={[styles.monthOption, month === selectedMonth && styles.monthOptionActive]}
              onPress={() => onSelectMonth(month)}
              accessibilityRole="radio"
              accessibilityState={{ checked: month === selectedMonth }}
            >
              <Text style={[styles.monthOptionText, month === selectedMonth && styles.monthOptionTextActive]}>
                {periodLabel(month, startDay)}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.monthPickerClose} onPress={onClose} accessibilityRole="button">
            <Text style={styles.monthPickerCloseText}>Cancel</Text>
          </TouchableOpacity>
        </AdaptiveSheet>
      </View>
    </Modal>
  );
}
