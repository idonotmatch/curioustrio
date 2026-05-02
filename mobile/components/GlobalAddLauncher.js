import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NLInput } from './NLInput';
import { api } from '../services/api';
import { toLocalDateString } from '../services/date';
import { pushConfirmDraft } from '../services/confirmNavigation';

export function GlobalAddLauncher({ router, bottomOffset = 24 }) {
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

  function openCheck() {
    close();
    router.push('/scenario-check');
  }

  return (
    <>
      <TouchableOpacity
        style={[styles.fab, { bottom: bottomOffset }]}
        onPress={() => setOpen(true)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Add expense options"
      >
        <Ionicons name="add" size={26} color="#000" />
      </TouchableOpacity>

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
                  <ActivityIndicator color="#f5f5f5" />
                  <View style={styles.processingCopy}>
                    <Text style={styles.processingTitle}>Parsing your expense...</Text>
                    <Text style={styles.processingBody}>We&apos;ll open the confirmation screen as soon as it&apos;s ready.</Text>
                  </View>
                </View>
              ) : null}

              {!keyboardVisible ? (
                <>
                  <TouchableOpacity style={[styles.actionRow, loading && styles.actionRowDisabled]} onPress={openAdd} activeOpacity={0.82} disabled={loading}>
                    <View style={styles.actionIcon}>
                      <Ionicons name="create-outline" size={18} color="#f5f5f5" />
                    </View>
                    <View style={styles.actionCopy}>
                      <Text style={styles.actionTitle}>Manual add</Text>
                      <Text style={styles.actionBody}>Start from scratch with the structured form.</Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity style={[styles.actionRow, loading && styles.actionRowDisabled]} onPress={openScan} activeOpacity={0.82} disabled={loading}>
                    <View style={styles.actionIcon}>
                      <Ionicons name="camera-outline" size={18} color="#f5f5f5" />
                    </View>
                    <View style={styles.actionCopy}>
                      <Text style={styles.actionTitle}>Scan receipt</Text>
                      <Text style={styles.actionBody}>Use the camera or photo library to pull details in.</Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity style={[styles.actionRow, loading && styles.actionRowDisabled]} onPress={openCheck} activeOpacity={0.82} disabled={loading}>
                    <View style={styles.actionIcon}>
                      <Ionicons name="sparkles-outline" size={18} color="#f5f5f5" />
                    </View>
                    <View style={styles.actionCopy}>
                      <Text style={styles.actionTitle}>Check a purchase</Text>
                      <Text style={styles.actionBody}>Pressure-test whether something fits right now.</Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity style={[styles.cancelButton, loading && styles.actionRowDisabled]} onPress={close} activeOpacity={0.8} disabled={loading}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={styles.keyboardHint}>Dismiss the keyboard to scan, start from scratch, or check a purchase.</Text>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 34,
    maxHeight: '88%',
  },
  sheetRaised: {
    paddingBottom: Platform.OS === 'ios' ? 18 : 22,
  },
  sheetContent: {
    gap: 12,
  },
  eyebrow: { fontSize: 11, color: '#8a8a8a', textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 22, color: '#f5f5f5', fontWeight: '700', marginBottom: 2 },
  subtitle: { fontSize: 13, color: '#9a9a9a', lineHeight: 18, marginBottom: 2 },
  keyboardHint: { fontSize: 12, color: '#7e7e7e', lineHeight: 18, marginTop: 2 },
  processingBanner: {
    marginTop: 2,
    backgroundColor: '#171717',
    borderWidth: 1,
    borderColor: '#2b2b2b',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  processingCopy: { flex: 1, gap: 2 },
  processingTitle: { color: '#f5f5f5', fontSize: 14, fontWeight: '700' },
  processingBody: { color: '#a1a1a1', fontSize: 12, lineHeight: 17 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#232323',
    borderRadius: 12,
    padding: 14,
  },
  actionRowDisabled: { opacity: 0.45 },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#202020',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  actionCopy: { flex: 1, gap: 3 },
  actionTitle: { fontSize: 15, color: '#f5f5f5', fontWeight: '600' },
  actionBody: { fontSize: 13, color: '#9a9a9a', lineHeight: 18 },
  cancelButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  cancelText: { fontSize: 15, color: '#b5b5b5', fontWeight: '600' },
});
