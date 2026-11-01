import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { api } from './api';
import { toLocalDateString } from './date';
import {
  INITIAL_WIDGET_PROPS,
  widgetPropsFromSnapshot,
} from './widgetSnapshotPresentation';

const LAST_WIDGET_SYNC_KEY = 'widget:last-sync:v1';
const MIN_SYNC_INTERVAL_MS = 5 * 60 * 1000;
let syncInFlight = null;
let scheduledSync = null;
let syncGeneration = 0;

function getWidget() {
  if (Platform.OS !== 'ios') return null;
  try {
    return require('../widgets/AdloPulseWidget').AdloPulseWidget;
  } catch (error) {
    if (__DEV__) console.warn('[widget] native widget unavailable:', error?.message || error);
    return null;
  }
}

async function lastSyncAt() {
  const value = Number(await AsyncStorage.getItem(LAST_WIDGET_SYNC_KEY));
  return Number.isFinite(value) ? value : 0;
}

export async function syncWidgetSnapshot({ force = false, token } = {}) {
  const widget = getWidget();
  if (!widget) return false;
  if (syncInFlight) return syncInFlight;

  const generation = syncGeneration;
  syncInFlight = (async () => {
    const now = Date.now();
    if (!force && now - await lastSyncAt() < MIN_SYNC_INTERVAL_MS) return false;
    const today = toLocalDateString();
    const snapshot = await api.get(`/summary/widget?today=${encodeURIComponent(today)}`, { token });
    if (generation !== syncGeneration) return false;
    widget.updateSnapshot(widgetPropsFromSnapshot(snapshot));
    await AsyncStorage.setItem(LAST_WIDGET_SYNC_KEY, `${now}`);
    return true;
  })().catch((error) => {
    if (__DEV__) console.warn('[widget] snapshot refresh failed:', error?.message || error);
    return false;
  }).finally(() => {
    syncInFlight = null;
  });

  return syncInFlight;
}

export function scheduleWidgetSnapshotSync({ force = true, delayMs = 900 } = {}) {
  if (Platform.OS !== 'ios') return;
  if (scheduledSync) clearTimeout(scheduledSync);
  scheduledSync = setTimeout(() => {
    scheduledSync = null;
    syncWidgetSnapshot({ force });
  }, Math.max(0, Number(delayMs) || 0));
}

export async function clearWidgetSnapshot() {
  syncGeneration += 1;
  if (scheduledSync) {
    clearTimeout(scheduledSync);
    scheduledSync = null;
  }
  await AsyncStorage.removeItem(LAST_WIDGET_SYNC_KEY);
  const widget = getWidget();
  if (widget) widget.updateSnapshot({ ...INITIAL_WIDGET_PROPS });
  if (syncInFlight) await syncInFlight;
  return !!widget;
}
