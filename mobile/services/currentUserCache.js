import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const { sanitizeCurrentUserCache } = require('./storageSanitizers');

const CURRENT_USER_CACHE_KEY = 'secure:current-user';
const LEGACY_CURRENT_USER_CACHE_KEY = 'cache:current-user';

async function secureStoreAvailable() {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

async function readLegacyCache() {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_CURRENT_USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw)?.data || null;
    return sanitizeCurrentUserCache(parsed);
  } catch {
    return null;
  }
}

async function purgeLegacyCache() {
  try {
    await AsyncStorage.removeItem(LEGACY_CURRENT_USER_CACHE_KEY);
  } catch {
    // Non-fatal
  }
}

export async function saveCurrentUserCache(user) {
  const sanitized = sanitizeCurrentUserCache(user);
  if (!sanitized) return;

  try {
    if (await secureStoreAvailable()) {
      await SecureStore.setItemAsync(
        CURRENT_USER_CACHE_KEY,
        JSON.stringify({ data: sanitized, ts: Date.now() })
      );
      await purgeLegacyCache();
      return;
    }
  } catch {
    // Fall through to best-effort legacy cleanup.
  }

  await purgeLegacyCache();
}

export async function loadCurrentUserCache() {
  try {
    if (await secureStoreAvailable()) {
      const raw = await SecureStore.getItemAsync(CURRENT_USER_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw)?.data || null;
        return sanitizeCurrentUserCache(parsed);
      }
    }
  } catch {
    // Fall through to one-time legacy migration.
  }

  const legacyUser = await readLegacyCache();
  if (legacyUser) {
    await saveCurrentUserCache(legacyUser);
  }
  return legacyUser;
}

export async function invalidateCurrentUserCache() {
  try {
    if (await secureStoreAvailable()) {
      await SecureStore.deleteItemAsync(CURRENT_USER_CACHE_KEY);
    }
  } catch {
    // Non-fatal
  }

  await purgeLegacyCache();
}

export { CURRENT_USER_CACHE_KEY };
