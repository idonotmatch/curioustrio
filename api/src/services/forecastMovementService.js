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

function chooseForecastMovementState({
  latest = null,
  previous = null,
  pending = {},
  importSummary = {},
  refreshEvent = null,
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
    const [snapshots, pending, importSummary, refreshEvent] = await Promise.all([
      getSnapshotPair(user.id, { scope: effectiveScope, period }),
      getPendingSummary(user, effectiveScope),
      EmailImportLog.summarizeByUser(user.id, 7).catch(() => ({})),
      getLatestRefreshEvent(user.id, { scope: effectiveScope, period }),
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
  chooseForecastMovementState,
  formatCurrency,
  formatSignedCurrency,
};
