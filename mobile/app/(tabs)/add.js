import { View, Text, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
let ImageManipulator;
try { ImageManipulator = require('expo-image-manipulator'); } catch { /* not available in Expo Go */ }
import { NLInput } from '../../components/NLInput';
import { api } from '../../services/api';
const { receiptScanErrorPresentation } = require('../../services/receiptScanPresentation');
const {
  RECEIPT_IMAGE_MAX_BASE64_LENGTH,
  fallbackReceiptImagePlan,
  primaryReceiptImagePlan,
} = require('../../services/receiptImagePreparation');
import { useEffect, useRef, useState } from 'react';
import { toLocalDateString } from '../../services/date';
import { pushConfirmDraft } from '../../services/confirmNavigation';
import { ActionRow, SecondaryButton } from '../../components/ui/Buttons';
import { LoadingState } from '../../components/ui/States';
import { colors, radius, spacing, typography } from '../../theme/tokens';

export default function AddScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { auto_scan, auto_document } = useLocalSearchParams();
  const [loading, setLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const didAutoScan = useRef(false);
  const didAutoDocument = useRef(false);
  const processingMessage = scanLoading
    ? 'Reading your receipt. This can take a few seconds.'
    : loading
      ? 'Parsing your expense...'
      : null;

  function startManualEntry() {
    router.push('/manual-add');
  }

  async function handleSubmit(input) {
    try {
      setLoading(true);
      const today = toLocalDateString();
      const parsed = await api.post('/expenses/parse', { input, today });
      pushConfirmDraft(router, { ...parsed, source: 'manual' });
      return true;
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
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function parseReceiptImage(asset, source = 'camera') {
    let imageBase64 = asset.base64 || await new File(asset.uri).base64();
    try {
      const primaryPlan = primaryReceiptImagePlan(asset);
      const resized = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: primaryPlan.width } }],
        { compress: primaryPlan.compress, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      imageBase64 = resized.base64;
      if ((imageBase64?.length || 0) > RECEIPT_IMAGE_MAX_BASE64_LENGTH) {
        const fallbackPlan = fallbackReceiptImagePlan(asset);
        const compressed = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: fallbackPlan.width } }],
          { compress: fallbackPlan.compress, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );
        imageBase64 = compressed.base64;
      }
    } catch { /* use the picker-provided or file-system image */ }

    if (!imageBase64 || imageBase64.length > RECEIPT_IMAGE_MAX_BASE64_LENGTH) {
      throw new Error('Receipt image is too large. Crop closer to the receipt and try again.');
    }
    const parsed = await api.post('/expenses/scan', {
      image_base64: imageBase64,
      today: toLocalDateString(),
    });
    pushConfirmDraft(router, { ...parsed, source, image_uri: asset.uri });
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
        ? await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.9, mediaTypes: 'images' })
        : await ImagePicker.launchCameraAsync({ base64: true, quality: 0.9 });

      if (pickerResult.canceled) return;

      const asset = pickerResult.assets[0];
      setScanLoading(true);
      await parseReceiptImage(asset, 'camera');
    } catch (err) {
      const msg = err?.message || '';
      const presentation = receiptScanErrorPresentation(err);
      if (presentation?.canEnterManually) {
        Alert.alert(
          presentation.title,
          presentation.message,
          [
            { text: 'Try again', style: 'cancel' },
            { text: 'Start from scratch', onPress: startManualEntry },
          ]
        );
      } else if (presentation) {
        Alert.alert(presentation.title, presentation.message);
      } else if (msg.includes('Camera not available on simulator')) {
        Alert.alert('Simulator', 'Camera is not available in the simulator. Use "from camera roll" or test on a real device.');
      } else if (msg.includes('Receipt image is too large')) {
        Alert.alert('Crop the receipt', msg);
      } else {
        Alert.alert('Scan failed', 'Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setScanLoading(false);
    }
  }

  async function handleDocumentImport() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      setScanLoading(true);
      const isPdf = asset.mimeType === 'application/pdf' || `${asset.name || ''}`.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        if (Number(asset.size || 0) > 7_000_000) {
          throw new Error('Receipt PDF is too large. Choose a file smaller than 7MB.');
        }
        const documentBase64 = await new File(asset.uri).base64();
        const parsed = await api.post('/expenses/scan-document', {
          document_base64: documentBase64,
          file_name: asset.name || 'receipt.pdf',
          today: toLocalDateString(),
        });
        pushConfirmDraft(router, { ...parsed, source: 'share' });
      } else {
        await parseReceiptImage(asset, 'share');
      }
    } catch (err) {
      const presentation = receiptScanErrorPresentation(err);
      Alert.alert(
        presentation?.title || 'Could not read receipt file',
        presentation?.message || err?.message || 'Choose a receipt image or a text-based PDF and try again.'
      );
    } finally {
      setScanLoading(false);
    }
  }

  useEffect(() => {
    if (auto_scan !== '1' || didAutoScan.current || scanLoading) return;
    didAutoScan.current = true;
    handleScan(false);
  }, [auto_scan, scanLoading]);

  useEffect(() => {
    if (auto_document !== '1' || didAutoDocument.current || scanLoading) return;
    didAutoDocument.current = true;
    handleDocumentImport();
  }, [auto_document, scanLoading]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.hint}>
        try: "242.50 trader joes" · "whole foods chicken, berries, yogurt 48.12"
      </Text>
      <NLInput onSubmit={handleSubmit} loading={loading} />
      {processingMessage ? (
        <LoadingState compact label={processingMessage} style={styles.processingBanner} />
      ) : null}
      <View style={styles.scanRow}>
        <ActionRow
          icon="compass-outline"
          title="Consider a purchase"
          body="Check whether it fits, compare funding paths, and revisit it later."
          onPress={() => router.push('/plan/new')}
          disabled={scanLoading || loading}
        />
        <ActionRow
          icon="create-outline"
          title="Manual add"
          body="Use the structured form when you want exact fields."
          onPress={startManualEntry}
          disabled={scanLoading || loading}
        />
        <ActionRow
          icon="camera-outline"
          title={scanLoading ? 'Scanning receipt' : 'Scan receipt'}
          body="Use the camera to pull merchant, amount, and date from a receipt."
          onPress={() => handleScan(false)}
          disabled={scanLoading}
        />
        <SecondaryButton
          title="Choose from camera roll"
          icon="images-outline"
          onPress={() => handleScan(true)}
          disabled={scanLoading}
        />
        <SecondaryButton
          title="Import receipt file"
          icon="document-attach-outline"
          onPress={handleDocumentImport}
          disabled={scanLoading}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  hint: { color: colors.textSubtle, fontSize: 12, marginBottom: spacing.lg, lineHeight: 18 },
  processingBanner: {
    marginTop: spacing.lg,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  scanRow: { marginTop: 24, gap: spacing.md },
});
