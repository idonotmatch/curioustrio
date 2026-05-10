const db = require('../db');

const MODEL_NAME = 'insight_projection_calibrator';
const MODEL_VERSION = 'v1_rules_calibrated';

function num(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = num(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundMoney(value) {
  const parsed = num(value);
  if (parsed == null) return null;
  return Math.round(parsed * 100) / 100;
}

function confidenceScore(metadata = {}) {
  let score = 0.42;
  const history = Number(metadata.historical_period_count || 0);
  const activeDays = Number(metadata.active_day_count || 0);
  const expenseCount = Number(metadata.expense_count || 0);
  const categoryTrust = num(metadata.category_trust_score);
  const label = `${metadata.confidence || metadata.maturity || ''}`;

  score += Math.min(history, 6) * 0.055;
  score += Math.min(activeDays, 10) * 0.012;
  score += Math.min(expenseCount, 12) * 0.008;
  if (categoryTrust != null) score += (categoryTrust - 0.5) * 0.16;
  if (label === 'comparative' || label === 'mature') score += 0.08;
  if (label === 'directional' || label === 'early') score -= 0.07;
  if (num(metadata.unusual_spend_share) >= 0.35) score -= 0.05;

  return clamp(score, 0.18, 0.92);
}

function confidenceLabel(score) {
  if (score >= 0.74) return 'calibrated';
  if (score >= 0.52) return 'directional';
  return 'early';
}

function forecastTypeForInsight(type = '', metadata = {}) {
  if (type.includes('budget') || type.includes('month_end') || metadata.projected_budget_delta != null) return 'month_end_budget';
  if (type.includes('category') || metadata.category_key) return 'category_month_end';
  if (type.includes('one_off')) return 'one_off_adjusted_month_end';
  if (type.includes('recurring') || type.includes('item_') || type.includes('repurchase')) return 'recurrence_timing';
  return 'general_projection';
}

function shapeForInsight(type = '', metadata = {}, projectedDelta = null) {
  const deltaPercent = firstNumber(metadata.delta_percent);
  const oneOffShare = firstNumber(metadata.unusual_spend_share);
  let observed = 'steady';
  if (deltaPercent >= 10 || projectedDelta > 0) observed = 'rising';
  if (deltaPercent <= -10 || projectedDelta < 0) observed = 'falling';
  if (oneOffShare >= 0.35 || type.includes('one_off')) observed = 'spike';

  return {
    observed,
    expected: projectedDelta == null
      ? 'unknown'
      : projectedDelta > 0
        ? 'above_baseline'
        : projectedDelta < 0
          ? 'below_baseline'
          : 'near_baseline',
    driver: metadata.category_key
      ? 'category_shift'
      : metadata.merchant_key || metadata.merchant_name
        ? 'merchant_pattern'
        : metadata.group_key
          ? 'item_rhythm'
          : type.includes('one_off')
            ? 'one_off'
            : 'overall_pace',
    volatility: oneOffShare >= 0.35 ? 'high' : confidenceScore(metadata) >= 0.7 ? 'low' : 'medium',
    one_off_adjusted: Boolean(metadata.adjusted_projected_total && metadata.baseline_projected_total),
  };
}

function deriveProjectedValue(metadata = {}) {
  return firstNumber(
    metadata.adjusted_projected_total,
    metadata.projected_month_end,
    metadata.projected_spend,
    metadata.projected_total,
    metadata.current_spend_to_date,
    metadata.current_spend
  );
}

function deriveBaselineValue(metadata = {}) {
  return firstNumber(
    metadata.budget_amount,
    metadata.historical_average_total,
    metadata.average_actual_spend_last_6,
    metadata.previous_spend,
    metadata.baseline_projected_total
  );
}

function buildFeatureSnapshot(insight = {}) {
  const metadata = insight.metadata || {};
  return {
    type: insight.type,
    scope: metadata.scope || null,
    month: metadata.month || null,
    historical_period_count: num(metadata.historical_period_count),
    active_day_count: num(metadata.active_day_count),
    expense_count: num(metadata.expense_count),
    category_trust_score: num(metadata.category_trust_score),
    current_spend_to_date: num(metadata.current_spend_to_date),
    current_spend: num(metadata.current_spend),
    previous_spend: num(metadata.previous_spend),
    projected_budget_delta: num(metadata.projected_budget_delta),
    projected_headroom_amount: num(metadata.projected_headroom_amount),
    delta_amount: num(metadata.delta_amount),
    delta_percent: num(metadata.delta_percent),
    unusual_spend_share: num(metadata.unusual_spend_share),
  };
}

function buildInsightForecast(insight = {}, calibration = null) {
  const metadata = insight.metadata || {};
  const type = `${insight.type || ''}`;
  const forecastType = forecastTypeForInsight(type, metadata);
  const observedValue = firstNumber(metadata.current_spend_to_date, metadata.current_spend, metadata.unusual_spend_to_date);
  let projectedValue = deriveProjectedValue(metadata);
  const baselineValue = deriveBaselineValue(metadata);
  let projectedDelta = firstNumber(
    metadata.projected_budget_delta,
    metadata.projected_over_under,
    metadata.projected_headroom_amount != null ? -Math.abs(Number(metadata.projected_headroom_amount)) : null,
    metadata.delta_amount
  );

  if (projectedValue == null && baselineValue != null && projectedDelta != null) {
    projectedValue = baselineValue + projectedDelta;
  }
  if (projectedDelta == null && projectedValue != null && baselineValue != null) {
    projectedDelta = projectedValue - baselineValue;
  }

  const daysUntilDue = firstNumber(metadata.days_until_due);
  if (forecastType === 'recurrence_timing' && projectedValue == null && daysUntilDue != null) {
    projectedValue = daysUntilDue;
    projectedDelta = daysUntilDue;
  }

  if (projectedValue == null && projectedDelta == null) return null;

  const biasAmount = num(calibration?.bias_amount) || 0;
  if (projectedValue != null && biasAmount) projectedValue += biasAmount;
  if (projectedDelta != null && biasAmount && forecastType !== 'recurrence_timing') projectedDelta += biasAmount;

  const score = confidenceScore(metadata);
  const uncertainty = Math.max(
    8,
    Math.abs(projectedDelta || 0) * (1 - score),
    Math.abs(projectedValue || 0) * (0.06 + ((1 - score) * 0.12))
  );

  return {
    forecast_type: forecastType,
    model_name: MODEL_NAME,
    model_version: MODEL_VERSION,
    scope: metadata.scope || null,
    period: metadata.month || null,
    entity_type: insight.entity_type || null,
    entity_id: insight.entity_id || null,
    observed_value: roundMoney(observedValue),
    projected_value: roundMoney(projectedValue),
    projected_delta: roundMoney(projectedDelta),
    baseline_value: roundMoney(baselineValue),
    uncertainty_low: projectedValue == null ? null : roundMoney(projectedValue - uncertainty),
    uncertainty_high: projectedValue == null ? null : roundMoney(projectedValue + uncertainty),
    confidence_score: Math.round(score * 10000) / 10000,
    confidence_label: confidenceLabel(score),
    feature_snapshot: buildFeatureSnapshot(insight),
    shape: shapeForInsight(type, metadata, projectedDelta),
    valid_until: insight.expires_at || null,
  };
}

function isMissingForecastTable(err) {
  return err?.code === '42P01' || /insight_forecasts|insight_forecast_snapshots|forecast_model_calibration/i.test(`${err?.message || ''}`);
}

async function getCalibrationMap(userId, insights = []) {
  if (!userId || !insights.length) return new Map();
  try {
    const types = Array.from(new Set(insights.map((insight) => forecastTypeForInsight(insight.type, insight.metadata || {}))));
    const result = await db.query(
      `SELECT forecast_type, entity_type, entity_id, bias_amount, mean_absolute_error, direction_accuracy
       FROM forecast_model_calibration
       WHERE user_id = $1
         AND model_name = $2
         AND model_version = $3
         AND forecast_type = ANY($4::text[])`,
      [userId, MODEL_NAME, MODEL_VERSION, types]
    );
    return new Map(result.rows.map((row) => [`${row.forecast_type}:${row.entity_type || ''}:${row.entity_id || ''}`, row]));
  } catch (err) {
    if (isMissingForecastTable(err)) return new Map();
    throw err;
  }
}

async function persistForecasts(userId, forecasts = []) {
  return persistForecastsWithOptions(userId, forecasts);
}

async function persistForecastsWithOptions(userId, forecasts = [], options = {}) {
  if (!userId || !forecasts.length) return [];
  const rows = forecasts.filter((item) => item?.insight_id && item?.forecast);
  if (!rows.length) return [];

  try {
    const saved = [];
    const sourceEvent = options.sourceEvent && typeof options.sourceEvent === 'object'
      ? options.sourceEvent
      : null;
    for (const item of rows) {
      const forecast = item.forecast;
      const result = await db.query(
        `INSERT INTO insight_forecasts (
          user_id, insight_id, forecast_type, scope, period, entity_type, entity_id,
          observed_value, projected_value, projected_delta, baseline_value,
          uncertainty_low, uncertainty_high, confidence_score, confidence_label,
          model_name, model_version, feature_snapshot, shape, valid_until
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11,
          $12, $13, $14, $15,
          $16, $17, $18, $19, $20
        )
        ON CONFLICT (user_id, insight_id, model_version)
        DO UPDATE SET
          forecast_type = EXCLUDED.forecast_type,
          scope = EXCLUDED.scope,
          period = EXCLUDED.period,
          entity_type = EXCLUDED.entity_type,
          entity_id = EXCLUDED.entity_id,
          observed_value = EXCLUDED.observed_value,
          projected_value = EXCLUDED.projected_value,
          projected_delta = EXCLUDED.projected_delta,
          baseline_value = EXCLUDED.baseline_value,
          uncertainty_low = EXCLUDED.uncertainty_low,
          uncertainty_high = EXCLUDED.uncertainty_high,
          confidence_score = EXCLUDED.confidence_score,
          confidence_label = EXCLUDED.confidence_label,
          feature_snapshot = EXCLUDED.feature_snapshot,
          shape = EXCLUDED.shape,
          valid_until = EXCLUDED.valid_until,
          updated_at = NOW()
        RETURNING id`,
        [
          userId,
          item.insight_id,
          forecast.forecast_type,
          forecast.scope,
          forecast.period,
          forecast.entity_type,
          forecast.entity_id,
          forecast.observed_value,
          forecast.projected_value,
          forecast.projected_delta,
          forecast.baseline_value,
          forecast.uncertainty_low,
          forecast.uncertainty_high,
          forecast.confidence_score,
          forecast.confidence_label,
          forecast.model_name,
          forecast.model_version,
          forecast.feature_snapshot,
          forecast.shape,
          forecast.valid_until,
        ]
      );
      const savedForecast = result.rows[0];
      saved.push(savedForecast);
      if (options.persistSnapshots) {
        try {
          await persistForecastSnapshot({
            userId,
            insightId: item.insight_id,
            forecastId: savedForecast.id,
            forecast,
            sourceEvent,
          });
        } catch (snapshotErr) {
          if (!isMissingForecastTable(snapshotErr)) throw snapshotErr;
        }
      }
    }
    return saved;
  } catch (err) {
    if (isMissingForecastTable(err)) return [];
    throw err;
  }
}

async function persistForecastSnapshot({
  userId,
  insightId,
  forecastId = null,
  forecast = {},
  sourceEvent = null,
}) {
  const source = sourceEvent && typeof sourceEvent === 'object' ? sourceEvent : {};
  const result = await db.query(
    `INSERT INTO insight_forecast_snapshots (
      user_id, forecast_id, insight_id, forecast_type, scope, period, entity_type, entity_id,
      observed_value, projected_value, projected_delta, baseline_value,
      confidence_score, confidence_label, feature_snapshot, shape, source_event
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12,
      $13, $14, $15, $16, $17
    )
    RETURNING id`,
    [
      userId,
      forecastId,
      insightId,
      forecast.forecast_type,
      forecast.scope,
      forecast.period,
      forecast.entity_type,
      forecast.entity_id,
      forecast.observed_value,
      forecast.projected_value,
      forecast.projected_delta,
      forecast.baseline_value,
      forecast.confidence_score,
      forecast.confidence_label,
      forecast.feature_snapshot || {},
      forecast.shape || {},
      source,
    ]
  );
  return result.rows[0] || null;
}

async function attachInsightForecasts(userId, insights = [], options = {}) {
  if (!Array.isArray(insights) || !insights.length) return insights;
  const calibrationMap = await getCalibrationMap(userId, insights);
  const forecastsToPersist = [];
  const withForecasts = insights.map((insight) => {
    const forecastType = forecastTypeForInsight(insight.type, insight.metadata || {});
    const calibration = calibrationMap.get(`${forecastType}:${insight.entity_type || ''}:${insight.entity_id || ''}`)
      || calibrationMap.get(`${forecastType}::`)
      || null;
    const forecast = buildInsightForecast(insight, calibration);
    if (!forecast) return insight;
    forecastsToPersist.push({ insight_id: insight.id, forecast });
    return { ...insight, forecast };
  });
  await persistForecastsWithOptions(userId, forecastsToPersist, options);
  return withForecasts;
}

function evaluateForecastOutcome(forecast = {}, actualValue) {
  const actual = num(actualValue);
  if (actual == null || forecast.projected_value == null) return null;
  const projected = Number(forecast.projected_value);
  const baseline = num(forecast.baseline_value);
  const actualDelta = baseline == null ? null : actual - baseline;
  const error = actual - projected;
  const absoluteError = Math.abs(error);
  const percentError = actual === 0 ? null : absoluteError / Math.abs(actual);
  const directionCorrect = baseline == null || forecast.projected_delta == null || actualDelta == null
    ? null
    : Math.sign(Number(forecast.projected_delta)) === Math.sign(actualDelta);
  return {
    actual_value: roundMoney(actual),
    actual_delta: roundMoney(actualDelta),
    absolute_error: roundMoney(absoluteError),
    percent_error: percentError == null ? null : Math.round(percentError * 10000) / 10000,
    direction_correct: directionCorrect,
    outcome_label: percentError != null && percentError <= 0.12
      ? 'accurate'
      : directionCorrect === true
        ? 'directionally_right'
        : 'missed',
  };
}

function isPeriodClosed(period, now = new Date()) {
  if (!/^\d{4}-\d{2}$/.test(`${period || ''}`)) return false;
  const [year, month] = `${period}`.split('-').map(Number);
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const forecastPeriod = `${year}-${String(month).padStart(2, '0')}`;
  return forecastPeriod < currentPeriod;
}

function monthBounds(period) {
  const [year, month] = `${period}`.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const format = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  return { from: format(start), to: format(end) };
}

async function getActualValueForForecast(user, forecast) {
  if (!user?.id || !forecast?.period) return null;
  const { from, to } = monthBounds(forecast.period);
  const params = [from, to];
  const filters = [
    `e.status = 'confirmed'`,
    `COALESCE(e.exclude_from_budget, FALSE) = FALSE`,
    `e.date >= $1`,
    `e.date < $2`,
  ];

  if (forecast.scope === 'household' && user.household_id) {
    params.push(user.household_id);
    filters.push(`e.household_id = $${params.length}`);
    filters.push(`COALESCE(e.is_private, FALSE) = FALSE`);
  } else {
    params.push(user.id);
    filters.push(`e.user_id = $${params.length}`);
  }

  if (forecast.forecast_type === 'category_month_end') {
    const categoryId = forecast.entity_id || forecast.feature_snapshot?.category_id || null;
    const categoryKey = forecast.feature_snapshot?.category_key || null;
    if (categoryId && /^[0-9a-f-]{36}$/i.test(`${categoryId}`)) {
      params.push(categoryId);
      filters.push(`e.category_id = $${params.length}`);
    } else if (categoryKey) {
      params.push(categoryKey);
      filters.push(`LOWER(COALESCE(e.category_name, 'uncategorized')) = LOWER($${params.length})`);
    }
  }

  const result = await db.query(
    `SELECT COALESCE(SUM(e.amount), 0)::numeric AS actual_value
     FROM expenses e
     WHERE ${filters.join(' AND ')}`,
    params
  );
  return Number(result.rows[0]?.actual_value || 0);
}

async function refreshForecastCalibration(userId) {
  if (!userId) return { updated: 0 };
  const result = await db.query(
    `WITH grouped AS (
       SELECT
         f.user_id,
         f.model_name,
         f.model_version,
         f.forecast_type,
         f.entity_type,
         f.entity_id,
         COUNT(*)::integer AS sample_count,
         AVG(o.absolute_error)::numeric(12,2) AS mean_absolute_error,
         AVG(o.percent_error)::numeric(8,4) AS mean_percent_error,
         AVG((o.actual_value - f.projected_value))::numeric(12,2) AS bias_amount,
         AVG(CASE WHEN o.direction_correct IS NULL THEN NULL WHEN o.direction_correct THEN 1 ELSE 0 END)::numeric(5,4) AS direction_accuracy
       FROM insight_forecast_outcomes o
       JOIN insight_forecasts f ON f.id = o.forecast_id
       WHERE f.user_id = $1
       GROUP BY f.user_id, f.model_name, f.model_version, f.forecast_type, f.entity_type, f.entity_id
     )
     INSERT INTO forecast_model_calibration (
       user_id, model_name, model_version, forecast_type, entity_type, entity_id,
       sample_count, mean_absolute_error, mean_percent_error, bias_amount, direction_accuracy, updated_at
     )
     SELECT
       user_id, model_name, model_version, forecast_type, entity_type, entity_id,
       sample_count, mean_absolute_error, mean_percent_error, bias_amount, direction_accuracy, NOW()
     FROM grouped
     ON CONFLICT (
       user_id,
       model_name,
       model_version,
       forecast_type,
       (COALESCE(entity_type, '')),
       (COALESCE(entity_id, ''))
     )
     DO UPDATE SET
       sample_count = EXCLUDED.sample_count,
       mean_absolute_error = EXCLUDED.mean_absolute_error,
       mean_percent_error = EXCLUDED.mean_percent_error,
       bias_amount = EXCLUDED.bias_amount,
       direction_accuracy = EXCLUDED.direction_accuracy,
       updated_at = NOW()
     RETURNING id`
    , [userId]
  );
  return { updated: result.rowCount || 0 };
}

async function evaluateDueForecastOutcomes(user, { now = new Date(), limit = 100 } = {}) {
  if (!user?.id) return { evaluated: 0, calibrated: 0 };
  const result = await db.query(
    `SELECT f.*
     FROM insight_forecasts f
     LEFT JOIN insight_forecast_outcomes o ON o.forecast_id = f.id
     WHERE f.user_id = $1
       AND o.id IS NULL
       AND f.projected_value IS NOT NULL
       AND f.period IS NOT NULL
     ORDER BY f.updated_at ASC
     LIMIT $2`,
    [user.id, Math.max(1, Math.min(Number(limit) || 100, 500))]
  );

  let evaluated = 0;
  for (const forecast of result.rows) {
    if (!isPeriodClosed(forecast.period, now)) continue;
    const actualValue = await getActualValueForForecast(user, forecast);
    const outcome = evaluateForecastOutcome(forecast, actualValue);
    if (!outcome) continue;
    await db.query(
      `INSERT INTO insight_forecast_outcomes (
        forecast_id, actual_value, actual_delta, absolute_error, percent_error, direction_correct, outcome_label
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (forecast_id) DO NOTHING`,
      [
        forecast.id,
        outcome.actual_value,
        outcome.actual_delta,
        outcome.absolute_error,
        outcome.percent_error,
        outcome.direction_correct,
        outcome.outcome_label,
      ]
    );
    evaluated += 1;
  }

  const calibration = evaluated ? await refreshForecastCalibration(user.id) : { updated: 0 };
  return { evaluated, calibrated: calibration.updated || 0 };
}

module.exports = {
  MODEL_NAME,
  MODEL_VERSION,
  attachInsightForecasts,
  buildInsightForecast,
  evaluateForecastOutcome,
  evaluateDueForecastOutcomes,
  forecastTypeForInsight,
  isPeriodClosed,
  persistForecastSnapshot,
  refreshForecastCalibration,
};
