import AsyncStorage from '@react-native-async-storage/async-storage';

function keyForInsight(insightId) {
  return `cache:insight-detail:${insightId}`;
}

export async function saveInsightDetailSnapshot(insight = {}, extras = {}) {
  const insightId = insight?.id;
  if (!insightId) return;
  const payload = {
    insight: {
      id: insight.id,
      type: insight.type || '',
      title: insight.title || '',
      body: insight.body || '',
      severity: insight.severity || 'low',
      entity_type: insight.entity_type || '',
      entity_id: insight.entity_id || '',
      metadata: insight.metadata || {},
      action: insight.action || null,
    },
    extras: {
      preloadEvidence: Array.isArray(extras?.preloadEvidence) ? extras.preloadEvidence : [],
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
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
