import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Platform } from 'react-native';
import { useEffect } from 'react';
import { api } from '../services/api';
import { supabase } from '../lib/supabase';

function AppNavigator() {
  const router = useRouter();

  // Push notification registration (independent of auth)
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
      } catch {
        // Non-fatal
      }
    }
    registerForPushNotifications();
  }, []);

  // Auth state listener
  useEffect(() => {
    async function checkHousehold(session) {
      try {
        const me = await api.post('/users/sync', {
          name: session.user.user_metadata?.full_name || session.user.email || 'User',
          email: session.user.email || null,
        });
        if (!me?.household_id) {
          router.replace('/onboarding');
        } else {
          router.replace('/(tabs)/summary');
        }
      } catch {
        // Non-fatal sync failure — stay on current screen
      }
    }

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        checkHousehold(session);
      } else if (event === 'SIGNED_OUT' || !session) {
        router.replace('/login');
      }
    });

    // Check session on mount (handles app reopen with persisted session)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/login');
      } else {
        checkHousehold(session);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: '#0a0a0a' },
      headerTintColor: '#f5f5f5',
      headerTitleStyle: { fontWeight: '500', fontSize: 15 },
      headerShadowVisible: false,
      contentStyle: { backgroundColor: '#0a0a0a' },
    }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="confirm" options={{ presentation: 'modal', title: 'Confirm Expense', headerBackTitle: 'Summary' }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="categories" options={{ title: 'Category Details', headerBackTitle: 'Settings' }} />
      <Stack.Screen name="accounts" options={{ title: 'Accounts', headerBackTitle: 'Settings' }} />
      <Stack.Screen name="expense/[id]" options={{ title: '', headerBackTitle: 'Feed' }} />
      <Stack.Screen name="join" options={{ title: 'Join Household', headerBackTitle: 'Back' }} />
    </Stack>
  );
}

export default function RootLayout() {
  // Auth0Provider wrapper removed — Supabase manages session internally via lib/supabase.js
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppNavigator />
    </GestureHandlerRootView>
  );
}
