const db = require('../db');
const EmailImportLog = require('../models/emailImportLog');

const MATERIAL_DELTA = 25;
const MATERIAL_PERCENT = 0.08;
const PENDING_AMOUNT_THRESHOLD = 25;

function num(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCurrency(value) {
  const amount = Math.round(Math.abs(Number(value || 0)));
  if (amount >= 1000) {
    const short = amount / 1000;
    return `$${short >= 10 ? short.toFixed(0) : short.toFixed(1)}k`;
  }
  return `$${amount}`;
}

function formatSignedCurrency(value) {
  const amount = Number(value || 0);
  if (amount === 0) return '$0';
  return `${amount > 0 ? '+' : '-'}${formatCurrency(amount)}`;
}

function movementMagnitude(current, previous) {
  const next = num(current);
  const prior = num(previous);
  if (next == null || prior == null) return null;
  return next - prior;
}

function isMaterialMovement(delta, previous) {
  const amount = Math.abs(Number(delta || 0));
  if (amount >= MATERIAL_DELTA) return true;
  const base = Math.max(Math.abs(Number(previous || 0)), 1);
  return amount / base >= MATERIAL_PERCENT && amount >= 10;
}

function confidenceRank(label) {
  const normalized = `${label || ''}`.toLowerCase();
  if (normalized === 'calibrated' || normalized === 'high' || normalized === 'comparative') return 3;
  if (normalized === 'directional' || normalized === 'medium') return 2;
  if (normalized === 'early' || normalized === 'low' || normalized === 'very_low') return 1;
  return 0;
}

function driverName(snapshot = {}) {
  const feature = snapshot.feature_snapshot || {};
  const shape = snapshot.shape || {};
  return feature.category_name
    || feature.category_key
    || feature.merchant_name
    || feature.merchant_key
    || shape.driver
    || 'the month view';
}

function changeDriverName(change = {}) {
  return driverName(change.item || change.latest || change.previous || {});
}

function stateResponse({
  state,
  tone = 'neutral',
  title,
  body,
  metric = null,
  cta = null,
  source = null,
}) {
  return {
    state,
    tone,
    title,
    body,
    metric,
    cta,
    source,
  };
}

function responseForPortfolioChange(change = {}) {
  if (!change?.type) return null;
  const name = changeDriverName(change);

  if (change.type === 'new_insight') {
    const delta = num(change.item?.projected_delta ?? change.item?.projected_value);
    return stateResponse({
      state: 'new_insight_detected',
      tone: delta > 0 ? 'warning' : 'info',
      title: `${name} moved into focus`,
      body: delta != null
        ? `${formatSignedCurrency(delta)} versus the usual month-end pace.`
        : 'A new driver moved into the current month.',
      metric: delta != null ? { label: 'Change', value: delta, display: formatSignedCurrency(delta) } : null,
      cta: { label: 'Review insight', target: 'insights' },
      source: 'insights',
    });
  }

  if (change.type === 'resolved_insight') {
    return stateResponse({
      state: 'insight_resolved',
      tone: 'positive',
      title: `${name} fell out of focus`,
      body: 'That driver no longer looks material in the current month view.',
      cta: { label: 'See current cards', target: 'insights' },
      source: 'insights',
    });
  }

  if (change.type === 'top_driver_changed') {
    return stateResponse({
      state: 'top_driver_changed',
      tone: 'info',
      title: `${name} is now the top driver`,
      body: 'The leading signal changed even though the overall month view stayed close.',
      cta: { label: 'Review drivers', target: 'insights' },
      source: 'insights',
    });
  }

  return null;
}

function chooseForecastMovementState({
  latest = null,
  previous = null,
  pending = {},
  importSummary = {},
  refreshEvent = null,
  portfolioChange = null,
  hasSnapshots = false,
} = {}) {
  const pendingCount = Number(pending.count || 0);
  const pendingTotal = Number(pending.total_amount || 0);
  const latestDelta = num(latest?.projected_delta);
  const previousDelta = num(previous?.projected_delta);
  const latestValue = num(latest?.projected_value);
  const previousValue = num(previous?.projected_value);
  const movement = movementMagnitude(latestDelta ?? latestValue, previousDelta ?? previousValue);
  const comparisonBase = previousDelta ?? previousValue ?? 0;
  const material = movement != null && isMaterialMovement(movement, comparisonBase);

  if (!hasSnapshots && !latest) {
    return stateResponse({
      state: 'first_run',
      tone: 'neutral',
      title: 'Forecast is still learning',
      body: 'A few more confirmed expenses will make this area show what changed.',
      cta: { label: 'Add signal', target: 'add' },
      source: 'fallback',
    });
  }

  if (latestDelta != null && previousDelta != null && Math.sign(latestDelta) !== Math.sign(previousDelta)) {
    return stateResponse({
      state: 'budget_boundary_crossed',
      tone: latestDelta > 0 ? 'warning' : 'positive',
      title: latestDelta > 0 ? 'Month crossed above budget' : 'Month moved back under budget',
      body: `Projection is now ${formatSignedCurrency(latestDelta)} ${latestDelta > 0 ? 'over' : 'under'} its baseline.`,
      metric: {
        label: 'Projection shift',
        previous_value: previousDelta,
        current_value: latestDelta,
        display: `${formatSignedCurrency(previousDelta)} -> ${formatSignedCurrency(latestDelta)}`,
      },
      cta: { label: 'Review pace', target: 'insights' },
      source: 'forecast',
    });
  }

  if (pendingCount > 0 && pendingTotal >= PENDING_AMOUNT_THRESHOLD) {
    return stateResponse({
      state: 'pending_review_affecting_forecast',
      tone: 'attention',
      title: `${pendingCount} receipt${pendingCount === 1 ? '' : 's'} need review`,
      body: `About ${formatCurrency(pendingTotal)} is waiting before the month view fully settles.`,
      metric: { label: 'Pending total', value: pendingTotal, display: formatCurrency(pendingTotal) },
      cta: { label: 'Clear actions', target: 'actions' },
      source: 'pending',
    });
  }

  if (material) {
    const movedUp = movement > 0;
    const name = driverName(latest);
    return stateResponse({
      state: movedUp ? 'forecast_moved_up' : 'forecast_moved_down',
      tone: movedUp ? 'warning' : 'positive',
      title: `Projection ${movedUp ? 'rose' : 'eased'} ${formatCurrency(movement)}`,
      body: `${name} is the clearest driver of the change.`,
      metric: {
        label: 'Movement',
        value: movement,
        previous_value: previousDelta ?? previousValue,
        current_value: latestDelta ?? latestValue,
        display: `${movedUp ? '+' : '-'}${formatCurrency(movement)}`,
      },
      cta: { label: 'Review drivers', target: 'insights' },
      source: 'forecast',
    });
  }

  const latestConfidence = confidenceRank(latest?.confidence_label);
  const previousConfidence = confidenceRank(previous?.confidence_label);
  if (latest && previous && latestConfidence > previousConfidence) {
    return stateResponse({
      state: 'confidence_improved',
      tone: 'info',
      title: 'Forecast confidence improved',
      body: 'More confirmed activity made the current shape easier to read.',
      cta: { label: 'See forecast', target: 'insights' },
      source: 'forecast',
    });
  }
  if (latest && previous && latestConfidence < previousConfidence) {
    return stateResponse({
      state: 'confidence_weakened',
      tone: 'attention',
      title: 'Forecast is less certain',
      body: 'Recent activity is making the month harder to read cleanly.',
      cta: { label: 'Check evidence', target: 'insights' },
      source: 'forecast',
    });
  }

  const portfolioResponse = responseForPortfolioChange(portfolioChange);
  if (portfolioResponse) return portfolioResponse;

  if (Number(importSummary.imported || 0) > 0 || importSummary.last_imported_at || importSummary.last_synced_at) {
    return stateResponse({
      state: 'import_synced_no_material_change',
      tone: 'neutral',
      title: 'Imports synced',
      body: 'No meaningful change to the month view after the latest sync.',
      cta: { label: 'View import log', target: 'gmail' },
      source: 'import',
    });
  }

  if (refreshEvent?.reason === 'budget_total_updated' || refreshEvent?.reason === 'budget_category_updated') {
    return stateResponse({
      state: 'budget_changed',
      tone: 'info',
      title: 'Budget changed',
      body: 'The month-end gap was recalculated against the latest budget.',
      cta: { label: 'Review budget', target: 'settings' },
      source: 'refresh',
    });
  }

  return stateResponse({
    state: 'quiet_stable',
    tone: 'neutral',
    title: 'Month view is steady',
    body: 'No meaningful forecast movement since the last update.',
    source: 'forecast',
  });
}

function isMissingMovementTable(err) {
  return err?.code === '42P01'
    || /insight_forecast_snapshots|projection_refresh_events|insight_forecasts/i.test(`${err?.message || ''}`);
}

async function getSnapshotPair(userId, { scope = 'personal', period = null } = {}) {
  const params = [userId];
  const filters = ['user_id = $1'];
  if (scope) {
    params.push(scope);
    filters.push(`scope = $${params.length}`);
  }
  if (period) {
    params.push(period);
    filters.push(`period = $${params.length}`);
  }

  const result = await db.query(
    `WITH ranked AS (
       SELECT *,
         ROW_NUMBER() OVER (
           PARTITION BY insight_id
           ORDER BY created_at DESC
         ) AS rn
       FROM insight_forecast_snapshots
       WHERE ${filters.join(' AND ')}
     )
     SELECT
       current.*,
       previous.projected_value AS previous_projected_value,
       previous.projected_delta AS previous_projected_delta,
       previous.confidence_label AS previous_confidence_label,
       previous.created_at AS previous_created_at,
       previous.feature_snapshot AS previous_feature_snapshot,
       previous.shape AS previous_shape
     FROM ranked current
     LEFT JOIN ranked previous
       ON previous.insight_id = current.insight_id
      AND previous.rn = 2
     WHERE current.rn = 1
     ORDER BY
       ABS(COALESCE(current.projected_delta, current.projected_value, 0) - COALESCE(previous.projected_delta, previous.projected_value, 0)) DESC,
       current.created_at DESC
     LIMIT 1`,
    params
  );

  const row = result.rows[0] || null;
  if (!row) return { latest: null, previous: null, hasSnapshots: false };
  return {
    latest: row,
    previous: row.previous_created_at ? {
      projected_value: row.previous_projected_value,
      projected_delta: row.previous_projected_delta,
      confidence_label: row.previous_confidence_label,
      created_at: row.previous_created_at,
      feature_snapshot: row.previous_feature_snapshot || {},
      shape: row.previous_shape || {},
    } : null,
    hasSnapshots: true,
  };
}

function movementValue(snapshot = {}) {
  return num(snapshot.projected_delta ?? snapshot.projected_value) ?? 0;
}

function snapshotKey(snapshot = {}) {
  const entityKey = [
    snapshot.forecast_type,
    snapshot.entity_type,
    snapshot.entity_id,
  ].filter(Boolean).join(':');
  return entityKey || snapshot.insight_id || '';
}

function isMaterialSnapshot(snapshot = {}) {
  return Math.abs(movementValue(snapshot)) >= MATERIAL_DELTA;
}

function sortByMagnitudeDesc(a, b) {
  return Math.abs(movementValue(b)) - Math.abs(movementValue(a));
}

function topMaterialSnapshot(items = []) {
  return [...items].filter(isMaterialSnapshot).sort(sortByMagnitudeDesc)[0] || null;
}

function choosePortfolioChange({ latest = [], previous = [] } = {}) {
  if (!latest.length || !previous.length) return null;
  const previousByKey = new Map(previous.map((item) => [snapshotKey(item), item]).filter(([key]) => key));
  const latestByKey = new Map(latest.map((item) => [snapshotKey(item), item]).filter(([key]) => key));
  const newItems = latest.filter((item) => !previousByKey.has(snapshotKey(item)) && isMaterialSnapshot(item));
  const resolvedItems = previous.filter((item) => !latestByKey.has(snapshotKey(item)) && isMaterialSnapshot(item));
  const latestTop = topMaterialSnapshot(latest);
  const previousTop = topMaterialSnapshot(previous);

  if (newItems.length) {
    return { type: 'new_insight', item: newItems.sort(sortByMagnitudeDesc)[0] };
  }
  if (resolvedItems.length) {
    return { type: 'resolved_insight', item: resolvedItems.sort(sortByMagnitudeDesc)[0] };
  }
  if (latestTop && previousTop && snapshotKey(latestTop) !== snapshotKey(previousTop)) {
    return { type: 'top_driver_changed', item: latestTop, previous: previousTop };
  }
  return null;
}

async function getRecentRefreshWindows(userId, { scope = 'personal', period = null } = {}) {
  const params = [userId];
  const filters = [`user_id = $1`, `status = 'completed'`, `snapshot_count > 0`];
  if (scope) {
    params.push(scope);
    filters.push(`scope = $${params.length}`);
  }
  if (period) {
    params.push(period);
    filters.push(`period = $${params.length}`);
  }
  const result = await db.query(
    `SELECT id, reason, scope, period, created_at, completed_at
     FROM projection_refresh_events
     WHERE ${filters.join(' AND ')}
     ORDER BY completed_at DESC NULLS LAST, created_at DESC
     LIMIT 2`,
    params
  );
  return result.rows || [];
}

async function getSnapshotsForRefreshWindow(userId, refreshWindow) {
  if (!refreshWindow?.created_at) return [];
  const result = await db.query(
    `SELECT insight_id, forecast_type, scope, period, entity_type, entity_id,
            projected_value, projected_delta, confidence_label, feature_snapshot, shape, created_at
     FROM insight_forecast_snapshots
     WHERE user_id = $1
       AND created_at >= $2
       AND created_at <= COALESCE($3, $2 + INTERVAL '5 minutes') + INTERVAL '5 seconds'
       AND ($4::text IS NULL OR scope = $4)
       AND ($5::text IS NULL OR period = $5)
     ORDER BY created_at DESC`,
    [
      userId,
      refreshWindow.created_at,
      refreshWindow.completed_at,
      refreshWindow.scope || null,
      refreshWindow.period || null,
    ]
  );
  return result.rows || [];
}

async function getPortfolioChange(userId, { scope = 'personal', period = null } = {}) {
  const windows = await getRecentRefreshWindows(userId, { scope, period });
  if (windows.length < 2) return null;
  const [latest, previous] = await Promise.all([
    getSnapshotsForRefreshWindow(userId, windows[0]),
    getSnapshotsForRefreshWindow(userId, windows[1]),
  ]);
  return choosePortfolioChange({ latest, previous });
}

async function getPendingSummary(user, scope = 'personal') {
  const params = [];
  const filters = [`status = 'pending'`];
  if (scope === 'household' && user.household_id) {
    params.push(user.household_id);
    filters.push(`household_id = $${params.length}`);
    filters.push(`COALESCE(is_private, FALSE) = FALSE`);
  } else {
    params.push(user.id);
    filters.push(`user_id = $${params.length}`);
  }
  const result = await db.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::numeric AS total_amount
     FROM expenses
     WHERE ${filters.join(' AND ')}`,
    params
  );
  return {
    count: Number(result.rows[0]?.count || 0),
    total_amount: Number(result.rows[0]?.total_amount || 0),
  };
}

async function getLatestRefreshEvent(userId, { scope = 'personal', period = null } = {}) {
  const params = [userId];
  const filters = ['user_id = $1'];
  if (scope) {
    params.push(scope);
    filters.push(`scope = $${params.length}`);
  }
  if (period) {
    params.push(period);
    filters.push(`period = $${params.length}`);
  }
  const result = await db.query(
    `SELECT reason, scope, period, forecast_count, snapshot_count, created_at, completed_at
     FROM projection_refresh_events
     WHERE ${filters.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 1`,
    params
  );
  return result.rows[0] || null;
}

async function buildForecastMovementSummary({ user, scope = 'personal', period = null } = {}) {
  if (!user?.id) return chooseForecastMovementState({});
  const effectiveScope = scope === 'household' && user.household_id ? 'household' : 'personal';

  try {
    const [snapshots, pending, importSummary, refreshEvent, portfolioChange] = await Promise.all([
      getSnapshotPair(user.id, { scope: effectiveScope, period }),
      getPendingSummary(user, effectiveScope),
      EmailImportLog.summarizeByUser(user.id, 7).catch(() => ({})),
      getLatestRefreshEvent(user.id, { scope: effectiveScope, period }),
      getPortfolioChange(user.id, { scope: effectiveScope, period }).catch(() => null),
    ]);

    return {
      scope: effectiveScope,
      period,
      generated_at: new Date().toISOString(),
      ...chooseForecastMovementState({
        latest: snapshots.latest,
        previous: snapshots.previous,
        pending,
        importSummary,
        refreshEvent,
        portfolioChange,
        hasSnapshots: snapshots.hasSnapshots,
      }),
    };
  } catch (err) {
    if (!isMissingMovementTable(err)) throw err;
    return {
      scope: effectiveScope,
      period,
      generated_at: new Date().toISOString(),
      ...chooseForecastMovementState({ hasSnapshots: false }),
    };
  }
}

module.exports = {
  buildForecastMovementSummary,
  choosePortfolioChange,
  chooseForecastMovementState,
  formatCurrency,
  formatSignedCurrency,
};
