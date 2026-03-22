import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { NLInput } from '../../components/NLInput';
import { api } from '../../services/api';
import { useState } from 'react';

export default function AddScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);

  async function handleSubmit(input) {
    try {
      setLoading(true);
      const today = new Date().toISOString().split('T')[0];
      const parsed = await api.post('/expenses/parse', { input, today });
      router.push({ pathname: '/confirm', params: { data: JSON.stringify({ ...parsed, source: 'manual' }) } });
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

  async function handleScan(fromGallery = false) {
    try {
      const pickerResult = fromGallery
        ? await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.7, mediaTypes: 'images' })
        : await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7 });

      if (pickerResult.canceled) return;

      const asset = pickerResult.assets[0];
      setScanLoading(true);
      const today = new Date().toISOString().split('T')[0];
      const parsed = await api.post('/expenses/scan', { image_base64: asset.base64, today });
      router.push({
        pathname: '/confirm',
        params: { data: JSON.stringify({ ...parsed, source: 'camera', image_uri: asset.uri }) }
      });
    } catch (err) {
      Alert.alert('Scan failed', 'Could not read receipt. Try entering manually.');
    } finally {
      setScanLoading(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.hint}>
        try: "242.50 trader joes" · "lunch chipotle 14.50" · "60 gas yesterday"
      </Text>
      <NLInput onSubmit={handleSubmit} loading={loading} />
      {loading && <ActivityIndicator color="#fff" style={{ marginTop: 16 }} />}
      <View style={styles.scanRow}>
        <TouchableOpacity style={styles.scanBtn} onPress={() => handleScan(false)} disabled={scanLoading}>
          <Text style={styles.scanText}>{scanLoading ? 'scanning...' : '📷  scan receipt'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.galleryBtn} onPress={() => handleScan(true)} disabled={scanLoading}>
          <Text style={styles.galleryText}>from camera roll</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', paddingHorizontal: 20, paddingBottom: 20 },
  hint: { color: '#555', fontSize: 12, marginBottom: 16, lineHeight: 18 },
  scanRow: { marginTop: 24, gap: 10 },
  scanBtn: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 16, alignItems: 'center' },
  scanText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  galleryBtn: { alignItems: 'center', padding: 8 },
  galleryText: { color: '#555', fontSize: 12 },
});
