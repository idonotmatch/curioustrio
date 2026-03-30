import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { supabase } from '../lib/supabase';

export default function OnboardingScreen() {
  const router = useRouter();
  const [mode, setMode] = useState(null); // 'create' | 'join'
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAnonymous(session?.user?.is_anonymous === true);
    });
  }, []);

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await api.post('/households', { name: name.trim() });
      router.replace('/(tabs)/summary');
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to create household');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    if (!token.trim()) return;
    setLoading(true);
    try {
      await api.post(`/households/invites/${token.trim()}/accept`, {});
      router.replace('/(tabs)/summary');
    } catch (e) {
      Alert.alert('Error', 'Invalid or expired invite token');
    } finally {
      setLoading(false);
    }
  }

  if (mode === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Welcome</Text>
        {isAnonymous ? (
          <>
            <Text style={styles.subtitle}>You're tracking solo. Create an account to join or create a household.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/login')}>
              <Text style={styles.primaryText}>Create an account →</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace('/(tabs)/summary')}>
              <Text style={styles.skipText}>Continue solo</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>Set up your household to start tracking expenses together.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setMode('create')}>
              <Text style={styles.primaryText}>Create a household</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setMode('join')}>
              <Text style={styles.secondaryText}>Join with invite code</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace('/(tabs)/summary')}>
              <Text style={styles.skipText}>I'm tracking solo</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  if (mode === 'create') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Name your household</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Smith Family"
          placeholderTextColor="#555"
          value={name}
          onChangeText={setName}
          autoFocus
        />
        <TouchableOpacity style={styles.primaryBtn} onPress={handleCreate} disabled={loading}>
          <Text style={styles.primaryText}>{loading ? 'Creating…' : 'Create →'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMode(null)}>
          <Text style={styles.back}>← back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enter invite code</Text>
      <TextInput
        style={styles.input}
        placeholder="Paste invite token here"
        placeholderTextColor="#555"
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        autoFocus
      />
      <TouchableOpacity style={styles.primaryBtn} onPress={handleJoin} disabled={loading}>
        <Text style={styles.primaryText}>{loading ? 'Joining…' : 'Join →'}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setMode(null)}>
        <Text style={styles.back}>← back</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 32, justifyContent: 'center' },
  title: { fontSize: 28, color: '#fff', fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#555', fontSize: 14, marginBottom: 40, lineHeight: 20 },
  primaryBtn: { backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12 },
  primaryText: { color: '#000', fontWeight: '700', fontSize: 15 },
  secondaryBtn: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16, alignItems: 'center' },
  secondaryText: { color: '#fff', fontSize: 15 },
  input: { backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 10, padding: 14, fontSize: 15, marginBottom: 16 },
  back: { color: '#555', textAlign: 'center', marginTop: 16, fontSize: 13 },
  skipText: { color: '#555', textAlign: 'center', marginTop: 16, fontSize: 13 },
});
