import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ActivityIndicator, Platform, View } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { supabase } from '../lib/supabase';
import { MonthProvider } from '../contexts/MonthContext';

function AppNavigator() {
  const router = useRouter();
  const [bootstrapped, setBootstrapped] = useState(false);
  const resolvingSessionRef = useRef(false);

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
    async function routeAuthenticatedSession(session) {
      if (resolvingSessionRef.current) return;
      resolvingSessionRef.current = true;
      try {
        // Pass the token directly from the session object already in memory.
        // Do NOT rely on supabase.auth.getSession() here: immediately after
        // sign-in the session may not yet be flushed to AsyncStorage, causing
        // getSession() to return null, the request to go out unauthenticated,
        // the server to respond 401, and navigation to silently never fire.
        const isAnon = session.user.is_anonymous === true;
        const payload = {
          name: isAnon ? 'Anonymous' : (session.user.user_metadata?.full_name || session.user.email || 'User'),
          email: isAnon ? null : (session.user.email || null),
        };

        let me = null;
        try {
          me = await api.post('/users/sync', payload, { token: session.access_token });
        } catch (syncErr) {
          console.error('[routeAuthenticatedSession] sync failed, falling back to /users/me:', syncErr?.message ?? syncErr);
          try {
            me = await api.get('/users/me', { token: session.access_token });
          } catch (meErr) {
            console.error('[routeAuthenticatedSession] /users/me fallback failed:', meErr?.message ?? meErr);
          }
        }

        if (!isAnon && me && !me.household_id) {
          router.replace('/onboarding');
        } else {
          router.replace('/(tabs)/summary');
        }
      } finally {
        resolvingSessionRef.current = false;
        setBootstrapped(true);
      }
    }

    // Subscribe to auth state changes.
    // INITIAL_SESSION fires on app start with the restored session (or null if not logged in).
    // SIGNED_IN fires after a fresh login. Both need the same handling.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
        routeAuthenticatedSession(session);
      } else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !session)) {
        router.replace('/login');
        setBootstrapped(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!bootstrapped) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#888" />
      </View>
    );
  }

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
      <Stack.Screen name="confirm" options={{ title: 'Confirm Expense', headerBackTitle: 'Summary' }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="budget-period" options={{ title: 'Budget Period', headerBackTitle: 'Settings' }} />
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
      <MonthProvider>
        <AppNavigator />
      </MonthProvider>
    </GestureHandlerRootView>
  );
}
