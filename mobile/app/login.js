import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuth0 } from 'react-native-auth0';
import { useState } from 'react';

export default function LoginScreen() {
  const { authorize } = useAuth0();
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    setLoading(true);
    try {
      await authorize({
        audience: process.env.EXPO_PUBLIC_AUTH0_AUDIENCE,
        scope: 'openid profile email offline_access',
      });
    } catch (e) {
      // User cancelled or error — stay on login screen
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Adlo</Text>
      <Text style={styles.subtitle}>Track spending together.</Text>
      <TouchableOpacity style={styles.btn} onPress={handleSignIn} disabled={loading}>
        {loading
          ? <ActivityIndicator color="#000" />
          : <Text style={styles.btnText}>Sign in</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 32, justifyContent: 'center' },
  title: { fontSize: 32, color: '#fff', fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#888', fontSize: 16, marginBottom: 48 },
  btn: { backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center' },
  btnText: { color: '#000', fontWeight: '700', fontSize: 16 },
});
