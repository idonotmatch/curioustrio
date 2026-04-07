import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
let ImageManipulator;
try { ImageManipulator = require('expo-image-manipulator'); } catch { /* not available in Expo Go */ }
import { NLInput } from '../../components/NLInput';
import { api } from '../../services/api';
import { useEffect, useRef, useState } from 'react';
import { createManualExpenseDraft } from '../../services/manualExpenseDraft';

export default function AddScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { auto_scan } = useLocalSearchParams();
  const [loading, setLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const didAutoScan = useRef(false);

  function startManualEntry() {
    router.push({
      pathname: '/confirm',
      params: { data: JSON.stringify(createManualExpenseDraft()) },
    });
  }

  async function handleSubmit(input) {
    try {
      setLoading(true);
      const today = new Date().toISOString().split('T')[0];
      const parsed = await api.post('/expenses/parse', { input, today });
      router.push({ pathname: '/confirm', params: { data: JSON.stringify({ ...parsed, source: 'manual' }) } });
    } catch (err) {
      if (err.message.includes('Could not parse')) {
        Alert.alert(
          "Couldn't parse that",
          "Try: '84.50 trader joes' or 'lunch chipotle 14'",
          [
            { text: 'Keep editing', style: 'cancel' },
            { text: 'Start from scratch', onPress: startManualEntry },
          ]
        );
      } else {
        Alert.alert('Error', err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleScan(fromGallery = false) {
    try {
      if (!fromGallery) {
        // Camera permission must be explicitly requested — launchCameraAsync throws
        // without it rather than prompting, causing the "scan failed" error before
        // the camera ever opens.
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
            'Camera access needed',
            'Please allow camera access in Settings to scan receipts.'
          );
          return;
        }
      }

      const pickerResult = fromGallery
        ? await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.7, mediaTypes: 'images' })
        : await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7 });

      if (pickerResult.canceled) return;

      const asset = pickerResult.assets[0];
      setScanLoading(true);

      // Resize to max 1500px wide at 60% quality before encoding.
      // Falls back to the original base64 when the native module isn't available
      // (Expo Go / simulator without a dev build).
      let imageBase64 = asset.base64;
      try {
        const resized = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: 1500 } }],
          { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );
        imageBase64 = resized.base64;
      } catch { /* native module unavailable — use original */ }

      const today = new Date().toISOString().split('T')[0];
      const parsed = await api.post('/expenses/scan', { image_base64: imageBase64, today });
      router.push({
        pathname: '/confirm',
        params: { data: JSON.stringify({ ...parsed, source: 'camera', image_uri: asset.uri }) }
      });
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('image too large')) {
        Alert.alert('Image too large', 'Receipt image is too large. Try a closer crop.');
      } else if (msg.includes('Could not parse receipt')) {
        Alert.alert(
          'Could not read receipt',
          "Couldn't read that receipt. Try better lighting or enter manually.",
          [
            { text: 'Try again', style: 'cancel' },
            { text: 'Start from scratch', onPress: startManualEntry },
          ]
        );
      } else if (msg.includes('Camera not available on simulator')) {
        Alert.alert('Simulator', 'Camera is not available in the simulator. Use "from camera roll" or test on a real device.');
      } else {
        Alert.alert('Scan failed', 'Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setScanLoading(false);
    }
  }

  useEffect(() => {
    if (auto_scan !== '1' || didAutoScan.current || scanLoading) return;
    didAutoScan.current = true;
    handleScan(false);
  }, [auto_scan, scanLoading]);

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
        <TouchableOpacity style={styles.manualBtn} onPress={startManualEntry} disabled={scanLoading || loading}>
          <Text style={styles.manualText}>start from scratch</Text>
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
  manualBtn: { alignItems: 'center', padding: 8 },
  manualText: { color: '#8a8a8a', fontSize: 12, fontWeight: '600' },
});
