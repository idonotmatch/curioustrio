import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth0 } from 'react-native-auth0';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AccountsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, clearSession } = useAuth0();

  async function handleLogout() {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          try {
            await clearSession();
          } catch {
            // ignore
          }
        },
      },
    ]);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>PROFILE</Text>
        {user?.name && <Text style={styles.value}>{user.name}</Text>}
        {user?.email && <Text style={styles.sub}>{user.email}</Text>}
      </View>

      <View style={styles.section}>
        <TouchableOpacity style={styles.dangerRow} onPress={handleLogout}>
          <Text style={styles.dangerText}>Log out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 20 },
  section: { marginBottom: 32, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', paddingBottom: 24 },
  sectionTitle: { fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  value: { color: '#f5f5f5', fontSize: 16, fontWeight: '500' },
  sub: { color: '#666', fontSize: 13, marginTop: 4 },
  dangerRow: { paddingVertical: 12 },
  dangerText: { color: '#ef4444', fontSize: 15 },
});
