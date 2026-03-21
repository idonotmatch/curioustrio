const db = require('../../src/db');
const EmailImportLog = require('../../src/models/emailImportLog');

let testUserId;

beforeAll(async () => {
  const result = await db.query(
    `INSERT INTO users (auth0_id, name, email)
     VALUES ('test-auth0-email-log', 'Email Log Test User', 'emaillog@test.com')
     ON CONFLICT (auth0_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email
     RETURNING id`
  );
  testUserId = result.rows[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM email_import_log WHERE user_id = $1`, [testUserId]);
  await db.query(`DELETE FROM users WHERE auth0_id = 'test-auth0-email-log'`);
});

describe('EmailImportLog.create', () => {
  it('inserts and returns a log row', async () => {
    const log = await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-001',
      subject: 'Your receipt from Starbucks',
      fromAddress: 'receipts@starbucks.com',
      expenseId: null,
      status: 'imported',
    });

    expect(log).toBeDefined();
    expect(log.id).toBeDefined();
    expect(log.user_id).toBe(testUserId);
    expect(log.message_id).toBe('msg-001');
    expect(log.subject).toBe('Your receipt from Starbucks');
    expect(log.from_address).toBe('receipts@starbucks.com');
    expect(log.status).toBe('imported');
    expect(log.imported_at).toBeDefined();
  });

  it('returns null on conflict (idempotent)', async () => {
    // Insert once
    await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-002-dup',
      subject: 'Duplicate message',
      fromAddress: 'noreply@shop.com',
      expenseId: null,
      status: 'imported',
    });

    // Insert again with same userId+messageId
    const result = await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-002-dup',
      subject: 'Duplicate message',
      fromAddress: 'noreply@shop.com',
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
      subject: 'Find me',
      fromAddress: 'sender@example.com',
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
    // Insert two more messages
    await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-004-list-a',
      subject: 'List A',
      fromAddress: 'a@example.com',
      expenseId: null,
      status: 'imported',
    });

    await EmailImportLog.create({
      userId: testUserId,
      messageId: 'msg-004-list-b',
      subject: 'List B',
      fromAddress: 'b@example.com',
      expenseId: null,
      status: 'failed',
    });

    const logs = await EmailImportLog.listByUser(testUserId);

    expect(Array.isArray(logs)).toBe(true);
    expect(logs.length).toBeGreaterThanOrEqual(2);

    // Verify ordering: each item's imported_at should be >= the next one
    for (let i = 0; i < logs.length - 1; i++) {
      expect(new Date(logs[i].imported_at).getTime()).toBeGreaterThanOrEqual(
        new Date(logs[i + 1].imported_at).getTime()
      );
    }
  });
});
