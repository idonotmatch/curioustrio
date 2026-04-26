import { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function GlobalAddLauncher({ router, bottomOffset = 24 }) {
  const [open, setOpen] = useState(false);

  function close() {
    setOpen(false);
  }

  function openAdd() {
    close();
    router.push('/manual-add');
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

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={close}>
          <View style={styles.sheet}>
            <Text style={styles.eyebrow}>Quick action</Text>
            <Text style={styles.title}>What do you want to do?</Text>

            <TouchableOpacity style={styles.actionRow} onPress={openAdd} activeOpacity={0.82}>
              <View style={styles.actionIcon}>
                <Ionicons name="create-outline" size={18} color="#f5f5f5" />
              </View>
              <View style={styles.actionCopy}>
                <Text style={styles.actionTitle}>Add expense</Text>
                <Text style={styles.actionBody}>Log something with text or start from scratch.</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionRow} onPress={openScan} activeOpacity={0.82}>
              <View style={styles.actionIcon}>
                <Ionicons name="camera-outline" size={18} color="#f5f5f5" />
              </View>
              <View style={styles.actionCopy}>
                <Text style={styles.actionTitle}>Scan receipt</Text>
                <Text style={styles.actionBody}>Use the camera or photo library to pull details in.</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionRow} onPress={openCheck} activeOpacity={0.82}>
              <View style={styles.actionIcon}>
                <Ionicons name="sparkles-outline" size={18} color="#f5f5f5" />
              </View>
              <View style={styles.actionCopy}>
                <Text style={styles.actionTitle}>Check a purchase</Text>
                <Text style={styles.actionBody}>Pressure-test whether something fits right now.</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton} onPress={close} activeOpacity={0.8}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
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
  sheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 34,
    gap: 12,
  },
  eyebrow: { fontSize: 11, color: '#8a8a8a', textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 22, color: '#f5f5f5', fontWeight: '700', marginBottom: 2 },
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
