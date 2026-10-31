import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api';

function notificationTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function expoProjectId() {
  return Constants.easConfig?.projectId
    || Constants.expoConfig?.extra?.eas?.projectId
    || null;
}

async function currentExpoPushToken() {
  const projectId = expoProjectId();
  const tokenData = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );
  return `${tokenData?.data || ''}`.trim();
}

export async function ensurePushRegistration({ requestPermission = true, token: authToken } = {}) {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted' && requestPermission) {
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }

  if (finalStatus !== 'granted') {
    return { granted: false, registered: false };
  }

  const token = await currentExpoPushToken();
  if (!token) {
    return { granted: true, registered: false };
  }

  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  await api.post('/push/register', {
    token,
    platform,
    timezone: notificationTimezone(),
  }, { token: authToken });
  return { granted: true, registered: true };
}

export async function refreshPushRegistrationIfGranted({ token } = {}) {
  return ensurePushRegistration({ requestPermission: false, token });
}

export async function unregisterCurrentPushToken({ token: authToken } = {}) {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return { unregistered: false };
  const token = await currentExpoPushToken();
  if (!token) return { unregistered: false };
  await api.post('/push/unregister', { token }, { token: authToken });
  return { unregistered: true };
}
