const db = require('../../src/db');
const EmailImportLog = require('../../src/models/emailImportLog');

let testUserId;

beforeAll(async () => {
  const result = await db.query(
    `INSERT INTO users (provider_uid, name, email)
     VALUES ('test-auth0-email-log', 'Email Log Test User', 'emaillog@test.com')
     ON CONFLICT (provider_uid) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email
     RETURNING id`
  );
  testUserId = result.rows[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM email_import_log WHERE user_id = $1`, [testUserId]);
  await db.query(`DELETE FROM expenses WHERE user_id = $1`, [testUserId]);
  await db.query(`DELETE FROM users WHERE provider_uid = 'test-auth0-email-log'`);
});

describe('EmailImportLog.create', () => {
  it('inserts and returns a log row', async () => {
    const log = await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-001',
      expenseId: null,
      status: 'imported',
    });

    expect(log).toBeDefined();
    expect(log.id).toBeDefined();
    expect(log.user_id).toBe(testUserId);
    expect(log.message_id).toBe('msg-001');
    expect(log.status).toBe('imported');
    expect(log.imported_at).toBeDefined();
  });

  it('returns null on conflict (idempotent)', async () => {
    await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-002-dup',
      expenseId: null,
      status: 'imported',
    });

    const result = await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-002-dup',
      expenseId: null,
      status: 'imported',
    });

    expect(result).toBeNull();
  });
});

describe('EmailImportLog.findByMessageId', () => {
  it('returns the row when it exists', async () => {
    await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-003-find',
      expenseId: null,
      status: 'skipped',
    });

    const found = await EmailImportLog.findByMessageId(testUserId, 'msg-003-find');

    expect(found).toBeDefined();
    expect(found.message_id).toBe('msg-003-find');
    expect(found.status).toBe('skipped');
  });

  it('returns null when not found', async () => {
    const found = await EmailImportLog.findByMessageId(testUserId, 'nonexistent-msg-id');

    expect(found).toBeNull();
  });
});

describe('EmailImportLog.listByUser', () => {
  it('returns array ordered by imported_at DESC', async () => {
    await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-004-list-a',
      expenseId: null,
      status: 'imported',
    });

    await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-004-list-b',
      expenseId: null,
      status: 'failed',
    });

    const logs = await EmailImportLog.listByUser(testUserId);

    expect(Array.isArray(logs)).toBe(true);
    expect(logs.length).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < logs.length - 1; i++) {
      expect(new Date(logs[i].imported_at).getTime()).toBeGreaterThanOrEqual(
        new Date(logs[i + 1].imported_at).getTime()
      );
    }
  });
});

describe('EmailImportLog.summarizeByUser', () => {
  it('returns aggregate counts and reason breakdowns', async () => {
    const expenseResult = await db.query(
      `INSERT INTO expenses (user_id, merchant, amount, date, status, source, notes)
       VALUES ($1, 'Summary Merchant', 18.5, '2026-03-21', 'pending', 'email', 'Imported from Gmail — needs review')
       RETURNING id`,
      [testUserId]
    );

    await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-summary-imported',
      expenseId: expenseResult.rows[0].id,
      status: 'imported',
    });
    await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-summary-skipped',
      expenseId: null,
      status: 'skipped',
      skipReason: 'classifier_uncertain',
    });
    await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-summary-failed',
      expenseId: null,
      status: 'failed',
      skipReason: 'Network error',
    });

    const summary = await EmailImportLog.summarizeByUser(testUserId, 30);
    expect(summary.imported).toBeGreaterThanOrEqual(1);
    expect(summary.imported_pending_review).toBeGreaterThanOrEqual(1);
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(summary.reasons).toEqual(expect.arrayContaining([
      { reason: 'Network error', count: expect.any(Number) },
      { reason: 'classifier_uncertain', count: expect.any(Number) },
    ]));
  });
});
