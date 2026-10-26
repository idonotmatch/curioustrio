const db = require('../../src/db');
const {
  completeReceiptScan,
  failReceiptScan,
  reserveReceiptScan,
} = require('../../src/services/receiptScanUsageService');

const ORIGINAL_ENV = {
  enabled: process.env.RECEIPT_SCAN_GUARDS_ENABLED,
  velocity: process.env.RECEIPT_SCAN_MINUTE_VELOCITY_LIMIT,
  monthly: process.env.RECEIPT_SCAN_MONTHLY_INCLUDED,
  globalDaily: process.env.RECEIPT_SCAN_GLOBAL_DAILY_LIMIT,
  globalMonthly: process.env.RECEIPT_SCAN_GLOBAL_MONTHLY_LIMIT,
  globalDailyTokens: process.env.RECEIPT_SCAN_GLOBAL_DAILY_WEIGHTED_TOKEN_LIMIT,
  globalMonthlyTokens: process.env.RECEIPT_SCAN_GLOBAL_MONTHLY_WEIGHTED_TOKEN_LIMIT,
  estimatedTokens: process.env.RECEIPT_SCAN_ESTIMATED_WEIGHTED_TOKENS,
};

let userId;

function scanInput(key, hashCharacter = 'a') {
  return {
    userId,
    requestKey: key,
    endpoint: 'image',
    inputHash: hashCharacter.repeat(64),
  };
}

beforeAll(async () => {
  const result = await db.query(
    `INSERT INTO users (provider_uid, name, email)
     VALUES ('receipt-usage-test-user', 'Receipt Usage Test', 'receipt-usage@test.local')
     ON CONFLICT (provider_uid) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  userId = result.rows[0].id;
});

beforeEach(async () => {
  process.env.RECEIPT_SCAN_GUARDS_ENABLED = 'true';
  process.env.RECEIPT_SCAN_MINUTE_VELOCITY_LIMIT = '100';
  process.env.RECEIPT_SCAN_MONTHLY_INCLUDED = '150';
  process.env.RECEIPT_SCAN_GLOBAL_DAILY_LIMIT = '100000';
  process.env.RECEIPT_SCAN_GLOBAL_MONTHLY_LIMIT = '100000';
  process.env.RECEIPT_SCAN_GLOBAL_DAILY_WEIGHTED_TOKEN_LIMIT = '100000000';
  process.env.RECEIPT_SCAN_GLOBAL_MONTHLY_WEIGHTED_TOKEN_LIMIT = '1000000000';
  process.env.RECEIPT_SCAN_ESTIMATED_WEIGHTED_TOKENS = '500';
  await db.query(`DELETE FROM ai_usage_events WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM ai_usage_buckets WHERE feature = 'receipt_scanning'`);
  await db.query(`DELETE FROM account_feature_entitlements WHERE user_id = $1`, [userId]);
  await db.query('DELETE FROM receipt_scan_requests WHERE user_id = $1', [userId]);
});

afterAll(async () => {
  await db.query('DELETE FROM receipt_scan_requests WHERE user_id = $1', [userId]);
  await db.query(`DELETE FROM ai_usage_events WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM ai_usage_buckets WHERE feature = 'receipt_scanning'`);
  await db.query(`DELETE FROM account_feature_entitlements WHERE user_id = $1`, [userId]);
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
  const mappings = {
    RECEIPT_SCAN_GUARDS_ENABLED: ORIGINAL_ENV.enabled,
    RECEIPT_SCAN_MINUTE_VELOCITY_LIMIT: ORIGINAL_ENV.velocity,
    RECEIPT_SCAN_MONTHLY_INCLUDED: ORIGINAL_ENV.monthly,
    RECEIPT_SCAN_GLOBAL_DAILY_LIMIT: ORIGINAL_ENV.globalDaily,
    RECEIPT_SCAN_GLOBAL_MONTHLY_LIMIT: ORIGINAL_ENV.globalMonthly,
    RECEIPT_SCAN_GLOBAL_DAILY_WEIGHTED_TOKEN_LIMIT: ORIGINAL_ENV.globalDailyTokens,
    RECEIPT_SCAN_GLOBAL_MONTHLY_WEIGHTED_TOKEN_LIMIT: ORIGINAL_ENV.globalMonthlyTokens,
    RECEIPT_SCAN_ESTIMATED_WEIGHTED_TOKENS: ORIGINAL_ENV.estimatedTokens,
  };
  for (const [key, value] of Object.entries(mappings)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('returns a completed scan from the idempotency cache', async () => {
  const first = await reserveReceiptScan(scanInput('scan-cache-001'));
  expect(first.kind).toBe('reserved');
  await completeReceiptScan({
    requestId: first.requestId,
    userId,
    responseBody: { merchant: 'Test Market', amount: 12.34 },
    modelUsage: { model_call_count: 1, model_input_tokens: 3000, model_output_tokens: 500 },
  });

  const repeated = await reserveReceiptScan(scanInput('scan-cache-001'));
  expect(repeated.kind).toBe('cached');
  expect(repeated.responseBody).toEqual({ merchant: 'Test Market', amount: 12.34 });
  expect(repeated.usage.cached).toBe(true);

  const sameImageNewRequest = await reserveReceiptScan(scanInput('scan-cache-002'));
  expect(sameImageNewRequest.kind).toBe('cached');
  expect(sameImageNewRequest.requestId).toBe(first.requestId);
});

test('supports multiple queued scans while enforcing an atomic velocity bucket', async () => {
  process.env.RECEIPT_SCAN_MINUTE_VELOCITY_LIMIT = '2';
  await reserveReceiptScan(scanInput('scan-active-001'));
  await reserveReceiptScan(scanInput('scan-active-002', 'b'));
  await expect(reserveReceiptScan(scanInput('scan-active-003', 'c'))).rejects.toMatchObject({
    status: 429,
    reason_code: 'receipt_scan_velocity_limit',
  });
});

test('returns the active reservation for an idempotent retry', async () => {
  const first = await reserveReceiptScan(scanInput('scan-idempotent-active'));
  const repeated = await reserveReceiptScan(scanInput('scan-idempotent-active'));
  expect(repeated).toMatchObject({ kind: 'in_progress', requestId: first.requestId });
});

test('counts completed scans against the monthly allowance', async () => {
  process.env.RECEIPT_SCAN_MONTHLY_INCLUDED = '2';
  const first = await reserveReceiptScan(scanInput('scan-daily-001'));
  await completeReceiptScan({ requestId: first.requestId, userId, responseBody: { amount: 1 } });
  const second = await reserveReceiptScan(scanInput('scan-daily-002', 'b'));
  await completeReceiptScan({ requestId: second.requestId, userId, responseBody: { amount: 2 } });

  await expect(reserveReceiptScan(scanInput('scan-daily-003', 'c'))).rejects.toMatchObject({
    status: 429,
    reason_code: 'receipt_scan_monthly_limit',
  });
});

test('uses public defaults without an allowlist and honors paused entitlements', async () => {
  const publicScan = await reserveReceiptScan(scanInput('scan-access-001'));
  await failReceiptScan({ requestId: publicScan.requestId, userId, errorBody: { reason_code: 'test' } });
  await db.query(
    `INSERT INTO account_feature_entitlements (user_id, feature, status, plan_code)
     VALUES ($1, 'receipt_scanning', 'paused', 'public_default')`,
    [userId]
  );
  await expect(reserveReceiptScan(scanInput('scan-access-002', 'b'))).rejects.toMatchObject({
    status: 403,
    reason_code: 'receipt_scan_entitlement_paused',
  });
});

test('blocks new scans after the global weighted-token ceiling', async () => {
  process.env.RECEIPT_SCAN_GLOBAL_DAILY_WEIGHTED_TOKEN_LIMIT = '500';
  const first = await reserveReceiptScan(scanInput('scan-tokens-001'));
  await completeReceiptScan({
    requestId: first.requestId,
    userId,
    responseBody: { merchant: 'Token Market', amount: 9.99 },
    modelUsage: { model_call_count: 1, model_input_tokens: 100, model_output_tokens: 100 },
  });

  await expect(reserveReceiptScan(scanInput('scan-tokens-002', 'b'))).rejects.toMatchObject({
    status: 503,
    reason_code: 'receipt_scan_capacity_reached',
  });
});
