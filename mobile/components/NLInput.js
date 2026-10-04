import { useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme/tokens';

export function NLInput({ onSubmit, loading }) {
  const [value, setValue] = useState('');

  async function handleSubmit() {
    const submitted = value.trim();
    if (!submitted || loading) return;
    try {
      const result = await onSubmit(submitted);
      if (result !== false) {
        setValue('');
      }
    } catch {
      // Keep the typed value in place so the user can keep editing.
    }
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        placeholder="242.50 trader joes"
        placeholderTextColor={colors.textDisabled}
        onSubmitEditing={handleSubmit}
        editable={!loading}
        autoCorrect
        spellCheck
        autoCapitalize="sentences"
      />
      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color={colors.textInverse} /> : <Ionicons name="arrow-forward" size={18} color={colors.textInverse} />}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', gap: spacing.sm },
  input: {
    flex: 1, backgroundColor: colors.surfaceRaised, borderRadius: radius.md, padding: 14,
    color: colors.text, fontSize: 16, borderWidth: 1, borderColor: colors.border,
  },
  button: {
    backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: 20,
    justifyContent: 'center',
  },
});
