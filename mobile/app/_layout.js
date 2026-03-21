import { Stack } from 'expo-router';
import Auth0Provider from 'react-native-auth0';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useEffect } from 'react';
import { api } from '../services/api';

export default function RootLayout() {
  useEffect(() => {
    async function registerForPushNotifications() {
      try {
        const { status: existing } = await Notifications.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') return;

        const tokenData = await Notifications.getExpoPushTokenAsync();
        const platform = Platform.OS === 'ios' ? 'ios' : 'android';
        await api.post('/push/register', { token: tokenData.data, platform });
      } catch (e) {
        // Non-fatal
      }
    }
    registerForPushNotifications();
  }, []);

  return (
    <Auth0Provider
      domain={process.env.EXPO_PUBLIC_AUTH0_DOMAIN}
      clientId={process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID}
    >
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="confirm" options={{ presentation: 'modal', title: 'Confirm Expense' }} />
      </Stack>
    </Auth0Provider>
  );
}
