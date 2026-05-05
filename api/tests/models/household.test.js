process.env.EMAIL_HASH_SECRET = 'test-secret-32chars-padded-xxxxx';
const { hashEmail } = require('../../src/services/emailHmac');
const { hashInviteToken } = require('../../src/services/inviteToken');
const db = require('../../src/db');
const Household = require('../../src/models/household');
const HouseholdInvite = require('../../src/models/householdInvite');
const User = require('../../src/models/user');

// Track created IDs for cleanup
let testHouseholdId;
let testUserId;
let testInviteId;

beforeAll(async () => {
  // Create a test household
  const hResult = await db.query(
    `INSERT INTO households (name) VALUES ('Test Household Setup') RETURNING id`
  );
  testHouseholdId = hResult.rows[0].id;

  // Create a test user
  const uResult = await db.query(
    `INSERT INTO users (provider_uid, name, email, household_id)
     VALUES ('auth0|household-test-user', 'Test Member', 'member@test.com', $1)
     ON CONFLICT (provider_uid) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, household_id = $1
     RETURNING id`,
    [testHouseholdId]
  );
  testUserId = uResult.rows[0].id;
});

afterAll(async () => {
  // Clean up in FK-safe order: household_invites → expenses → users → households
  await db.query(`DELETE FROM household_invites WHERE household_id = $1`, [testHouseholdId]);
  await db.query(`DELETE FROM expenses WHERE user_id = $1`, [testUserId]);
  await db.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
  // Also clean up any additional users/households created during tests
  await db.query(`DELETE FROM users WHERE provider_uid LIKE 'auth0|hh-test-%'`);
  // household_invites cleanup handled by household_id FK delete above
  await db.query(`DELETE FROM categories WHERE household_id IN (SELECT id FROM households WHERE name LIKE 'Test Household%')`);
  await db.query(`DELETE FROM households WHERE name LIKE 'Test Household%'`);
  await db.pool.end();
});

describe('Household.create', () => {
  it('creates and returns a household row', async () => {
    const household = await Household.create({ name: 'Test Household Alpha' });

    expect(household).toBeDefined();
    expect(household.id).toBeDefined();
    expect(household.name).toBe('Test Household Alpha');
    expect(household.created_at).toBeDefined();
  });
});

describe('Household.findById', () => {
  it('finds an existing household by id', async () => {
    const found = await Household.findById(testHouseholdId);

    expect(found).toBeDefined();
    expect(found.id).toBe(testHouseholdId);
    expect(found.name).toBe('Test Household Setup');
  });

  it('returns null when household does not exist', async () => {
    const found = await Household.findById('00000000-0000-0000-0000-000000000000');

    expect(found).toBeNull();
  });
});

describe('Household.findByUserId', () => {
  it('returns the household that the user belongs to', async () => {
    const found = await Household.findByUserId(testUserId);

    expect(found).toBeDefined();
    expect(found.id).toBe(testHouseholdId);
    expect(found.name).toBe('Test Household Setup');
  });

  it('returns null when user has no household', async () => {
    const uResult = await db.query(
      `INSERT INTO users (provider_uid, name, email)
       VALUES ('auth0|hh-test-no-household', 'No Household', 'nohousehold@hh-test.com')
       RETURNING id`
    );
    const userId = uResult.rows[0].id;

    const found = await Household.findByUserId(userId);

    expect(found).toBeNull();
  });
});

describe('Household.findMembers', () => {
  it('returns array of users in the household', async () => {
    const members = await Household.findMembers(testHouseholdId);

    expect(Array.isArray(members)).toBe(true);
    expect(members.length).toBeGreaterThanOrEqual(1);

    const member = members.find(m => m.id === testUserId);
    expect(member).toBeDefined();
    expect(member.name).toBe('Test Member');
    expect(member.email).toBe('member@test.com');
    expect(member.created_at).toBeDefined();
    // Should not expose provider_uid or household_id
    expect(member.provider_uid).toBeUndefined();
  });
});

describe('HouseholdInvite.create', () => {
  it('creates and returns an invite row', async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
    const rawToken = 'test-token-create-001';
    const invite = await HouseholdInvite.create({
      householdId: testHouseholdId,
      invitedEmail: hashEmail('invited@hh-test.com'),
      invitedBy: testUserId,
      token: rawToken,
      expiresAt,
    });

    expect(invite).toBeDefined();
    expect(invite.id).toBeDefined();
    expect(invite.household_id).toBe(testHouseholdId);
    expect(invite.invited_email_hash).toBe(hashEmail('invited@hh-test.com'));
    expect(invite.invited_by).toBe(testUserId);
    expect(invite.token).toBe(hashInviteToken(rawToken));
    expect(invite.token).not.toBe(rawToken);
    expect(invite.status).toBe('pending');
    expect(invite.expires_at).toBeDefined();
  });
});

describe('HouseholdInvite.findByToken', () => {
  it('finds an invite by token', async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const rawToken = 'test-token-find-002';
    await HouseholdInvite.create({
      householdId: testHouseholdId,
      invitedEmail: hashEmail('findtoken@hh-test.com'),
      invitedBy: testUserId,
      token: rawToken,
      expiresAt,
    });

    const found = await HouseholdInvite.findByToken(rawToken);

    expect(found).toBeDefined();
    expect(found.token).toBe(hashInviteToken(rawToken));
    expect(found.invited_email_hash).toBe(hashEmail('findtoken@hh-test.com'));
    expect(found.status).toBe('pending');
  });

  it('returns null when token does not exist', async () => {
    const found = await HouseholdInvite.findByToken('nonexistent-token-xyz');

    expect(found).toBeNull();
  });
});

describe('HouseholdInvite.accept', () => {
  it('updates the invite status to accepted', async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const rawToken = 'test-token-accept-003';
    await HouseholdInvite.create({
      householdId: testHouseholdId,
      invitedEmail: hashEmail('accept@hh-test.com'),
      invitedBy: testUserId,
      token: rawToken,
      expiresAt,
    });

    const updated = await HouseholdInvite.accept(rawToken);

    expect(updated).toBeDefined();
    expect(updated.status).toBe('accepted');
    expect(updated.token).toBe(hashInviteToken(rawToken));
  });
});

describe('HouseholdInvite.expireOld', () => {
  it('marks expired pending invites as expired and returns count', async () => {
    const pastDate = new Date(Date.now() - 1000); // 1 second in the past
    const rawToken = 'test-token-expire-004';
    await HouseholdInvite.create({
      householdId: testHouseholdId,
      invitedEmail: hashEmail('expire@hh-test.com'),
      invitedBy: testUserId,
      token: rawToken,
      expiresAt: pastDate,
    });

    const count = await HouseholdInvite.expireOld();

    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(1);

    const invite = await HouseholdInvite.findByToken(rawToken);
    expect(invite.status).toBe('expired');
  });
});

describe('User.setHouseholdId', () => {
  it('updates the household_id on a user and returns updated row', async () => {
    // Create a user without a household
    const uResult = await db.query(
      `INSERT INTO users (provider_uid, name, email)
       VALUES ('auth0|hh-test-set-household', 'Set Household User', 'sethousehold@hh-test.com')
       RETURNING id`
    );
    const userId = uResult.rows[0].id;

    const updated = await User.setHouseholdId(userId, testHouseholdId);

    expect(updated).toBeDefined();
    expect(updated.id).toBe(userId);
    expect(updated.household_id).toBe(testHouseholdId);
    expect(updated.provider_uid).toBe('auth0|hh-test-set-household');
    expect(updated.name).toBe('Set Household User');
    expect(updated.email).toBe('sethousehold@hh-test.com');
    expect(updated.created_at).toBeDefined();
  });
});
