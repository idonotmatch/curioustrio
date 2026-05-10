import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { FRESHNESS_DOMAINS, markFreshnessStale } from '../services/freshnessRegistry';
import { colors } from '../theme/tokens';

export default function JoinScreen() {
  const { token } = useLocalSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState('pending'); // 'pending' | 'joining' | 'success' | 'error'
  const [error, setError] = useState('');

  useEffect(() => {
    if (token) {
      handleJoin(token);
    }
  }, [token]);

  async function handleJoin(t) {
    setStatus('joining');
    try {
      await api.post(`/households/invites/${t}/accept`, {});
      markFreshnessStale([
        FRESHNESS_DOMAINS.household,
        FRESHNESS_DOMAINS.householdExpenses,
        FRESHNESS_DOMAINS.budget,
        FRESHNESS_DOMAINS.insights,
        FRESHNESS_DOMAINS.forecastMovement,
      ], { reason: 'household_joined' });
      setStatus('success');
      setTimeout(() => router.replace('/(tabs)'), 1500);
    } catch (e) {
      setError(e.message || 'Invalid or expired invite token.');
      setStatus('error');
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Join Household' }} />
      <View style={styles.container}>
        {status === 'joining' && (
          <>
            <ActivityIndicator color={colors.text} size="large" />
            <Text style={styles.message}>Joining household…</Text>
          </>
        )}
        {status === 'success' && (
          <Text style={styles.message}>✓ Joined! Redirecting…</Text>
        )}
        {status === 'error' && (
          <>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.btn} onPress={() => router.replace('/(tabs)')}>
              <Text style={styles.btnText}>Go to app</Text>
            </TouchableOpacity>
          </>
        )}
        {status === 'pending' && !token && (
          <>
            <Text style={styles.errorText}>No invite token found.</Text>
            <TouchableOpacity style={styles.btn} onPress={() => router.replace('/(tabs)')}>
              <Text style={styles.btnText}>Go to app</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 32 },
  message: { color: colors.text, fontSize: 16, marginTop: 16, textAlign: 'center' },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center', marginBottom: 24 },
  btn: { backgroundColor: colors.borderSubtle, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12, borderWidth: 1, borderColor: colors.borderStrong },
  btnText: { color: colors.text, fontSize: 14, fontWeight: '500' },
});
