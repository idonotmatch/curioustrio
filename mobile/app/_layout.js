import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Platform } from 'react-native';
import { useEffect } from 'react';
import { api } from '../services/api';
import { supabase } from '../lib/supabase';

function AppNavigator() {
  const router = useRouter();

  // Push notification + location permission registration (independent of auth)
  useEffect(() => {
    async function requestPermissions() {
      try {
        const { status: existing } = await Notifications.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus === 'granted') {
          const tokenData = await Notifications.getExpoPushTokenAsync();
          const platform = Platform.OS === 'ios' ? 'ios' : 'android';
          await api.post('/push/register', { token: tokenData.data, platform });
        }
      } catch {
        // Non-fatal
      }
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          await Location.requestForegroundPermissionsAsync();
        }
      } catch {
        // Non-fatal
      }
    }
    requestPermissions();
  }, []);

  // Auth state listener
  useEffect(() => {
    async function checkHousehold(session) {
      try {
        // Pass the token directly from the session object already in memory.
        // Do NOT rely on supabase.auth.getSession() here: immediately after
        // sign-in the session may not yet be flushed to AsyncStorage, causing
        // getSession() to return null, the request to go out unauthenticated,
        // the server to respond 401, and navigation to silently never fire.
        const isAnon = session.user.is_anonymous === true;
        const me = await api.post('/users/sync', {
          name: isAnon ? 'Anonymous' : (session.user.user_metadata?.full_name || session.user.email || 'User'),
          email: isAnon ? null : (session.user.email || null),
        }, { token: session.access_token });
        if (!me?.household_id) {
          router.replace('/onboarding');
        } else {
          router.replace('/(tabs)/summary');
        }
      } catch (err) {
        console.error('[checkHousehold] sync failed:', err?.message ?? err);
        // Don't leave the user on a blank screen — send to onboarding as safe fallback.
        // They can retry from there; if the server is misconfigured, this is better
        // than silently blocking navigation after a successful sign-in.
        router.replace('/onboarding');
      }
    }

    // Subscribe to auth state changes.
    // INITIAL_SESSION fires on app start with the restored session (or null if not logged in).
    // SIGNED_IN fires after a fresh login. Both need the same handling.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
        checkHousehold(session);
      } else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !session)) {
        router.replace('/login');
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
