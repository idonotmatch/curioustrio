const db = require('../db');
const { reconcileUsage, reserveUsage } = require('./aiUsageService');

const FEATURE = 'receipt_scanning';

function integerSetting(name, fallback, { min = 0, max = 10_000_000_000 } = {}) {
  const parsed = Number.parseInt(process.env[name], 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
}

function booleanSetting(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(`${raw}`.trim().toLowerCase());
}

function receiptScanGuardConfig() {
  return {
    enabled: booleanSetting('RECEIPT_SCAN_GUARDS_ENABLED', process.env.NODE_ENV !== 'test'),
    minuteVelocityLimit: integerSetting(
      'RECEIPT_SCAN_MINUTE_VELOCITY_LIMIT',
      integerSetting('RECEIPT_SCAN_BURST_LIMIT', 5, { min: 1 }),
      { min: 1 }
    ),
    monthlyIncluded: integerSetting(
      'RECEIPT_SCAN_MONTHLY_INCLUDED',
      integerSetting('RECEIPT_SCAN_MONTHLY_LIMIT', 150, { min: 1 }),
      { min: 1 }
    ),
    globalDailyLimit: integerSetting('RECEIPT_SCAN_GLOBAL_DAILY_LIMIT', 500, { min: 1 }),
    globalMonthlyLimit: integerSetting('RECEIPT_SCAN_GLOBAL_MONTHLY_LIMIT', 5000, { min: 1 }),
    globalDailyWeightedTokenLimit: integerSetting('RECEIPT_SCAN_GLOBAL_DAILY_WEIGHTED_TOKEN_LIMIT', 10_000_000, { min: 1 }),
    globalMonthlyWeightedTokenLimit: integerSetting('RECEIPT_SCAN_GLOBAL_MONTHLY_WEIGHTED_TOKEN_LIMIT', 100_000_000, { min: 1 }),
    estimatedWeightedTokens: integerSetting('RECEIPT_SCAN_ESTIMATED_WEIGHTED_TOKENS', 50_000, { min: 1 }),
    maxAttemptsPerRequest: integerSetting('RECEIPT_SCAN_MAX_ATTEMPTS_PER_REQUEST', 3, { min: 1, max: 10 }),
    reservationStaleMinutes: integerSetting('RECEIPT_SCAN_RESERVATION_STALE_MINUTES', 5, { min: 1, max: 30 }),
    cacheHours: integerSetting('RECEIPT_SCAN_CACHE_HOURS', 24, { min: 1, max: 72 }),
  };
}

function guardError(status, reasonCode, message, details = {}) {
  return Object.assign(new Error(message), {
    status,
    reason_code: reasonCode,
    expose: true,
    details,
  });
}

async function loadEntitlement(client, userId, config) {
  const result = await client.query(
    `SELECT status, plan_code, monthly_included_units, minute_velocity_limit
       FROM account_feature_entitlements
      WHERE user_id = $1 AND feature = $2
        AND effective_at <= NOW()
        AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 1`,
    [userId, FEATURE]
  );
  const entitlement = result.rows[0] || null;
  if (entitlement?.status === 'paused') {
    throw guardError(403, 'receipt_scan_entitlement_paused', 'Receipt scanning is paused for this account');
  }
  return {
    planCode: entitlement?.plan_code || 'public_default',
    monthlyIncluded: Number(entitlement?.monthly_included_units) || config.monthlyIncluded,
    minuteVelocityLimit: Number(entitlement?.minute_velocity_limit) || config.minuteVelocityLimit,
  };
}

function reservationSpecs(userId, entitlement, config) {
  const shared = { feature: FEATURE, amount: 1 };
  return [
    {
      ...shared,
      scopeType: 'account', scopeId: userId, metric: 'account_velocity', period: 'minute',
      limit: entitlement.minuteVelocityLimit, status: 429,
      reasonCode: 'receipt_scan_velocity_limit', message: 'Too many receipt scans were started at once',
    },
    {
      ...shared,
      scopeType: 'account', scopeId: userId, metric: 'account_requests', period: 'month',
      limit: entitlement.monthlyIncluded, status: 429,
      reasonCode: 'receipt_scan_monthly_limit', message: 'Monthly receipt scan allowance reached',
    },
    {
      ...shared,
      scopeType: 'global', scopeId: 'all', metric: 'global_requests', period: 'day',
      limit: config.globalDailyLimit, status: 503,
      reasonCode: 'receipt_scan_capacity_reached', message: 'Receipt scanning is temporarily at capacity',
    },
    {
      ...shared,
      scopeType: 'global', scopeId: 'all', metric: 'global_requests', period: 'month',
      limit: config.globalMonthlyLimit, status: 503,
      reasonCode: 'receipt_scan_capacity_reached', message: 'Receipt scanning is temporarily at capacity',
    },
    {
      scopeType: 'global', scopeId: 'all', feature: FEATURE, metric: 'weighted_tokens', period: 'day',
      amount: config.estimatedWeightedTokens, limit: config.globalDailyWeightedTokenLimit, status: 503,
      reasonCode: 'receipt_scan_capacity_reached', message: 'Receipt scanning is temporarily at compute capacity',
    },
    {
      scopeType: 'global', scopeId: 'all', feature: FEATURE, metric: 'weighted_tokens', period: 'month',
      amount: config.estimatedWeightedTokens, limit: config.globalMonthlyWeightedTokenLimit, status: 503,
      reasonCode: 'receipt_scan_capacity_reached', message: 'Receipt scanning is temporarily at compute capacity',
    },
  ];
}

function usagePayload(reservations, entitlement, extra = {}) {
  const monthly = reservations.find((item) => (
    item.scopeType === 'account' && item.metric === 'account_requests' && item.period === 'month'
  ));
  const consumed = monthly ? monthly.reservedUnits + monthly.usedUnits : 0;
  return {
    plan_code: entitlement?.planCode || 'public_default',
    remaining_today: null,
    remaining_month: monthly ? Math.max(0, monthly.limit - consumed) : null,
    ...extra,
  };
}

function globalCapacityRatio(reservations = []) {
  return reservations.reduce((ratio, item) => {
    if (item.scopeType !== 'global' || !item.limit) return ratio;
    return Math.max(ratio, (item.reservedUnits + item.usedUnits) / item.limit);
  }, 0);
}

async function loadLatestReservations(client, operationId) {
  const result = await client.query(
    `SELECT metadata->'buckets' AS buckets
       FROM ai_usage_events
      WHERE operation_id = $1 AND feature = $2 AND event_type = 'reserved'
      ORDER BY created_at DESC
      LIMIT 1`,
    [operationId, FEATURE]
  );
  return Array.isArray(result.rows[0]?.buckets) ? result.rows[0].buckets : [];
}

async function reserveExistingRequest(client, existing, userId, endpoint, inputHash, config, entitlement) {
  if (existing.input_hash !== inputHash || existing.endpoint !== endpoint) {
    throw guardError(409, 'scan_request_conflict', 'This scan request ID was already used for different input');
  }
  if (existing.status === 'completed' && existing.response_body && new Date(existing.expires_at) > new Date()) {
    return { kind: 'cached', requestId: existing.id, responseBody: existing.response_body, reservations: [] };
  }
  const fresh = existing.status === 'reserved'
    && new Date(existing.updated_at).getTime() > Date.now() - config.reservationStaleMinutes * 60 * 1000;
  if (fresh) {
    return { kind: 'in_progress', requestId: existing.id, reservations: [] };
  }
  if (Number(existing.attempt_count) >= config.maxAttemptsPerRequest) {
    throw guardError(409, 'receipt_scan_retry_exhausted', 'This receipt scan could not be completed after several attempts');
  }
  const reservations = await reserveUsage(client, {
    userId,
    operationId: existing.id,
    feature: FEATURE,
    buckets: reservationSpecs(userId, entitlement, config),
    metadata: { endpoint, attempt: Number(existing.attempt_count) + 1, plan_code: entitlement.planCode },
  });
  await client.query(
    `UPDATE receipt_scan_requests
        SET status = 'reserved', attempt_count = attempt_count + 1,
            response_body = NULL, error_body = NULL, updated_at = NOW(),
            expires_at = NOW() + ($3::text || ' hours')::interval
      WHERE id = $1 AND user_id = $2`,
    [existing.id, userId, config.cacheHours]
  );
  return { kind: 'reserved', requestId: existing.id, reservations };
}

async function reserveReceiptScan({ userId, requestKey, endpoint, inputHash }) {
  if (!userId) throw guardError(401, 'receipt_scan_user_required', 'A synced user is required to scan receipts');
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(`${requestKey || ''}`)) {
    throw guardError(400, 'invalid_scan_request_id', 'Receipt scan request ID is invalid');
  }
  if (!['image', 'document'].includes(endpoint) || !/^[a-f0-9]{64}$/.test(`${inputHash || ''}`)) {
    throw guardError(400, 'invalid_scan_request', 'Receipt scan request is invalid');
  }

  const config = receiptScanGuardConfig();
  if (!config.enabled) {
    return {
      kind: 'reserved', requestId: null, degraded: false,
      usage: { remaining_today: null, remaining_month: null, cached: false },
    };
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const entitlement = await loadEntitlement(client, userId, config);
    const existingResult = await client.query(
      `SELECT * FROM receipt_scan_requests WHERE user_id = $1 AND request_key = $2 FOR UPDATE`,
      [userId, requestKey]
    );
    const existing = existingResult.rows[0] || null;
    if (existing) {
      const outcome = await reserveExistingRequest(client, existing, userId, endpoint, inputHash, config, entitlement);
      await client.query('COMMIT');
      const ratio = globalCapacityRatio(outcome.reservations);
      return {
        ...outcome,
        degraded: ratio >= 0.9,
        usage: usagePayload(outcome.reservations, entitlement, { cached: outcome.kind === 'cached' }),
      };
    }

    const cachedResult = await client.query(
      `SELECT id, response_body
         FROM receipt_scan_requests
        WHERE user_id = $1 AND input_hash = $2 AND endpoint = $3
          AND status = 'completed' AND response_body IS NOT NULL AND expires_at > NOW()
        ORDER BY completed_at DESC NULLS LAST
        LIMIT 1`,
      [userId, inputHash, endpoint]
    );
    if (cachedResult.rows[0]) {
      await client.query('COMMIT');
      return {
        kind: 'cached',
        requestId: cachedResult.rows[0].id,
        responseBody: cachedResult.rows[0].response_body,
        degraded: false,
        usage: usagePayload([], entitlement, { cached: true }),
      };
    }

    const inserted = await client.query(
      `INSERT INTO receipt_scan_requests (user_id, request_key, endpoint, input_hash, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + ($5::text || ' hours')::interval)
       RETURNING id`,
      [userId, requestKey, endpoint, inputHash, config.cacheHours]
    );
    const requestId = inserted.rows[0].id;
    const reservations = await reserveUsage(client, {
      userId,
      operationId: requestId,
      feature: FEATURE,
      buckets: reservationSpecs(userId, entitlement, config),
      metadata: { endpoint, attempt: 1, plan_code: entitlement.planCode },
    });
    const ratio = globalCapacityRatio(reservations);
    if (ratio >= 0.7) {
      console.warn('[receipt scan] global capacity threshold', { percent: Math.round(ratio * 100) });
    }
    await client.query('COMMIT');
    return {
      kind: 'reserved', requestId, degraded: ratio >= 0.9,
      usage: usagePayload(reservations, entitlement, { cached: false }),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') {
      throw guardError(409, 'receipt_scan_in_progress', 'This receipt scan is already processing');
    }
    throw error;
  } finally {
    client.release();
  }
}

function normalizedModelUsage(usage = {}) {
  return {
    modelCalls: Math.max(0, Number(usage.model_call_count) || 0),
    inputTokens: Math.max(0, Number(usage.model_input_tokens) || 0),
    outputTokens: Math.max(0, Number(usage.model_output_tokens) || 0),
    cacheCreationInputTokens: Math.max(0, Number(usage.model_cache_creation_input_tokens) || 0),
    cacheReadInputTokens: Math.max(0, Number(usage.model_cache_read_input_tokens) || 0),
    modelNames: Array.isArray(usage.model_names) ? usage.model_names.slice(0, 5) : [],
  };
}

async function settleReceiptScan({ requestId, userId, responseBody, errorBody, modelUsage = {}, succeeded }) {
  if (!requestId || !userId) return;
  const usage = normalizedModelUsage(modelUsage);
  const weightedTokens = Math.round(
    usage.inputTokens
    + usage.cacheCreationInputTokens * 1.25
    + usage.cacheReadInputTokens * 0.1
    + usage.outputTokens * 5
  );
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query(
      `SELECT status FROM receipt_scan_requests WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [requestId, userId]
    );
    const current = currentResult.rows[0];
    if (!current || current.status !== 'reserved') {
      await client.query('COMMIT');
      return;
    }
    const reservations = await loadLatestReservations(client, requestId);
    await reconcileUsage(client, {
      userId,
      operationId: requestId,
      feature: FEATURE,
      reservations,
      usageByMetric: {
        account_velocity: 1,
        account_requests: succeeded ? 1 : 0,
        global_requests: usage.modelCalls > 0 ? 1 : 0,
        weighted_tokens: weightedTokens,
      },
      eventType: succeeded ? 'committed' : (usage.modelCalls > 0 ? 'adjusted' : 'released'),
      metadata: {
        succeeded,
        model_call_count: usage.modelCalls,
        model_input_tokens: usage.inputTokens,
        model_output_tokens: usage.outputTokens,
        model_cache_creation_input_tokens: usage.cacheCreationInputTokens,
        model_cache_read_input_tokens: usage.cacheReadInputTokens,
        model_names: usage.modelNames,
      },
    });
    await client.query(
      `UPDATE receipt_scan_requests
          SET status = $3,
              response_body = $4::jsonb,
              error_body = $5::jsonb,
              model_call_count = model_call_count + $6,
              model_input_tokens = model_input_tokens + $7,
              model_output_tokens = model_output_tokens + $8,
              completed_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE completed_at END,
              updated_at = NOW()
        WHERE id = $1 AND user_id = $2`,
      [
        requestId,
        userId,
        succeeded ? 'completed' : 'failed',
        succeeded ? JSON.stringify(responseBody) : null,
        succeeded ? null : JSON.stringify(errorBody),
        usage.modelCalls,
        usage.inputTokens,
        usage.outputTokens,
      ]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function completeReceiptScan(payload) {
  return settleReceiptScan({ ...payload, succeeded: true, errorBody: null });
}

async function failReceiptScan(payload) {
  return settleReceiptScan({ ...payload, succeeded: false, responseBody: null });
}

async function pruneReceiptScanUsage({ metadataDays = 90 } = {}) {
  const safeMetadataDays = Math.max(32, Math.min(Number(metadataDays) || 90, 365));
  const staleInputs = await db.query(
    `SELECT id, storage_bucket, storage_path
       FROM receipt_scan_jobs
      WHERE input_deleted_at IS NULL AND expires_at < NOW()
      ORDER BY expires_at ASC
      LIMIT 100`
  );
  let stagedInputsDeleted = 0;
  if (staleInputs.rows.length) {
    const { deleteReceiptScanInput } = require('./receiptScanStorage');
    for (const input of staleInputs.rows) {
      try {
        await deleteReceiptScanInput({ bucket: input.storage_bucket, path: input.storage_path });
        await db.query(
          `UPDATE receipt_scan_jobs SET input_deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [input.id]
        );
        stagedInputsDeleted += 1;
      } catch (error) {
        console.warn('[receipt scan] retention input cleanup failed', {
          scan_job_id: input.id,
          message: error?.message || 'unknown_error',
        });
      }
    }
  }
  const expired = await db.query(
    `UPDATE receipt_scan_requests
        SET response_body = NULL, error_body = NULL, updated_at = NOW()
      WHERE expires_at < NOW() AND (response_body IS NOT NULL OR error_body IS NOT NULL)`
  );
  const old = await db.query(
    `DELETE FROM receipt_scan_requests AS request
      WHERE request.created_at < NOW() - ($1::text || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM receipt_scan_jobs AS job
          WHERE job.request_id = request.id AND job.input_deleted_at IS NULL
        )`,
    [safeMetadataDays]
  );
  await db.query(`DELETE FROM ai_usage_events WHERE created_at < NOW() - INTERVAL '13 months'`);
  await db.query(`DELETE FROM ai_usage_buckets WHERE period_start < NOW() - INTERVAL '13 months'`);
  return {
    cached_payloads_cleared: Number(expired.rowCount || 0),
    staged_inputs_deleted: stagedInputsDeleted,
    old_usage_rows_deleted: Number(old.rowCount || 0),
    metadata_retention_days: safeMetadataDays,
  };
}

module.exports = {
  completeReceiptScan,
  failReceiptScan,
  pruneReceiptScanUsage,
  receiptScanGuardConfig,
  reserveReceiptScan,
};
