import AsyncStorage from '@react-native-async-storage/async-storage';
const {
  sanitizeExpenseCollection,
  sanitizeInsightSnapshot,
} = require('./storageSanitizers');
const { scopedCacheKey } = require('./cacheIdentity');

const SUMMARY_SNAPSHOT_PREFIX = 'cache:summary-snapshot';
const MAX_RECENT_EXPENSES = 8;
const MAX_PENDING_EXPENSES = 8;
const MAX_WATCHED_PLANS = 5;
const MAX_INSIGHTS = 5;

function snapshotKey(month, startDay) {
  return scopedCacheKey(`${SUMMARY_SNAPSHOT_PREFIX}:${month || 'current'}:${startDay || 'default'}`);
}

function sanitizeBudget(budget = null) {
  if (!budget || typeof budget !== 'object') return null;
  const total = budget.total && typeof budget.total === 'object' ? budget.total : null;
  if (!total) return { ...budget, total: null };
  return {
    ...budget,
    total: {
      spent: Number(total.spent || 0),
      limit: Number(total.limit || 0),
      remaining: Number(total.remaining || 0),
    },
  };
}

function sanitizeGmailSummary(summary = null) {
  if (!summary || typeof summary !== 'object') return null;
  return {
    imported: Number(summary.imported || 0),
    skipped: Number(summary.skipped || 0),
    failed: Number(summary.failed || 0),
    imported_pending_review: Number(summary.imported_pending_review || 0),
    current_pending_review: Number(summary.current_pending_review || 0),
    approved_without_changes: Number(summary.approved_without_changes || 0),
    last_synced_at: summary.last_synced_at || null,
    last_sync_attempted_at: summary.last_sync_attempted_at || null,
    last_imported_at: summary.last_imported_at || null,
    last_sync_status: summary.last_sync_status || null,
  };
}

function sanitizeWatchedPlans(plans = []) {
  if (!Array.isArray(plans)) return [];
  return plans.slice(0, MAX_WATCHED_PLANS).map((plan) => ({
    id: plan.id || null,
    scope: plan.scope || 'personal',
    last_material_change: plan.last_material_change || null,
    timing_preference_note: plan.timing_preference_note || '',
  })).filter((plan) => plan.id);
}

function sanitizeForecastMovement(summary = null) {
  if (!summary || typeof summary !== 'object') return null;
  return {
    state: summary.state || 'quiet_stable',
    tone: summary.tone || 'neutral',
    title: summary.title || '',
    body: summary.body || '',
    metric: summary.metric && typeof summary.metric === 'object' ? summary.metric : null,
    cta: summary.cta && typeof summary.cta === 'object' ? summary.cta : null,
    source: summary.source || null,
    scope: summary.scope || null,
    period: summary.period || null,
    generated_at: summary.generated_at || null,
  };
}

function sanitizeInsights(insights = []) {
  if (!Array.isArray(insights)) return [];
  return insights
    .slice(0, MAX_INSIGHTS)
    .map((insight) => sanitizeInsightSnapshot(insight))
    .filter(Boolean);
}

export async function loadSummarySnapshot(month, startDay) {
  try {
    const raw = await AsyncStorage.getItem(snapshotKey(month, startDay));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.data || null;
  } catch {
    return null;
  }
}

export async function saveSummarySnapshot(month, startDay, data = {}) {
  try {
    const snapshot = {
      month,
      start_day: startDay || null,
      saved_at: new Date().toISOString(),
      personal_budget: sanitizeBudget(data.personalBudget),
      household_budget: sanitizeBudget(data.householdBudget),
      expenses: sanitizeExpenseCollection(data.expenses || []).slice(0, MAX_RECENT_EXPENSES),
      household_expenses: sanitizeExpenseCollection(data.householdExpenses || []).slice(0, MAX_RECENT_EXPENSES),
      pending_expenses: sanitizeExpenseCollection(data.pendingExpenses || []).slice(0, MAX_PENDING_EXPENSES),
      gmail_import_summary: sanitizeGmailSummary(data.gmailImportSummary),
      watched_plans: sanitizeWatchedPlans(data.watchedPlans || []),
      forecast_movement: sanitizeForecastMovement(data.forecastMovement),
      insights: sanitizeInsights(data.insights || []),
    };
    await AsyncStorage.setItem(snapshotKey(month, startDay), JSON.stringify({ data: snapshot, ts: Date.now() }));
    return snapshot;
  } catch {
    return null;
  }
}

export { SUMMARY_SNAPSHOT_PREFIX };
