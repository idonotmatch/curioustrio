import { Stack, usePathname, useRootNavigationState, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { supabase } from '../lib/supabase';
import { MonthProvider } from '../contexts/MonthContext';
import { stashNavigationPayload } from '../services/navigationPayloadStore';
import { saveInsightDetailSnapshot } from '../services/insightLocalStore';
import { buildRecurringItemPreload } from '../services/summaryScreenHelpers';
import { loadCurrentUserCache, saveCurrentUserCache } from '../services/currentUserCache';
import { invalidateExpenseMutationCaches } from '../services/expenseMutationEffects';
import { FRESHNESS_DOMAINS, markFreshnessStale } from '../services/freshnessRegistry';
import { startHouseholdFreshnessBridge } from '../services/householdFreshnessBridge';
import {
  captureException,
  initObservability,
  wrapRootComponent,
} from '../services/observability';
import { setActiveCacheUserId, clearActiveCacheUserId } from '../services/cacheIdentity';
import { invalidateCacheByPrefix } from '../services/cache';
import { resetPendingExpenseStore } from '../hooks/usePendingExpenses';
import { INTERNAL_TOOLS_ENABLED } from '../services/internalTools';
import { colors } from '../theme/tokens';
const {
  AUTH_BOOT_CACHE_TIMEOUT_MS,
  AUTH_BOOT_SYNC_BACKGROUND_TIMEOUT_MS,
  AUTH_BOOT_SYNC_TIMEOUT_MS,
  AUTH_LINK_TIMEOUT_MS,
  defaultAuthedRoute,
  isAuthEntryPath,
  resolveWithTimeout,
  shouldRouteToOnboarding,
} = require('../services/authBootRouting');
const {
  RESET_PASSWORD_ROUTE,
  applyPasswordRecoveryUrl,
  endPasswordRecovery,
  isPasswordRecoveryActive,
} = require('../services/passwordRecovery');

initObservability();

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

function foregroundDomainsForPath(pathname = '') {
  const path = `${pathname}`;
  const domains = [FRESHNESS_DOMAINS.household];
  if (path.includes('summary') || path === '/') {
    domains.push(
      FRESHNESS_DOMAINS.expenses,
      FRESHNESS_DOMAINS.householdExpenses,
      FRESHNESS_DOMAINS.budget,
      FRESHNESS_DOMAINS.insights,
      FRESHNESS_DOMAINS.forecastMovement,
      FRESHNESS_DOMAINS.watchedPlans,
    );
  } else if (path.includes('pending') || path.includes('review-queue')) {
    domains.push(FRESHNESS_DOMAINS.pendingExpenses, FRESHNESS_DOMAINS.gmailImport);
  } else if (path.includes('index') || path.includes('expenses')) {
    domains.push(FRESHNESS_DOMAINS.expenses, FRESHNESS_DOMAINS.budget);
  }
  return [...new Set(domains)];
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
  const pathname = usePathname();
  const rootNavigationState = useRootNavigationState();
  const [bootstrapped, setBootstrapped] = useState(false);
  const [authLinkReady, setAuthLinkReady] = useState(false);
  const pathnameRef = useRef(pathname);
  const initialSessionPromiseRef = useRef(null);
  const initialUserCachePromiseRef = useRef(null);
  const resolvingSessionRef = useRef(false);
  const routedSessionIdRef = useRef(null);
  const gmailSyncInFlightRef = useRef(false);
  const lastGmailAutoSyncAttemptRef = useRef(0);
  const gmailAutoSyncTimerRef = useRef(null);
  const lastHandledNotificationRef = useRef(null);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const pendingNotificationResponseRef = useRef(null);
  const hasOnboardingRoute = rootNavigationState?.routeNames?.includes('onboarding') === true;

  async function maybeHandlePasswordRecoveryUrl(url) {
    if (!url) return false;
    try {
      const { handled } = await applyPasswordRecoveryUrl(url, supabase.auth);
      if (!handled) return false;
      router.replace(RESET_PASSWORD_ROUTE);
      setBootstrapped(true);
      return true;
    } catch (error) {
      endPasswordRecovery();
      captureException(error, { area: 'password_recovery_link' });
      console.error('[password-recovery] failed to apply reset link:', error?.message ?? error);
      router.replace('/login');
      setBootstrapped(true);
      return true;
    }
  }

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
      await api.post('/gmail/import', { source: 'app_open' }, { token });
      await invalidateExpenseMutationCaches();
    } catch (error) {
      captureException(error, { area: 'gmail_auto_sync' });
    } finally {
      gmailSyncInFlightRef.current = false;
    }
  }

  function scheduleGmailAutoSync(token) {
    if (!token) return;
    if (gmailAutoSyncTimerRef.current) clearTimeout(gmailAutoSyncTimerRef.current);
    gmailAutoSyncTimerRef.current = setTimeout(() => {
      gmailAutoSyncTimerRef.current = null;
      maybeAutoSyncGmail(token);
    }, 1800);
  }

  // Auth state listener
  useEffect(() => {
    if (!authLinkReady) return undefined;

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
          captureException(syncErr, { area: 'auth_sync', fallback: 'users_me' });
          console.error('[routeAuthenticatedSession] sync failed, falling back to /users/me:', syncErr?.message ?? syncErr);
          try {
            me = await api.get('/users/me', { token: session.access_token });
          } catch (meErr) {
            captureException(meErr, { area: 'auth_sync_fallback' });
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
        return await resolveWithTimeout(
          syncSessionUser(session),
          AUTH_BOOT_SYNC_BACKGROUND_TIMEOUT_MS,
          null
        );
      } finally {
        resolvingSessionRef.current = false;
      }
    }

    async function routeAuthenticatedSession(session) {
      const cacheIdentity = setActiveCacheUserId(session.user.id);
      if (cacheIdentity.changed && cacheIdentity.previousUserId) {
        resetPendingExpenseStore();
      }
      const routeKey = `${session.user.id}:${session.access_token ? session.access_token.slice(-12) : 'no-token'}`;
      const alreadyRoutedSession = routedSessionIdRef.current === routeKey;
      if (alreadyRoutedSession && bootstrapped && !isAuthEntryPath(pathname)) {
        scheduleGmailAutoSync(session.access_token);
        return;
      }

      const cachedUser = await (
        initialUserCachePromiseRef.current
        || resolveWithTimeout(loadCurrentUserCache(), AUTH_BOOT_CACHE_TIMEOUT_MS, null)
      );
      const safeCachedUser = cachedUser?.auth_user_id === session.user.id ? cachedUser : null;
      const shouldReplaceAuthEntry = isAuthEntryPath(pathname);

      if (isPasswordRecoveryActive()) {
        setBootstrapped(true);
        router.replace(RESET_PASSWORD_ROUTE);
        if (!safeCachedUser) {
          syncSessionInBackground(session);
        }
        return;
      }

      if (!bootstrapped || shouldReplaceAuthEntry) {
        let routeUser = safeCachedUser;
        if (!routeUser) {
          const syncPromise = syncSessionInBackground(session);
          routeUser = await resolveWithTimeout(syncPromise, AUTH_BOOT_SYNC_TIMEOUT_MS, null);
          if (!routeUser) {
            console.info('[boot] user sync still pending; routing with cached/default state');
            syncPromise
              .then((resolvedUser) => {
                if (!resolvedUser) return;
                if (resolvedUser && hasOnboardingRoute && shouldRouteToOnboarding(resolvedUser)) {
                  router.replace('/onboarding');
                }
              })
              .catch(() => {
                // Non-fatal. The app has already left the logo screen.
              });
          }
        }
        router.replace(defaultAuthedRoute(routeUser, hasOnboardingRoute));
        routedSessionIdRef.current = routeKey;
        setBootstrapped(true);
        if (safeCachedUser) {
          syncSessionInBackground(session);
        }
      } else if (hasOnboardingRoute && safeCachedUser && shouldRouteToOnboarding(safeCachedUser) && pathname !== '/onboarding') {
        router.replace('/onboarding');
      }
      scheduleGmailAutoSync(session.access_token);
    }

    // Subscribe to auth state changes.
    // INITIAL_SESSION fires on app start with the restored session (or null if not logged in).
    // SIGNED_IN fires after a fresh login. Both need the same handling.
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED') && session) {
        routeAuthenticatedSession(session);
      } else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !session)) {
        resetPendingExpenseStore();
        clearActiveCacheUserId();
        invalidateCacheByPrefix('cache:').catch(() => {});
        endPasswordRecovery();
        router.replace('/login');
        setBootstrapped(true);
      }
    });

    const initialSessionPromise = initialSessionPromiseRef.current
      || resolveWithTimeout(supabase.auth.getSession(), AUTH_BOOT_SYNC_TIMEOUT_MS, null);

    initialSessionPromise
      .then((result) => {
        if (!active || bootstrapped) return;
        const session = result?.data?.session || null;
        if (session) {
          routeAuthenticatedSession(session);
        } else {
          endPasswordRecovery();
          router.replace('/login');
          setBootstrapped(true);
        }
      })
      .catch(() => {
        if (!active || bootstrapped) return;
        router.replace('/login');
        setBootstrapped(true);
      });

    return () => {
      active = false;
      if (gmailAutoSyncTimerRef.current) {
        clearTimeout(gmailAutoSyncTimerRef.current);
        gmailAutoSyncTimerRef.current = null;
      }
      subscription.unsubscribe();
    };
  }, [authLinkReady, bootstrapped, hasOnboardingRoute, pathname, router]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          markFreshnessStale(foregroundDomainsForPath(pathnameRef.current), { reason: 'app_foreground', delayMs: 800 });
          maybeAutoSyncGmail(session.access_token);
        }
      } catch {
        // Non-fatal
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let active = true;

    async function bootstrapAuthLinks() {
      initialSessionPromiseRef.current = resolveWithTimeout(
        supabase.auth.getSession(),
        AUTH_BOOT_SYNC_TIMEOUT_MS,
        null
      ).catch(() => null);
      initialUserCachePromiseRef.current = resolveWithTimeout(
        loadCurrentUserCache(),
        AUTH_BOOT_CACHE_TIMEOUT_MS,
        null
      ).catch(() => null);

      try {
        const initialUrl = await resolveWithTimeout(
          Linking.getInitialURL(),
          AUTH_LINK_TIMEOUT_MS,
          null
        );
        if (!active) return;
        await maybeHandlePasswordRecoveryUrl(initialUrl);
      } finally {
        if (active) setAuthLinkReady(true);
      }
    }

    bootstrapAuthLinks();

    const subscription = Linking.addEventListener('url', ({ url }) => {
      maybeHandlePasswordRecoveryUrl(url);
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, [router]);

  useEffect(() => {
    if (!authLinkReady) return undefined;

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
  }, [authLinkReady, bootstrapped, router]);

  useEffect(() => {
    if (!bootstrapped || !pendingNotificationResponseRef.current) return;
    const response = pendingNotificationResponseRef.current;
    pendingNotificationResponseRef.current = null;
    navigateFromNotificationResponse(response);
  }, [bootstrapped, router]);

  useEffect(() => {
    if (!bootstrapped) return undefined;
    return startHouseholdFreshnessBridge();
  }, [bootstrapped]);

  if (!bootstrapped) {
    return <View style={styles.bootContainer} />;
  }

  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: colors.background },
      headerTintColor: colors.text,
      headerTitleStyle: { fontWeight: '500', fontSize: 15 },
      headerShadowVisible: false,
      contentStyle: { backgroundColor: colors.background },
    }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="reset-password" options={{ title: 'Reset password', headerBackTitle: 'Back' }} />
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
      {INTERNAL_TOOLS_ENABLED ? (
        <Stack.Screen name="insight-diagnostics" options={{ title: 'Insight Diagnostics', headerBackTitle: 'Settings' }} />
      ) : null}
      <Stack.Screen name="review-queue" options={{ title: 'Pending actions', headerBackTitle: 'Activity' }} />
      <Stack.Screen name="duplicate-review" options={{ title: 'Possible duplicate', headerBackTitle: 'Back' }} />
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

function RootLayout() {
  // Auth0Provider wrapper removed — Supabase manages session internally via lib/supabase.js
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MonthProvider>
        <AppNavigator />
      </MonthProvider>
    </GestureHandlerRootView>
  );
}

export default wrapRootComponent(RootLayout);

export function ErrorBoundary({ error, retry }) {
  useEffect(() => {
    captureException(error, { area: 'root_error_boundary' });
  }, [error]);

  return (
    <View style={styles.errorContainer}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.errorBody}>Your data is safe. Try loading the app again.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Try loading the app again"
        onPress={retry}
        style={({ pressed }) => [styles.errorButton, pressed && styles.errorButtonPressed]}
      >
        <Text style={styles.errorButtonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bootContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    backgroundColor: colors.background,
  },
  errorTitle: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorBody: {
    marginTop: 8,
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  errorButton: {
    marginTop: 20,
    minHeight: 44,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  errorButtonPressed: {
    backgroundColor: colors.accentPressed,
  },
  errorButtonText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: '700',
  },
});
