import { AppState } from 'react-native';
import { api } from './api';
import { supabase } from '../lib/supabase';
import { loadCurrentUserCache, saveCurrentUserCache } from './currentUserCache';
import { markFreshnessStale } from './freshnessRegistry';

const {
  DEFAULT_FRESHNESS_PAGE_SIZE,
  advanceFreshnessCursor,
  buildFreshnessEventsPath,
} = require('./freshnessCursor');

const POLL_INTERVAL_MS = 90 * 1000;
const START_LOOKBACK_MS = 30 * 1000;
const MAX_SEEN_EVENT_IDS = 1000;
const MAX_POLL_PAGES = 5;

function eventDomains(event = {}) {
  return (Array.isArray(event?.domains) ? event.domains : [])
    .map((domain) => `${domain || ''}`.trim())
    .filter(Boolean);
}

function processEvent(event, seenIds) {
  if (!event?.id || seenIds.has(event.id)) return false;
  seenIds.add(event.id);
  while (seenIds.size > MAX_SEEN_EVENT_IDS) {
    const oldestId = seenIds.values().next().value;
    if (oldestId == null) break;
    seenIds.delete(oldestId);
  }
  const domains = eventDomains(event);
  if (!domains.length) return false;
  markFreshnessStale(domains, {
    reason: event.event_type || 'household_freshness_event',
    delayMs: 350,
  });
  return true;
}

async function resolveCurrentUser(sessionOverride = undefined) {
  let session = sessionOverride;
  if (session === undefined) {
    try {
      const result = await supabase.auth.getSession();
      session = result?.data?.session || null;
    } catch {
      session = null;
    }
  }
  const authUserId = session?.user?.id || null;
  if (!authUserId) return null;

  try {
    const user = await api.get('/users/me', { token: session.access_token, dedupe: false });
    if (user?.id && user?.auth_user_id === authUserId) {
      await saveCurrentUserCache(user);
      return user;
    }
  } catch {}

  try {
    const cached = await loadCurrentUserCache();
    if (cached?.id && cached?.auth_user_id === authUserId) return cached;
  } catch {}
  return null;
}

export function startHouseholdFreshnessBridge() {
  let stopped = false;
  let user = null;
  let pollCursor = {
    created_at: new Date(Date.now() - START_LOOKBACK_MS).toISOString(),
    id: null,
  };
  let pollTimer = null;
  let pollPromise = null;
  let householdChannel = null;
  let userChannel = null;
  let realtimeHealthy = false;
  let subscriptionGeneration = 0;
  let identityGeneration = 0;
  const channelStatuses = new Map();
  const seenIds = new Set();

  function stopChannel(channel) {
    if (!channel) return;
    try {
      supabase.removeChannel(channel);
    } catch {}
  }

  function stopRealtime() {
    subscriptionGeneration += 1;
    stopChannel(householdChannel);
    stopChannel(userChannel);
    householdChannel = null;
    userChannel = null;
    channelStatuses.clear();
    realtimeHealthy = false;
  }

  async function poll() {
    if (pollPromise) return pollPromise;
    if (stopped || !user?.id || AppState.currentState !== 'active') return null;
    if (realtimeHealthy) return;

    const pollIdentity = identityGeneration;
    const pollUserId = user.id;
    pollPromise = (async () => {
      try {
        for (let page = 0; page < MAX_POLL_PAGES; page += 1) {
          const data = await api.get(buildFreshnessEventsPath(pollCursor), { dedupe: false });
          if (stopped || pollIdentity !== identityGeneration || user?.id !== pollUserId) break;
          const events = Array.isArray(data?.events) ? data.events : [];
          for (const event of events) {
            processEvent(event, seenIds);
          }
          pollCursor = advanceFreshnessCursor(pollCursor, events);
          if (events.length < DEFAULT_FRESHNESS_PAGE_SIZE) break;
        }
      } catch {
        // Realtime is the preferred path; polling is best-effort.
      } finally {
        pollPromise = null;
      }
    })();
    return pollPromise;
  }

  function schedulePolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    poll();
  }

  function subscribeToRealtime() {
    stopRealtime();
    if (!user?.id) return;
    const generation = subscriptionGeneration;
    const expectedChannels = new Set(['user']);
    if (user.household_id) expectedChannels.add('household');

    const updateStatus = (channelName, status) => {
      if (stopped || generation !== subscriptionGeneration) return;
      channelStatuses.set(channelName, status);
      realtimeHealthy = [...expectedChannels]
        .every((name) => channelStatuses.get(name) === 'SUBSCRIBED');
      if (!realtimeHealthy) poll();
    };

    const handlePayload = (payload) => {
      const event = payload?.new || null;
      processEvent(event, seenIds);
    };

    userChannel = supabase
      .channel(`freshness:user:${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'household_freshness_events',
        filter: `target_user_id=eq.${user.id}`,
      }, handlePayload)
      .subscribe((status) => updateStatus('user', status));

    if (user.household_id) {
      householdChannel = supabase
        .channel(`freshness:household:${user.household_id}:${user.id}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'household_freshness_events',
          filter: `household_id=eq.${user.household_id}`,
        }, handlePayload)
        .subscribe((status) => updateStatus('household', status));
    }
  }

  async function refreshIdentity(sessionOverride = undefined) {
    const generation = ++identityGeneration;
    const nextUser = await resolveCurrentUser(sessionOverride);
    if (stopped || generation !== identityGeneration) return;
    const identityChanged = nextUser?.id !== user?.id
      || nextUser?.household_id !== user?.household_id;
    user = nextUser;
    if (identityChanged) {
      seenIds.clear();
      pollCursor = {
        created_at: new Date(Date.now() - START_LOOKBACK_MS).toISOString(),
        id: null,
      };
      subscribeToRealtime();
    }
    poll();
  }

  const appStateSub = AppState.addEventListener('change', async (state) => {
    if (stopped) return;
    if (state === 'active') {
      refreshIdentity();
    }
  });

  const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      identityGeneration += 1;
      user = null;
      seenIds.clear();
      stopRealtime();
      return;
    }
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
      refreshIdentity(session);
    }
  });

  schedulePolling();
  refreshIdentity();

  return () => {
    stopped = true;
    identityGeneration += 1;
    if (pollTimer) clearInterval(pollTimer);
    appStateSub.remove();
    authSubscription.unsubscribe();
    stopRealtime();
  };
}
