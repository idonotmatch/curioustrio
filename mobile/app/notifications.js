import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Switch,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { DismissKeyboardScrollView } from '../components/DismissKeyboardScrollView';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { api } from '../services/api';
import { ensurePushRegistration } from '../services/pushRegistration';
import { saveCurrentUserCache } from '../services/currentUserCache';

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useCurrentUser();
  const [pushGmailReviewEnabled, setPushGmailReviewEnabled] = useState(true);
  const [pushInsightsEnabled, setPushInsightsEnabled] = useState(true);
  const [pushRecurringEnabled, setPushRecurringEnabled] = useState(true);
  const [pushSavingKey, setPushSavingKey] = useState('');
  const [pushMessage, setPushMessage] = useState('');
  const [devicePushEnabled, setDevicePushEnabled] = useState(null);

  useEffect(() => {
    if (!user) return;
    setPushGmailReviewEnabled(user.push_gmail_review_enabled !== false);
    setPushInsightsEnabled(user.push_insights_enabled !== false);
    setPushRecurringEnabled(user.push_recurring_enabled !== false);
  }, [
    user?.push_gmail_review_enabled,
    user?.push_insights_enabled,
    user?.push_recurring_enabled,
  ]);

  useEffect(() => {
    let active = true;
    Notifications.getPermissionsAsync()
      .then(({ status }) => {
        if (active) setDevicePushEnabled(status === 'granted');
      })
      .catch(() => {
        if (active) setDevicePushEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleEnableDeviceNotifications() {
    setPushSavingKey('device_notifications');
    setPushMessage('');
    try {
      const permission = await ensurePushRegistration();
      if (!permission.granted) {
        setDevicePushEnabled(false);
        setPushMessage('Notifications stay off until you allow them on your device.');
        return;
      }
      setDevicePushEnabled(true);
      setPushMessage('Notifications are enabled on this device.');
    } catch (e) {
      setDevicePushEnabled(false);
      setPushMessage(e.message || 'Could not enable notifications on this device');
    } finally {
      setPushSavingKey('');
    }
  }

  async function savePushSetting(field, value, setter) {
    const previous = field === 'push_gmail_review_enabled'
      ? pushGmailReviewEnabled
      : field === 'push_insights_enabled'
        ? pushInsightsEnabled
        : pushRecurringEnabled;
    setter(value);
    setPushSavingKey(field);
    setPushMessage('');
    try {
      if (value) {
        const permission = await ensurePushRegistration();
        if (!permission.granted) {
          setter(previous);
          setPushMessage('Notifications stay off until you allow them on your device.');
          return;
        }
      }
      const updatedUser = await api.patch('/users/settings', { [field]: value });
      await saveCurrentUserCache(updatedUser);
      setPushMessage(value ? 'Saved.' : '');
    } catch (e) {
      setter(previous);
      setPushMessage(e.message || 'Could not update notification preferences');
    } finally {
      setPushSavingKey('');
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Notifications' }} />
      <DismissKeyboardScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>NOTIFICATIONS</Text>
          <Text style={styles.sectionIntro}>Choose which nudges are worth interrupting you for. Adlo only asks for device notification permission when you turn one of these on.</Text>

          {devicePushEnabled === false ? (
            <View style={styles.permissionCard}>
              <View style={styles.permissionCopy}>
                <Text style={styles.permissionTitle}>Device notifications are still off.</Text>
                <Text style={styles.permissionBody}>Turn them on here when you want Gmail review, insight, or recurring nudges to reach this phone.</Text>
              </View>
              <TouchableOpacity
                style={[styles.permissionButton, pushSavingKey === 'device_notifications' && styles.buttonDisabled]}
                onPress={handleEnableDeviceNotifications}
                disabled={pushSavingKey === 'device_notifications'}
                activeOpacity={0.88}
              >
                <Text style={styles.permissionButtonText}>
                  {pushSavingKey === 'device_notifications' ? 'Enabling...' : 'Enable on device'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.toggleRow}>
            <View style={styles.toggleCopy}>
              <Text style={styles.toggleTitle}>Gmail review queue</Text>
              <Text style={styles.toggleSubtitle}>When new imports are waiting for your confirmation</Text>
            </View>
            <Switch
              value={pushGmailReviewEnabled}
              onValueChange={(value) => savePushSetting('push_gmail_review_enabled', value, setPushGmailReviewEnabled)}
              disabled={pushSavingKey === 'push_gmail_review_enabled'}
              trackColor={{ false: '#2a2a2a', true: '#3a7a4a' }}
              thumbColor="#f5f5f5"
            />
          </View>

          <View style={styles.toggleRow}>
            <View style={styles.toggleCopy}>
              <Text style={styles.toggleTitle}>Insights</Text>
              <Text style={styles.toggleSubtitle}>For price drops, recurring shifts, and timely nudges</Text>
            </View>
            <Switch
              value={pushInsightsEnabled}
              onValueChange={(value) => savePushSetting('push_insights_enabled', value, setPushInsightsEnabled)}
              disabled={pushSavingKey === 'push_insights_enabled'}
              trackColor={{ false: '#2a2a2a', true: '#3a7a4a' }}
              thumbColor="#f5f5f5"
            />
          </View>

          <View style={styles.toggleRow}>
            <View style={styles.toggleCopy}>
              <Text style={styles.toggleTitle}>Recurring reminders</Text>
              <Text style={styles.toggleSubtitle}>When a usual expense looks due again soon</Text>
            </View>
            <Switch
              value={pushRecurringEnabled}
              onValueChange={(value) => savePushSetting('push_recurring_enabled', value, setPushRecurringEnabled)}
              disabled={pushSavingKey === 'push_recurring_enabled'}
              trackColor={{ false: '#2a2a2a', true: '#3a7a4a' }}
              thumbColor="#f5f5f5"
            />
          </View>

          {pushMessage ? <Text style={styles.msgError}>{pushMessage}</Text> : null}
        </View>
      </DismissKeyboardScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 40 },
  section: { marginBottom: 32, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', paddingBottom: 24 },
  sectionTitle: { fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  sectionIntro: { color: '#666', fontSize: 13, marginBottom: 12 },
  permissionCard: {
    marginBottom: 14,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    backgroundColor: '#111',
    gap: 12,
  },
  permissionCopy: { gap: 4 },
  permissionTitle: { color: '#f5f5f5', fontSize: 14, fontWeight: '700' },
  permissionBody: { color: '#8c8c8c', fontSize: 13, lineHeight: 18 },
  permissionButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  permissionButtonText: { color: '#0a0a0a', fontSize: 13, fontWeight: '700' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  toggleCopy: { flex: 1, paddingRight: 10 },
  toggleTitle: { color: '#f5f5f5', fontSize: 15 },
  toggleSubtitle: { color: '#666', fontSize: 13, marginTop: 2 },
  msgError: { color: '#ef4444', fontSize: 13, marginTop: 10 },
});
