import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { NLInput } from '../../components/NLInput';
import { api } from '../../services/api';
import { useState } from 'react';

export default function AddScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(input) {
    try {
      setLoading(true);
      const today = new Date().toISOString().split('T')[0];
      const parsed = await api.post('/expenses/parse', { input, today });
      router.push({ pathname: '/confirm', params: { data: JSON.stringify(parsed) } });
    } catch (err) {
      if (err.message.includes('Could not parse')) {
        Alert.alert("Couldn't parse that", "Try: '84.50 trader joes' or 'lunch chipotle 14'");
      } else {
        Alert.alert('Error', err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>
        try: "242.50 trader joes" · "lunch chipotle 14.50" · "60 gas yesterday"
      </Text>
      <NLInput onSubmit={handleSubmit} loading={loading} />
      {loading && <ActivityIndicator color="#fff" style={{ marginTop: 16 }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 20 },
  hint: { color: '#555', fontSize: 12, marginBottom: 16, lineHeight: 18 },
});
