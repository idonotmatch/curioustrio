import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

export async function ensurePushRegistration() {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }

  if (finalStatus !== 'granted') {
    return { granted: false, registered: false };
  }

  const tokenData = await Notifications.getExpoPushTokenAsync();
  const token = `${tokenData?.data || ''}`.trim();
  if (!token) {
    return { granted: true, registered: false };
  }

  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  await api.post('/push/register', { token, platform });
  return { granted: true, registered: true };
}
