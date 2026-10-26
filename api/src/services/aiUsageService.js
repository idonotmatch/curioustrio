function periodStart(period, now = new Date()) {
  const date = new Date(now);
  if (period === 'minute') {
    date.setUTCSeconds(0, 0);
  } else if (period === 'day') {
    date.setUTCHours(0, 0, 0, 0);
  } else if (period === 'month') {
    date.setUTCDate(1);
    date.setUTCHours(0, 0, 0, 0);
  } else {
    throw new Error(`Unsupported AI usage period: ${period}`);
  }
  return date.toISOString();
}

function bucketIdentity(spec, now) {
  return {
    scopeType: spec.scopeType,
    scopeId: `${spec.scopeId}`,
    feature: spec.feature,
    metric: spec.metric,
    period: spec.period,
    periodStart: periodStart(spec.period, now),
  };
}

async function reserveBucket(client, spec, now) {
  const amount = Math.max(0, Math.round(Number(spec.amount) || 0));
  const limit = Math.max(0, Math.round(Number(spec.limit) || 0));
  if (amount === 0 || limit === 0) return { skipped: true, amount, limit };
  if (amount > limit) return null;
  const key = bucketIdentity(spec, now);
  const result = await client.query(
    `INSERT INTO ai_usage_buckets (
       scope_type, scope_id, feature, metric, period, period_start, reserved_units
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (scope_type, scope_id, feature, metric, period, period_start)
     DO UPDATE SET
       reserved_units = ai_usage_buckets.reserved_units + EXCLUDED.reserved_units,
       updated_at = NOW()
     WHERE ai_usage_buckets.reserved_units + ai_usage_buckets.used_units + EXCLUDED.reserved_units <= $8
     RETURNING reserved_units, used_units`,
    [
      key.scopeType,
      key.scopeId,
      key.feature,
      key.metric,
      key.period,
      key.periodStart,
      amount,
      limit,
    ]
  );
  const row = result.rows[0];
  return row ? {
    ...key,
    amount,
    limit,
    reservedUnits: Number(row.reserved_units || 0),
    usedUnits: Number(row.used_units || 0),
  } : null;
}

async function appendUsageEvent(client, {
  userId,
  operationId,
  feature,
  eventType,
  metric,
  units,
  metadata = {},
}) {
  await client.query(
    `INSERT INTO ai_usage_events (
       user_id, operation_id, feature, event_type, metric, units, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [userId || null, operationId, feature, eventType, metric, Math.max(0, Math.round(Number(units) || 0)), JSON.stringify(metadata)]
  );
}

async function reserveUsage(client, {
  userId,
  operationId,
  feature,
  buckets,
  metadata = {},
}) {
  const now = new Date();
  const reservations = [];
  for (const spec of buckets) {
    const reservation = await reserveBucket(client, spec, now);
    if (!reservation) {
      const error = new Error(spec.message || 'AI usage capacity reached');
      error.status = spec.status || 429;
      error.reason_code = spec.reasonCode || 'ai_usage_limit_reached';
      error.expose = true;
      error.details = {
        metric: spec.metric,
        period: spec.period,
        limit: spec.limit,
      };
      throw error;
    }
    if (!reservation.skipped) reservations.push(reservation);
  }
  await appendUsageEvent(client, {
    userId,
    operationId,
    feature,
    eventType: 'reserved',
    metric: 'operation',
    units: 1,
    metadata: { ...metadata, buckets: reservations },
  });
  return reservations;
}

async function reconcileBucket(client, reservation, usedAmount) {
  const used = Math.max(0, Math.round(Number(usedAmount) || 0));
  await client.query(
    `UPDATE ai_usage_buckets
        SET reserved_units = GREATEST(0, reserved_units - $7),
            used_units = used_units + $8,
            updated_at = NOW()
      WHERE scope_type = $1 AND scope_id = $2 AND feature = $3
        AND metric = $4 AND period = $5 AND period_start = $6`,
    [
      reservation.scopeType,
      reservation.scopeId,
      reservation.feature,
      reservation.metric,
      reservation.period,
      reservation.periodStart,
      reservation.amount,
      used,
    ]
  );
}

async function reconcileUsage(client, {
  userId,
  operationId,
  feature,
  reservations,
  usageByMetric = {},
  eventType = 'committed',
  metadata = {},
}) {
  for (const reservation of reservations) {
    const used = Object.prototype.hasOwnProperty.call(usageByMetric, reservation.metric)
      ? usageByMetric[reservation.metric]
      : reservation.amount;
    await reconcileBucket(client, reservation, used);
  }
  await appendUsageEvent(client, {
    userId,
    operationId,
    feature,
    eventType,
    metric: 'operation',
    units: 1,
    metadata: { ...metadata, usage: usageByMetric },
  });
}

module.exports = {
  appendUsageEvent,
  bucketIdentity,
  periodStart,
  reconcileUsage,
  reserveUsage,
};
