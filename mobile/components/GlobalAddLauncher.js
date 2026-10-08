import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NLInput } from './NLInput';
import { api } from '../services/api';
import { toLocalDateString } from '../services/date';
import { pushConfirmDraft } from '../services/confirmNavigation';
import { ActionRow } from './ui/Buttons';
import { colors, radius, spacing, typography } from '../theme/tokens';

export const GlobalAddLauncher = forwardRef(function GlobalAddLauncher({ router, openSignal = 0 }, ref) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (!openSignal) return;
    setOpen(true);
  }, [openSignal]);

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close,
  }));

  function close() {
    setOpen(false);
    setKeyboardVisible(false);
  }

  function openAdd() {
    close();
    router.push('/manual-add');
  }

  async function handleQuickParse(input) {
    try {
      setLoading(true);
      const today = toLocalDateString();
      const parsed = await api.post('/expenses/parse', { input, today });
      close();
      pushConfirmDraft(router, { ...parsed, source: 'manual' });
      return true;
    } catch (err) {
      if (`${err?.message || ''}`.includes('Could not parse')) {
        Alert.alert(
          "Couldn't parse that",
          "Try: '84.50 trader joes' or 'lunch chipotle 14'",
          [
            { text: 'Keep editing', style: 'cancel' },
            { text: 'Manual add', onPress: openAdd },
          ]
        );
      } else {
        Alert.alert('Error', err?.message || 'Could not parse that expense right now.');
      }
      return false;
    } finally {
      setLoading(false);
    }
  }

  function openScan() {
    close();
    router.push({ pathname: '/(tabs)/add', params: { auto_scan: '1' } });
  }

  function openPlan() {
    close();
    router.push('/plan/new');
  }

  return (
    <>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => { if (!loading) close(); }}>
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
        >
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => { if (!loading) close(); }} />
          <View style={[styles.sheet, keyboardVisible && styles.sheetRaised]}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              bounces={false}
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.eyebrow}>Quick action</Text>
              <Text style={styles.title}>Add it the fast way</Text>
              {!keyboardVisible ? (
                <Text style={styles.subtitle}>Type it naturally, or open a cleaner form if you want to start from scratch.</Text>
              ) : null}

              <NLInput onSubmit={handleQuickParse} loading={loading} />

              {loading ? (
                <View style={styles.processingBanner}>
                  <ActivityIndicator color={colors.text} />
                  <View style={styles.processingCopy}>
                    <Text style={styles.processingTitle}>Parsing your expense...</Text>
                    <Text style={styles.processingBody}>We&apos;ll open the confirmation screen as soon as it&apos;s ready.</Text>
                  </View>
                </View>
              ) : null}

              {!keyboardVisible ? (
                <>
                  <ActionRow
                    icon="create-outline"
                    title="Manual add"
                    body="Start from scratch with the structured form."
                    onPress={openAdd}
                    disabled={loading}
                  />

                  <ActionRow
                    icon="camera-outline"
                    title="Scan receipt"
                    body="Use the camera or photo library to pull details in."
                    onPress={openScan}
                    disabled={loading}
                  />

                  <ActionRow
                    icon="compass-outline"
                    title="Consider a purchase"
                    body="Check whether it fits, compare funding paths, and revisit it later."
                    onPress={openPlan}
                    disabled={loading}
                  />

                  <TouchableOpacity style={[styles.cancelButton, loading && styles.actionRowDisabled]} onPress={close} activeOpacity={0.8} disabled={loading}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={styles.keyboardHint}>Dismiss the keyboard to scan, start from scratch, or consider a purchase.</Text>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.backgroundOverlay,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: 18,
    paddingBottom: 34,
    maxHeight: '88%',
  },
  sheetRaised: {
    paddingBottom: Platform.OS === 'ios' ? 18 : 22,
  },
  sheetContent: {
    gap: spacing.md,
  },
  eyebrow: { color: colors.textSubtle, ...typography.eyebrow },
  title: { color: colors.text, marginBottom: 2, ...typography.title },
  subtitle: { color: colors.textMuted, marginBottom: 2, ...typography.bodySmall },
  keyboardHint: { color: colors.textSubtle, fontSize: 12, lineHeight: 18, marginTop: 2 },
  processingBanner: {
    marginTop: 2,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  processingCopy: { flex: 1, gap: 2 },
  processingTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  processingBody: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  actionRowDisabled: { opacity: 0.45 },
  cancelButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  cancelText: { fontSize: 15, color: colors.textMuted, fontWeight: '600' },
});
