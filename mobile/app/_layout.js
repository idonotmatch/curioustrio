import { Stack, useRootNavigationState, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppState, Image, Platform, StyleSheet, View } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { supabase } from '../lib/supabase';
import { MonthProvider } from '../contexts/MonthContext';
import { stashNavigationPayload } from '../services/navigationPayloadStore';
import { saveInsightDetailSnapshot } from '../services/insightLocalStore';
import { buildRecurringItemPreload } from '../services/summaryScreenHelpers';
import { loadCurrentUserCache, saveCurrentUserCache } from '../services/currentUserCache';
const { defaultAuthedRoute, shouldRouteToOnboarding } = require('../services/authBootRouting');

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function firstValue(value, fallback = null) {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

function normalizeNotificationData(data = {}) {
  if (!data || typeof data !== 'object') return {};
  return data;
}

function parseNotificationMetadata(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object') return value;
  return {};
}

const RECURRING_PUSH_INSIGHT_TYPES = new Set([
  'recurring_repurchase_due',
  'recurring_price_spike',
  'buy_soon_better_price',
  'recurring_restock_window',
  'recurring_cost_pressure',
]);

function AppNavigator() {
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const [bootstrapped, setBootstrapped] = useState(false);
  const resolvingSessionRef = useRef(false);
  const gmailSyncInFlightRef = useRef(false);
  const lastGmailAutoSyncAttemptRef = useRef(0);
  const lastHandledNotificationRef = useRef(null);
  const pendingNotificationResponseRef = useRef(null);
  const hasOnboardingRoute = rootNavigationState?.routeNames?.includes('onboarding') === true;

  async function navigateFromNotificationResponse(response) {
    const identifier = response?.notification?.request?.identifier;
    if (identifier && lastHandledNotificationRef.current === identifier) return;
    if (identifier) lastHandledNotificationRef.current = identifier;

    const content = response?.notification?.request?.content || {};
    const data = normalizeNotificationData(content.data);
    const route = firstValue(data.route);
    const type = firstValue(data.type, '');

    if (type === 'insight') {
      const metadata = parseNotificationMetadata(firstValue(data.metadata));
      const insightType = firstValue(data.insight_type, '');
      const insightId = firstValue(data.insight_id, '');
      const groupKey = firstValue(data.group_key, metadata.group_key || '');

      try {
        await api.post('/insights/events', {
          events: [{
            insight_id: insightId,
            event_type: 'tapped',
            metadata: {
              source: 'push',
              insight_type: insightType,
              continuity_key: metadata.continuity_key || null,
            },
          }],
        });
      } catch {
        // Non-fatal
      }

      if (RECURRING_PUSH_INSIGHT_TYPES.has(insightType) && groupKey) {
        const preloadHistory = buildRecurringItemPreload({
          title: firstValue(data.title, content.title || 'Recurring item'),
          metadata,
        });
        const payloadKey = stashNavigationPayload({ metadata, preloadHistory }, 'push-recurring-item');
        router.push({
          pathname: '/recurring-item',
          params: {
            group_key: groupKey,
            scope: firstValue(data.scope, metadata.scope || 'personal'),
            title: metadata.item_name || firstValue(data.title, content.title || 'Recurring item'),
            insight_id: insightId,
            insight_type: insightType,
            body: firstValue(data.body, content.body || ''),
            payload_key: payloadKey,
          },
        });
        return;
      }

      saveInsightDetailSnapshot({
        id: insightId,
        type: insightType,
        title: firstValue(data.title, content.title || 'Insight detail'),
        body: firstValue(data.body, content.body || ''),
        severity: firstValue(data.severity, 'low'),
        entity_type: firstValue(data.entity_type, ''),
        entity_id: firstValue(data.entity_id, ''),
        metadata,
      }).catch(() => {});
      const payloadKey = stashNavigationPayload({ metadata, preloadEvidence: [] }, 'push-insight');
      router.push({
        pathname: '/insight-detail',
        params: {
          insight_id: insightId,
          insight_type: insightType,
          title: firstValue(data.title, content.title || 'Insight detail'),
          body: firstValue(data.body, content.body || ''),
          severity: firstValue(data.severity, 'low'),
          entity_type: firstValue(data.entity_type, ''),
          entity_id: firstValue(data.entity_id, ''),
          payload_key: payloadKey,
        },
      });
      return;
    }

    if (route) {
      router.push(route);
      return;
    }

    if (type === 'recurring') {
      router.push('/watching-plans');
      return;
    }

    if (type === 'review_queue' || type === 'gmail_import') {
      router.push('/review-queue');
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
    async function syncSessionUser(session) {
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

        if (me) await saveCurrentUserCache(me);
        return me;
      } finally {
        // no-op
      }
    }

    async function syncSessionInBackground(session) {
      if (resolvingSessionRef.current) return null;
      resolvingSessionRef.current = true;
      try {
        return await syncSessionUser(session);
      } finally {
        resolvingSessionRef.current = false;
      }
    }

    async function routeAuthenticatedSession(session) {
      const cachedUser = await loadCurrentUserCache();
      const safeCachedUser = cachedUser?.auth_user_id === session.user.id ? cachedUser : null;

      if (!bootstrapped) {
        const routeUser = safeCachedUser || await syncSessionInBackground(session);
        router.replace(defaultAuthedRoute(routeUser, hasOnboardingRoute));
        setBootstrapped(true);
        if (safeCachedUser) {
          syncSessionInBackground(session);
        }
      } else if (hasOnboardingRoute && safeCachedUser && shouldRouteToOnboarding(safeCachedUser)) {
        router.replace('/onboarding');
      }
      maybeAutoSyncGmail(session.access_token);
    }

    // Subscribe to auth state changes.
    // INITIAL_SESSION fires on app start with the restored session (or null if not logged in).
    // SIGNED_IN fires after a fresh login. Both need the same handling.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED') && session) {
        routeAuthenticatedSession(session);
      } else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !session)) {
        router.replace('/login');
        setBootstrapped(true);
      }
    });

    return () => subscription.unsubscribe();
  }, [bootstrapped, hasOnboardingRoute]);

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

  useEffect(() => {
    async function handleNotificationResponse(response) {
      if (!bootstrapped) {
        pendingNotificationResponseRef.current = response;
        return;
      }
      await navigateFromNotificationResponse(response);
    }

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationResponse(response);
    });

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) handleNotificationResponse(response);
      })
      .catch(() => {
        // Non-fatal
      });

    return () => subscription.remove();
  }, [bootstrapped, router]);

  useEffect(() => {
    if (!bootstrapped || !pendingNotificationResponseRef.current) return;
    const response = pendingNotificationResponseRef.current;
    pendingNotificationResponseRef.current = null;
    navigateFromNotificationResponse(response);
  }, [bootstrapped, router]);

  if (!bootstrapped) {
    return (
      <View style={styles.splashContainer}>
        <View style={styles.splashImageFrame}>
          <Image
            source={require('../assets/splash-icon.png')}
            style={styles.splashImage}
            resizeMode="contain"
          />
        </View>
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
      <Stack.Screen
        name="manual-add"
        options={{
          headerShown: false,
          presentation: 'transparentModal',
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
      <Stack.Screen name="confirm" options={{ title: 'Confirm Expense', headerBackTitle: 'Summary' }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="budget-period" options={{ title: 'Budget Period', headerBackTitle: 'Settings' }} />
      <Stack.Screen name="categories" options={{ title: 'Category Details', headerBackTitle: 'Settings' }} />
      <Stack.Screen name="accounts" options={{ title: 'Accounts', headerBackTitle: 'Settings' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications', headerBackTitle: 'Settings' }} />
      <Stack.Screen name="gmail-import" options={{ title: 'Gmail Import', headerBackTitle: 'Settings' }} />
      <Stack.Screen name="insight-diagnostics" options={{ title: 'Insight Diagnostics', headerBackTitle: 'Settings' }} />
      <Stack.Screen name="review-queue" options={{ title: 'Pending actions', headerBackTitle: 'Activity' }} />
      <Stack.Screen name="payment-methods" options={{ title: 'Saved Card Labels', headerBackTitle: 'Settings' }} />
      <Stack.Screen name="expense/[id]" options={{ title: '', headerBackTitle: 'Activity' }} />
      <Stack.Screen name="scenario-check" options={{ title: 'Scenario Check', headerBackTitle: 'Summary' }} />
      <Stack.Screen name="watching-plans" options={{ title: 'Watching', headerBackTitle: 'Summary' }} />
      <Stack.Screen name="trend-detail" options={{ title: 'Trend detail', headerBackTitle: 'Summary' }} />
      <Stack.Screen name="insight-detail" options={{ title: 'Insight detail', headerBackTitle: 'Summary' }} />
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

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashImageFrame: {
    width: '72%',
    maxWidth: 320,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashImage: {
    width: '100%',
    height: '100%',
  },
});
