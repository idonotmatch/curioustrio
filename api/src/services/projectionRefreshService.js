const db = require('../db');
const InsightPortfolioSnapshot = require('../models/insightPortfolioSnapshot');
const UserSummarySnapshot = require('../models/userSummarySnapshot');
const { buildSummaryBundle } = require('./summaryBundleService');
const { buildInsightsForUser } = require('./insightBuilder');
const { attachInsightAction } = require('./insightAction');
const {
  attachInsightForecasts,
  evaluateDueForecastOutcomes,
} = require('./insightForecastService');
const {
  DOMAINS,
  emitFreshnessEvent,
} = require('./freshnessEvents');

const pendingRefreshes = new Map();
const DEFAULT_DEBOUNCE_MS = Number(process.env.PROJECTION_REFRESH_DEBOUNCE_MS || 750);

function monthFromDate(value) {
  if (!value) return null;
  const text = `${value}`;
  if (/^\d{4}-\d{2}/.test(text)) return text.slice(0, 7);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function scopeForUser(user, requestedScope = null) {
  if (requestedScope === 'household' && user?.household_id) return 'household';
  return requestedScope || 'personal';
}

function sourceEventFromInput({
  reason,
  scope,
  period,
  expense = null,
  categoryId = null,
  merchant = null,
  metadata = {},
}) {
  return {
    reason,
    scope,
    period,
    expense_id: expense?.id || metadata.expense_id || null,
    category_id: categoryId || expense?.category_id || metadata.category_id || null,
    merchant: merchant || expense?.merchant || metadata.merchant || null,
    source: metadata.source || null,
  };
}

function isMissingRefreshTable(err) {
  return err?.code === '42P01' || /projection_refresh_events|insight_forecast_snapshots/i.test(`${err?.message || ''}`);
}

async function recordRefreshEvent(userId, event) {
  try {
    const result = await db.query(
      `INSERT INTO projection_refresh_events (
        user_id, reason, scope, period, expense_id, category_id, merchant, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'running')
      RETURNING id`,
      [
        userId,
        event.reason || 'unknown',
        event.scope || null,
        event.period || null,
        event.expense_id || null,
        event.category_id || null,
        event.merchant || null,
      ]
    );
    return result.rows[0]?.id || null;
  } catch (err) {
    if (isMissingRefreshTable(err)) return null;
    throw err;
  }
}

async function completeRefreshEvent(eventId, patch) {
  if (!eventId) return;
  try {
    await db.query(
      `UPDATE projection_refresh_events
       SET status = $2,
           forecast_count = COALESCE($3, forecast_count),
           snapshot_count = COALESCE($4, snapshot_count),
           error_message = $5,
           completed_at = NOW()
       WHERE id = $1`,
      [
        eventId,
        patch.status || 'completed',
        patch.forecastCount ?? null,
        patch.snapshotCount ?? null,
        patch.errorMessage || null,
      ]
    );
  } catch (err) {
    if (!isMissingRefreshTable(err)) throw err;
  }
}

function countForecasts(insights = []) {
  return insights.filter((insight) => insight?.forecast).length;
}

async function refreshProjectionNow({
  user,
  reason = 'expense_changed',
  scope = null,
  month = null,
  expense = null,
  categoryId = null,
  merchant = null,
  limit = 25,
  metadata = {},
} = {}) {
  if (!user?.id) return { forecast_count: 0, snapshot_count: 0, skipped: true };
  const effectiveScope = scopeForUser(user, scope || metadata.scope || null);
  const period = month || metadata.month || monthFromDate(expense?.date) || null;
  const sourceEvent = sourceEventFromInput({
    reason,
    scope: effectiveScope,
    period,
    expense,
    categoryId,
    merchant,
    metadata,
  });
  const eventId = await recordRefreshEvent(user.id, sourceEvent);

  try {
    await evaluateDueForecastOutcomes(user);
    const insights = (await buildInsightsForUser({ user, limit })).map(attachInsightAction);
    const withForecasts = await attachInsightForecasts(user.id, insights, {
      persistSnapshots: true,
      sourceEvent,
    });
    const insightSourceFingerprint = await InsightPortfolioSnapshot.sourceFingerprint(user.id);
    await InsightPortfolioSnapshot.upsert(user.id, withForecasts, sourceEvent, insightSourceFingerprint);
    const summaryPeriod = period || new Date().toISOString().slice(0, 7);
    const summaryStartDay = Math.max(1, Math.min(Number(user.budget_start_day) || 1, 28));
    try {
      const summaryPayload = await buildSummaryBundle({
        user,
        period: summaryPeriod,
        startDay: summaryStartDay,
      });
      await UserSummarySnapshot.upsert({
        userId: user.id,
        householdId: user.household_id,
        period: summaryPeriod,
        startDay: summaryStartDay,
        payload: summaryPayload,
      });
    } catch (summaryErr) {
      console.error('[projection refresh] summary warm failed:', {
        user_id: user.id,
        message: summaryErr?.message || String(summaryErr || 'unknown_error'),
      });
    }
    const forecastCount = countForecasts(withForecasts);
    await completeRefreshEvent(eventId, {
      status: 'completed',
      forecastCount,
      snapshotCount: forecastCount,
    });
    emitFreshnessEvent(user, {
      eventType: 'projection_refreshed',
      domains: [DOMAINS.insights, DOMAINS.forecastMovement],
      entityType: 'projection_refresh',
      entityId: eventId,
      metadata: {
        reason,
        scope: effectiveScope,
        period,
        forecast_count: forecastCount,
        snapshot_count: forecastCount,
      },
      privateOnly: effectiveScope !== 'household',
    });
    return {
      forecast_count: forecastCount,
      snapshot_count: forecastCount,
      source_event: sourceEvent,
    };
  } catch (err) {
    await completeRefreshEvent(eventId, {
      status: 'failed',
      errorMessage: err?.message || String(err || 'unknown_error'),
    });
    throw err;
  }
}

function pendingKey(user, options = {}) {
  const month = options.month || monthFromDate(options.expense?.date) || 'current';
  const scope = scopeForUser(user, options.scope || options.metadata?.scope || null);
  return `${user?.id || 'unknown'}:${scope}:${month}`;
}

function requestProjectionRefresh(options = {}) {
  const { user } = options;
  if (!user?.id) return null;
  InsightPortfolioSnapshot.invalidate(user.id).catch((err) => {
    console.error('[projection refresh] snapshot invalidation failed:', {
      user_id: user.id,
      message: err?.message || String(err || 'unknown_error'),
    });
  });
  const key = pendingKey(user, options);
  const existing = pendingRefreshes.get(key);
  if (existing) clearTimeout(existing.timer);

  const debounceMs = Math.max(0, Number(options.debounceMs ?? DEFAULT_DEBOUNCE_MS));
  const timer = setTimeout(async () => {
    pendingRefreshes.delete(key);
    try {
      await refreshProjectionNow(options);
    } catch (err) {
      console.error('[projection refresh] failed:', {
        user_id: user.id,
        reason: options.reason || 'expense_changed',
        message: err?.message || String(err || 'unknown_error'),
      });
    }
  }, debounceMs);

  pendingRefreshes.set(key, { timer, options });
  return key;
}

module.exports = {
  monthFromDate,
  refreshProjectionNow,
  requestProjectionRefresh,
  sourceEventFromInput,
};
