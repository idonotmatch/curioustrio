import AsyncStorage from '@react-native-async-storage/async-storage';

const CURRENT_USER_CACHE_KEY = 'cache:current-user';

export async function saveCurrentUserCache(user) {
  if (!user) return;
  try {
    await AsyncStorage.setItem(
      CURRENT_USER_CACHE_KEY,
      JSON.stringify({ data: user, ts: Date.now() })
    );
  } catch {
    // Non-fatal
  }
}

export async function loadCurrentUserCache() {
  try {
    const raw = await AsyncStorage.getItem(CURRENT_USER_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw)?.data || null;
  } catch {
    return null;
  }
}

export async function invalidateCurrentUserCache() {
  try {
    await AsyncStorage.removeItem(CURRENT_USER_CACHE_KEY);
  } catch {
    // Non-fatal
  }
}

export { CURRENT_USER_CACHE_KEY };
