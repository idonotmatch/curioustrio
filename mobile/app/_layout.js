import { Stack, useRouter } from 'expo-router';
import { Auth0Provider, useAuth0 } from 'react-native-auth0';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useEffect } from 'react';
import { api } from '../services/api';

function AppNavigator() {
  const router = useRouter();
  const { user } = useAuth0();

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

  useEffect(() => {
    if (!user) return;

    async function checkHousehold() {
      try {
        const me = await api.post('/users/sync', {
          name: user.name || user.nickname || user.email,
          email: user.email,
        });
        if (!me?.household_id) {
          router.replace('/onboarding');
        }
      } catch (e) {
        // Non-fatal — if sync fails, don't redirect
      }
    }
    checkHousehold();
  }, [user?.sub]);

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="confirm" options={{ presentation: 'modal', title: 'Confirm Expense' }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="categories" options={{ title: 'Category Details' }} />
      <Stack.Screen name="accounts" options={{ title: 'Account' }} />
      <Stack.Screen name="expense/[id]" options={{ title: '' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <Auth0Provider
      domain={process.env.EXPO_PUBLIC_AUTH0_DOMAIN}
      clientId={process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID}
    >
      <AppNavigator />
    </Auth0Provider>
  );
}
