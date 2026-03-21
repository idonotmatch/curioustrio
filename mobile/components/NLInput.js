import { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet } from 'react-native';

export function NLInput({ onSubmit, loading }) {
  const [value, setValue] = useState('');

  function handleSubmit() {
    if (value.trim()) {
      onSubmit(value.trim());
      setValue('');
    }
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        placeholder="242.50 trader joes"
        placeholderTextColor="#555"
        onSubmitEditing={handleSubmit}
        editable={!loading}
        autoCorrect={false}
      />
      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
        <Text style={styles.buttonText}>→</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14,
    color: '#fff', fontSize: 16, borderWidth: 1, borderColor: '#333',
  },
  button: {
    backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 20,
    justifyContent: 'center',
  },
  buttonText: { fontSize: 18, fontWeight: '700', color: '#000' },
});
