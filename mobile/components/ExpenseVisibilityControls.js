import { View, Text, TouchableOpacity, Switch } from 'react-native';

export function ExpenseVisibilityControls({
  styles,
  isPrivate,
  excludeFromBudget,
  budgetExclusionReason,
  canAdjust,
  savingControls,
  trackOnlyReasons,
  onTogglePrivate,
  onToggleTrackOnly,
  onSelectBudgetExclusionReason,
  containerStyle,
  title,
  eyebrow,
}) {
  return (
    <View style={containerStyle}>
      {eyebrow ? <Text style={styles.reviewControlsEyebrow}>{eyebrow}</Text> : null}
      {title ? <Text style={styles.reviewControlsTitle}>{title}</Text> : null}

      <View style={[styles.row, { paddingVertical: 12 }]}>
        <Text style={styles.label}>Private</Text>
        <Switch
          value={isPrivate}
          onValueChange={canAdjust ? onTogglePrivate : undefined}
          disabled={!canAdjust || savingControls}
          trackColor={{ false: '#1f1f1f', true: '#6366f1' }}
          thumbColor={isPrivate ? '#fff' : '#555'}
        />
      </View>

      <View style={[styles.row, { paddingVertical: 12 }]}>
        <View style={styles.trackOnlyTextWrap}>
          <Text style={styles.label}>Track only</Text>
          <Text style={styles.trackOnlyHint}>Save it without counting it toward your budget.</Text>
        </View>
        <Switch
          value={excludeFromBudget}
          onValueChange={canAdjust ? onToggleTrackOnly : undefined}
          disabled={!canAdjust || savingControls}
          trackColor={{ false: '#1f1f1f', true: '#0f3a2b' }}
          thumbColor={excludeFromBudget ? '#fff' : '#555'}
        />
      </View>

      {excludeFromBudget ? (
        <View style={styles.trackOnlyReasonBlock}>
          <Text style={styles.trackOnlyReasonLabel}>Why are you tracking it separately?</Text>
          <View style={styles.reasonChipWrap}>
            {trackOnlyReasons.map((reason) => {
              const selected = budgetExclusionReason === reason.value;
              return (
                <TouchableOpacity
                  key={reason.value}
                  style={[styles.reasonChip, selected && styles.reasonChipActive]}
                  onPress={() => canAdjust ? onSelectBudgetExclusionReason(reason.value) : undefined}
                  activeOpacity={0.82}
                  disabled={!canAdjust || savingControls}
                >
                  <Text style={[styles.reasonChipText, selected && styles.reasonChipTextActive]}>{reason.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}
