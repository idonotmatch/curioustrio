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
const {
  receiptScanErrorPresentation,
  receiptScanUsagePresentation,
} = require('../../services/receiptScanPresentation');
const {
  RECEIPT_IMAGE_MAX_BASE64_LENGTH,
  emergencyReceiptImagePlan,
  fallbackReceiptImagePlan,
  inferReceiptMediaType,
  isSupportedReceiptMediaType,
  normalizeReceiptBase64,
  primaryReceiptImagePlan,
} = require('../../services/receiptImagePreparation');
const { createReceiptScanRequestId, submitReceiptScan } = require('../../services/receiptScanClient');
import { useEffect, useRef, useState } from 'react';
import { toLocalDateString } from '../../services/date';
import { pushConfirmDraft } from '../../services/confirmNavigation';
import { ActionRow, SecondaryButton } from '../../components/ui/Buttons';
import { LoadingState } from '../../components/ui/States';
import { colors, radius, spacing, typography } from '../../theme/tokens';

async function prepareReceiptImage(asset = {}) {
  if (!asset.uri && !asset.base64) {
    const error = new Error('The selected receipt image is unavailable. Choose it again.');
    error.reason_code = 'image_unavailable';
    throw error;
  }

  if (ImageManipulator?.manipulateAsync && asset.uri) {
    const plans = [
      primaryReceiptImagePlan(asset),
      fallbackReceiptImagePlan(asset),
      emergencyReceiptImagePlan(asset),
    ];
    for (const plan of plans) {
      try {
        const result = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: plan.width } }],
          { compress: plan.compress, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );
        const imageBase64 = normalizeReceiptBase64(result.base64);
        if (imageBase64 && imageBase64.length <= RECEIPT_IMAGE_MAX_BASE64_LENGTH) {
          return { imageBase64, mediaType: 'image/jpeg' };
        }
      } catch {
        // Try the next preparation strategy before falling back to the original bytes.
      }
    }
  }

  let imageBase64 = normalizeReceiptBase64(asset.base64);
  if (!imageBase64 && asset.uri) {
    try {
      imageBase64 = normalizeReceiptBase64(await new File(asset.uri).base64());
    } catch {
      const error = new Error('Could not open the selected receipt image. Choose it again or take a new photo.');
      error.reason_code = 'image_unavailable';
      throw error;
    }
  }

  const mediaType = inferReceiptMediaType(asset);
  if (!isSupportedReceiptMediaType(mediaType)) {
    const error = new Error('This image format could not be converted. Choose a JPEG or PNG image.');
    error.reason_code = 'unsupported_image_type';
    throw error;
  }
  if (!imageBase64 || imageBase64.length > RECEIPT_IMAGE_MAX_BASE64_LENGTH) {
    const error = new Error('Receipt image is too large. Crop closer to the receipt and try again.');
    error.reason_code = 'image_too_large';
    throw error;
  }
  return { imageBase64, mediaType };
}

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

  async function parseReceiptImage(asset, source = 'camera', scanRequestId = createReceiptScanRequestId()) {
    const { imageBase64, mediaType } = await prepareReceiptImage(asset);
    const parsed = await submitReceiptScan(api, '/expenses/scan-jobs', {
      image_base64: imageBase64,
      media_type: mediaType,
      today: toLocalDateString(),
      scan_request_id: scanRequestId,
    });
    pushConfirmDraft(router, { ...parsed, source, image_uri: asset.uri });
    const usageNotice = receiptScanUsagePresentation(parsed.scan_usage);
    if (usageNotice) Alert.alert(usageNotice.title, usageNotice.message);
  }

  function presentReceiptFailure(error, retry = null) {
    const presentation = receiptScanErrorPresentation(error);
    const reference = error?.requestId ? `\n\nReference: ${error.requestId}` : '';
    const title = presentation?.title || 'Scan failed';
    const message = `${presentation?.message || error?.message || 'Could not read this receipt.'}${reference}`;
    const actions = [];
    if (presentation?.canRetry !== false && retry) actions.push({ text: 'Try again', onPress: retry });
    if (presentation?.canEnterManually !== false) actions.push({ text: 'Enter manually', onPress: startManualEntry });
    actions.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(title, message, actions);
  }

  async function processReceiptAsset(asset, source = 'camera', scanRequestId = createReceiptScanRequestId()) {
    setScanLoading(true);
    try {
      await parseReceiptImage(asset, source, scanRequestId);
    } catch (error) {
      presentReceiptFailure(error, () => processReceiptAsset(asset, source, scanRequestId));
    } finally {
      setScanLoading(false);
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
        ? await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.9, mediaTypes: 'images' })
        : await ImagePicker.launchCameraAsync({ base64: true, quality: 0.9 });

      if (pickerResult.canceled) return;

      const asset = pickerResult.assets[0];
      await processReceiptAsset(asset, 'camera');
    } catch (err) {
      if (`${err?.message || ''}`.includes('Camera not available on simulator')) {
        Alert.alert('Simulator', 'Camera is not available in the simulator. Use "from camera roll" or test on a real device.');
      } else {
        presentReceiptFailure(err, () => handleScan(fromGallery));
      }
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
        const parsed = await submitReceiptScan(api, '/expenses/scan-document-jobs', {
          document_base64: documentBase64,
          file_name: asset.name || 'receipt.pdf',
          today: toLocalDateString(),
          scan_request_id: createReceiptScanRequestId(),
        });
        pushConfirmDraft(router, { ...parsed, source: 'share' });
        const usageNotice = receiptScanUsagePresentation(parsed.scan_usage);
        if (usageNotice) Alert.alert(usageNotice.title, usageNotice.message);
      } else {
        await processReceiptAsset(asset, 'share');
      }
    } catch (err) {
      presentReceiptFailure(err, handleDocumentImport);
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
