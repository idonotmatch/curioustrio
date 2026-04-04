import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ActivityIndicator, AppState, Platform, View } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { supabase } from '../lib/supabase';
import { MonthProvider } from '../contexts/MonthContext';

function AppNavigator() {
  const router = useRouter();
  const [bootstrapped, setBootstrapped] = useState(false);
  const resolvingSessionRef = useRef(false);
  const gmailSyncInFlightRef = useRef(false);
  const lastGmailAutoSyncAttemptRef = useRef(0);

  async function cacheCurrentUser(user) {
    if (!user) return;
    try {
      await AsyncStorage.setItem('cache:current-user', JSON.stringify({ data: user, ts: Date.now() }));
    } catch {
      // Non-fatal
    }
  }

  async function loadCachedCurrentUser() {
    try {
      const raw = await AsyncStorage.getItem('cache:current-user');
      if (!raw) return null;
      return JSON.parse(raw)?.data || null;
    } catch {
      return null;
    }
  }

  async function maybeAutoSyncGmail(token) {
    if (!token || gmailSyncInFlightRef.current) return;
    const now = Date.now();
    if (now - lastGmailAutoSyncAttemptRef.current < 5 * 60 * 1000) return;
    lastGmailAutoSyncAttemptRef.current = now;
    gmailSyncInFlightRef.current = true;
    try {
      const status = await api.get('/gmail/status', { token });
      if (!status?.connected) return;
      const lastSyncedAt = status.last_synced_at ? new Date(status.last_synced_at).getTime() : 0;
      const stale = !lastSyncedAt || Number.isNaN(lastSyncedAt) || (now - lastSyncedAt) >= 30 * 60 * 1000;
      if (!stale) return;
      await api.post('/gmail/import', {}, { token });
    } catch {
      // Non-fatal
    } finally {
      gmailSyncInFlightRef.current = false;
    }
  }

  // Push notification + location permission registration (independent of auth)
  useEffect(() => {
    if (!bootstrapped) return;
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
  }, [bootstrapped]);

  // Auth state listener
  useEffect(() => {
    async function syncSessionInBackground(session) {
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

        if (me) await cacheCurrentUser(me);

        if (!isAnon && me && !me.household_id) {
          router.replace('/onboarding');
        }
      } finally {
        resolvingSessionRef.current = false;
      }
    }

    async function routeAuthenticatedSession(session) {
      const isAnon = session.user.is_anonymous === true;
      const cachedUser = await loadCachedCurrentUser();
      const safeCachedUser = cachedUser?.provider_uid === session.user.id ? cachedUser : null;

      if (!bootstrapped) {
        if (!isAnon && safeCachedUser && !safeCachedUser.household_id) {
          router.replace('/onboarding');
        } else {
          router.replace('/(tabs)/summary');
        }
        setBootstrapped(true);
      }

      syncSessionInBackground(session);
      maybeAutoSyncGmail(session.access_token);
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
  }, [bootstrapped]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          maybeAutoSyncGmail(session.access_token);
        }
      } catch {
        // Non-fatal
      }
    });
    return () => sub.remove();
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
