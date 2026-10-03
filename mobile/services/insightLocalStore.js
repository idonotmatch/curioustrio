import AsyncStorage from '@react-native-async-storage/async-storage';

const { sanitizeInsightSnapshot } = require('./storageSanitizers');
const { sanitizeExpenseCollection } = require('./storageSanitizers');
const { scopedCacheKey } = require('./cacheIdentity');

function keyForInsight(insightId) {
  return scopedCacheKey(`cache:insight-detail:${insightId}`);
}

function isSamePayload(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export async function saveInsightDetailSnapshot(insight = {}, extras = {}) {
  const sanitizedInsight = sanitizeInsightSnapshot(insight);
  const insightId = sanitizedInsight?.id;
  if (!insightId) return;
  const payload = {
    insight: sanitizedInsight,
    extras: {
      preloadEvidence: sanitizeExpenseCollection(extras?.preloadEvidence || []).slice(0, 8),
    },
    saved_at: Date.now(),
  };
  try {
    await AsyncStorage.setItem(keyForInsight(insightId), JSON.stringify(payload));
  } catch {
    // non-fatal
  }
}

export async function loadInsightDetailSnapshot(insightId) {
  if (!insightId) return null;
  try {
    const raw = await AsyncStorage.getItem(keyForInsight(insightId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const sanitized = parsed && typeof parsed === 'object'
      ? {
        insight: sanitizeInsightSnapshot(parsed.insight || {}),
        extras: {
          preloadEvidence: sanitizeExpenseCollection(parsed?.extras?.preloadEvidence || []).slice(0, 8),
        },
        saved_at: Number(parsed.saved_at || 0) || Date.now(),
      }
      : null;
    if (sanitized?.insight?.id === insightId) {
      if (!isSamePayload(sanitized, parsed)) {
        AsyncStorage.setItem(keyForInsight(insightId), JSON.stringify(sanitized)).catch(() => {});
      }
      return sanitized;
    }
    return null;
  } catch {
    return null;
  }
}
