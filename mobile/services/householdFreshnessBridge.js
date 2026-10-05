import { AppState } from 'react-native';
import { api } from './api';
import { supabase } from '../lib/supabase';
import { loadCurrentUserCache, saveCurrentUserCache } from './currentUserCache';
import { markFreshnessStale } from './freshnessRegistry';

const POLL_INTERVAL_MS = 90 * 1000;
const START_LOOKBACK_MS = 30 * 1000;
const MAX_SEEN_EVENT_IDS = 1000;

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

async function resolveCurrentUser() {
  try {
    const cached = await loadCurrentUserCache();
    if (cached?.id) return cached;
  } catch {}
  try {
    const user = await api.get('/users/me');
    if (user?.id) await saveCurrentUserCache(user);
    return user || null;
  } catch {
    return null;
  }
}

export function startHouseholdFreshnessBridge() {
  let stopped = false;
  let user = null;
  let latestCreatedAt = new Date(Date.now() - START_LOOKBACK_MS).toISOString();
  let pollTimer = null;
  let householdChannel = null;
  let userChannel = null;
  let realtimeHealthy = false;
  const seenIds = new Set();

  function stopChannel(channel) {
    if (!channel) return;
    try {
      supabase.removeChannel(channel);
    } catch {}
  }

  function stopRealtime() {
    stopChannel(householdChannel);
    stopChannel(userChannel);
    householdChannel = null;
    userChannel = null;
  }

  async function poll() {
    if (stopped || AppState.currentState !== 'active') return;
    if (realtimeHealthy) return;
    try {
      const data = await api.get(`/freshness/events?since=${encodeURIComponent(latestCreatedAt)}&limit=100`);
      const events = Array.isArray(data?.events) ? data.events : [];
      for (const event of events) {
        processEvent(event, seenIds);
        if (event?.created_at && event.created_at > latestCreatedAt) {
          latestCreatedAt = event.created_at;
        }
      }
      if (data?.latest_created_at && data.latest_created_at > latestCreatedAt) {
        latestCreatedAt = data.latest_created_at;
      }
    } catch {
      // Realtime is the preferred path; polling is best-effort.
    }
  }

  function schedulePolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    poll();
  }

  function subscribeToRealtime() {
    stopRealtime();
    realtimeHealthy = false;
    if (!user?.id) return;

    const handlePayload = (payload) => {
      const event = payload?.new || null;
      if (event?.created_at && event.created_at > latestCreatedAt) {
        latestCreatedAt = event.created_at;
      }
      processEvent(event, seenIds);
    };

    userChannel = supabase
      .channel(`freshness:user:${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'household_freshness_events',
      }, handlePayload)
      .subscribe((status) => {
        realtimeHealthy = status === 'SUBSCRIBED';
        if (!realtimeHealthy) poll();
      });
  }

  async function start() {
    user = await resolveCurrentUser();
    if (stopped) return;
    subscribeToRealtime();
    schedulePolling();
  }

  const appStateSub = AppState.addEventListener('change', async (state) => {
    if (stopped) return;
    if (state === 'active') {
      const nextUser = await resolveCurrentUser();
      const identityChanged = nextUser?.id !== user?.id || nextUser?.household_id !== user?.household_id;
      user = nextUser || user;
      if (identityChanged) subscribeToRealtime();
      poll();
    }
  });

  start();

  return () => {
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
    appStateSub.remove();
    stopRealtime();
  };
}
