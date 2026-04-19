const db = require('../../src/db');
const EmailImportLog = require('../../src/models/emailImportLog');

let testUserId;

beforeAll(async () => {
  await db.query(
    `CREATE TABLE IF NOT EXISTS email_import_feedback (
       expense_id UUID PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE,
       review_action TEXT CHECK (review_action IN ('approved', 'dismissed', 'edited')),
       review_changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
       review_edit_count INT NOT NULL DEFAULT 0,
       reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );

  const result = await db.query(
    `INSERT INTO users (provider_uid, name, email)
     VALUES ('test-auth0-email-log', 'Email Log Test User', 'emaillog@test.com')
     ON CONFLICT (provider_uid) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email
     RETURNING id`
  );
  testUserId = result.rows[0].id;
});

afterAll(async () => {
  await db.query(
    `DELETE FROM email_import_feedback
     WHERE expense_id IN (SELECT id FROM expenses WHERE user_id = $1)`,
    [testUserId]
  );
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

  it('stores a shortened redacted snippet preview', async () => {
    const log = await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-001-sanitized-snippet',
      expenseId: null,
      status: 'imported',
      snippet: 'Reach me at shopper@example.com or visit https://example.com/orders/1234567890 for order 1234567890 and 9876543210.',
    });

    expect(log).toBeDefined();
    expect(log.snippet).toContain('[redacted-email]');
    expect(log.snippet).toContain('[redacted-link]');
    expect(log.snippet).toContain('[redacted-number]');
    expect(log.snippet.length).toBeLessThanOrEqual(120);
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

  it('returns explicit Gmail review metadata when linked expense exists', async () => {
    const expenseResult = await db.query(
      `INSERT INTO expenses (user_id, merchant, amount, date, status, source, notes, review_required, review_mode, review_source)
       VALUES ($1, 'Metadata Merchant', 24.5, '2026-03-24', 'pending', 'email', 'Imported from Gmail — needs review', TRUE, 'items_first', 'gmail')
       RETURNING id`,
      [testUserId]
    );

    await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-003-review-metadata',
      expenseId: expenseResult.rows[0].id,
      status: 'imported',
    });

    const found = await EmailImportLog.findByMessageId(testUserId, 'msg-003-review-metadata');

    expect(found).toBeDefined();
    expect(found.review_required).toBe(true);
    expect(found.review_mode).toBe('items_first');
    expect(found.review_source).toBe('gmail');
  });
});

describe('EmailImportLog.recordReviewFeedback', () => {
  it('records review actions and changed fields for imported expenses', async () => {
    const expenseResult = await db.query(
      `INSERT INTO expenses (user_id, merchant, amount, date, status, source, notes, review_required, review_source)
       VALUES ($1, 'Review Merchant', 18.5, '2026-03-21', 'pending', 'email', 'Imported from Gmail — needs review', TRUE, 'gmail')
       RETURNING id`,
      [testUserId]
    );

    await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-review-feedback',
      expenseId: expenseResult.rows[0].id,
      status: 'imported',
    });

    const updated = await EmailImportLog.recordReviewFeedback(expenseResult.rows[0].id, {
      action: 'edited',
      changedFields: ['merchant', 'amount'],
      incrementEditCount: true,
    });

    expect(updated.review_action).toBe('edited');
    expect(updated.review_edit_count).toBe(1);
    expect(updated.review_changed_fields).toEqual(expect.arrayContaining(['merchant', 'amount']));
    expect(updated.reviewed_at).toBeDefined();
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

  it('includes explicit review metadata for Gmail-backed rows', async () => {
    const expenseResult = await db.query(
      `INSERT INTO expenses (user_id, merchant, amount, date, status, source, notes, review_required, review_mode, review_source)
       VALUES ($1, 'List Metadata Merchant', 31.0, '2026-03-25', 'pending', 'email', 'Imported from Gmail — needs review', TRUE, 'quick_check', 'gmail')
       RETURNING id`,
      [testUserId]
    );

    await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-004-list-review-metadata',
      expenseId: expenseResult.rows[0].id,
      status: 'imported',
    });

    const logs = await EmailImportLog.listByUser(testUserId);
    const row = logs.find((entry) => entry.message_id === 'msg-004-list-review-metadata');

    expect(row).toBeTruthy();
    expect(row.review_required).toBe(true);
    expect(row.review_mode).toBe('quick_check');
    expect(row.review_source).toBe('gmail');
  });

  it('returns a compact payload by default', async () => {
    const logs = await EmailImportLog.listByUser(testUserId, 10);
    const row = logs[0];

    expect(row).toBeTruthy();
    expect(row).toHaveProperty('snippet', null);
    expect(row).toHaveProperty('notes', null);
    expect(row).not.toHaveProperty('user_id');
    expect(row).not.toHaveProperty('message_id');
  });
});

describe('EmailImportLog.summarizeByUser', () => {
  it('returns aggregate counts and reason breakdowns', async () => {
    const expenseResult = await db.query(
      `INSERT INTO expenses (user_id, merchant, amount, date, status, source, notes, review_required, review_mode, review_source)
       VALUES ($1, 'Summary Merchant', 18.5, '2026-03-21', 'pending', 'email', 'Imported from Gmail — needs review', TRUE, 'quick_check', 'gmail')
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
    expect(summary.current_pending_review).toBeGreaterThanOrEqual(1);
    expect(summary.review_mode_breakdown).toEqual(expect.objectContaining({
      quick_check: expect.any(Number),
      items_first: expect.any(Number),
      full_review: expect.any(Number),
    }));
    expect(summary.current_review_mode_breakdown).toEqual(expect.objectContaining({
      quick_check: expect.any(Number),
      items_first: expect.any(Number),
      full_review: expect.any(Number),
    }));
    expect(summary.review_mode_breakdown.quick_check).toBeGreaterThanOrEqual(1);
    expect(summary.current_review_mode_breakdown.quick_check).toBeGreaterThanOrEqual(1);
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(summary.reviewed_approved).toBeGreaterThanOrEqual(0);
    expect(summary.reviewed_dismissed).toBeGreaterThanOrEqual(0);
    expect(summary.reviewed_edited).toBeGreaterThanOrEqual(0);
    expect(summary.reasons).toEqual(expect.arrayContaining([
      { reason: 'Network error', count: expect.any(Number) },
      { reason: 'classifier_uncertain', count: expect.any(Number) },
    ]));
  });
});

describe('EmailImportLog without email_import_feedback table', () => {
  afterEach(async () => {
    await db.query(
      `CREATE TABLE IF NOT EXISTS email_import_feedback (
         expense_id UUID PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE,
         review_action TEXT CHECK (review_action IN ('approved', 'dismissed', 'edited')),
         review_changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
         review_edit_count INT NOT NULL DEFAULT 0,
         reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    );
  });

  it('falls back cleanly when review feedback table is missing', async () => {
    const expenseResult = await db.query(
      `INSERT INTO expenses (user_id, merchant, amount, date, status, source, notes, review_required, review_source)
       VALUES ($1, 'Missing Feedback Merchant', 21.5, '2026-03-22', 'pending', 'email', 'Imported from Gmail — needs review', TRUE, 'gmail')
       RETURNING id`,
      [testUserId]
    );
    const expenseId = expenseResult.rows[0].id;

    await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-missing-feedback-table',
      expenseId,
      status: 'imported',
    });

    await db.query(`DROP TABLE IF EXISTS email_import_feedback`);

    const found = await EmailImportLog.findByMessageId(testUserId, 'msg-missing-feedback-table');
    expect(found).toBeTruthy();
    expect(found.review_action).toBeNull();
    expect(found.review_edit_count).toBe(0);

    const review = await EmailImportLog.recordReviewFeedback(expenseId, {
      action: 'approved',
      changedFields: ['amount'],
      incrementEditCount: true,
    });
    expect(review.review_action).toBe('approved');
    expect(review.review_changed_fields).toEqual(expect.arrayContaining(['amount']));
    expect(review.review_edit_count).toBe(1);

    const summary = await EmailImportLog.summarizeByUser(testUserId, 30);
    expect(summary.imported).toBeGreaterThanOrEqual(1);
    expect(summary.reviewed_approved).toBe(0);

    const qualitySignals = await EmailImportLog.listQualitySignalsByUser(testUserId, 30);
    expect(Array.isArray(qualitySignals)).toBe(true);
    expect(qualitySignals.some((row) => row.message_id === 'msg-missing-feedback-table')).toBe(true);
  });
});
