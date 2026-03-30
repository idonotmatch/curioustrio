process.env.EMAIL_HASH_SECRET = 'test-secret-32chars-padded-xxxxx';
const { hashEmail } = require('../../src/services/emailHmac');
const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');
const User = require('../../src/models/user');

let mockUserId = 'test-auth0-households-owner';
let mockIsAnonymous = false;

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = mockUserId;
    req.isAnonymous = mockIsAnonymous;
    next();
  },
}));

const TEST_PROVIDER_UID = 'test-auth0-households-owner';
const TEST_PROVIDER_UID_JOINER = 'test-auth0-households-joiner';

async function cleanUp() {
  // Null out household_id for ALL users in test households (not just the two known UIDs)
  await db.query(`UPDATE users SET household_id = NULL WHERE household_id IN (SELECT id FROM households WHERE name LIKE 'Test Household%')`);
  // FK-safe cleanup order: household_invites → expenses (for test users) → users → households
  await db.query(
    `DELETE FROM household_invites WHERE invited_by IN (
      SELECT id FROM users WHERE provider_uid IN ($1, $2)
    )`,
    [TEST_PROVIDER_UID, TEST_PROVIDER_UID_JOINER]
  );
  await db.query(
    `DELETE FROM expenses WHERE user_id IN (
      SELECT id FROM users WHERE provider_uid IN ($1, $2)
    )`,
    [TEST_PROVIDER_UID, TEST_PROVIDER_UID_JOINER]
  );
  await db.query(
    `DELETE FROM users WHERE provider_uid IN ($1, $2)`,
    [TEST_PROVIDER_UID, TEST_PROVIDER_UID_JOINER]
  );
  // Delete categories before households (FK constraint)
  await db.query(`DELETE FROM categories WHERE household_id IN (SELECT id FROM households WHERE name LIKE 'Test Household%')`);
  // Delete test households
  await db.query(`DELETE FROM households WHERE name LIKE 'Test Household%'`);
}

beforeEach(async () => {
  mockUserId = TEST_PROVIDER_UID;
  mockIsAnonymous = false;
  await cleanUp();
  // Create fresh test user with no household
  await db.query(
    `INSERT INTO users (provider_uid, name, email) VALUES ($1, 'Test User Households', 'test-households@test.com')`,
    [TEST_PROVIDER_UID]
  );
});

afterAll(async () => {
  await cleanUp();
  await db.pool.end();
});

describe('POST /households', () => {
  it('creates a household and returns 201 with household data', async () => {
    const res = await request(app)
      .post('/households')
      .send({ name: 'Test Household Alpha' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Household Alpha');
    expect(res.body.id).toBeDefined();
  });

  it('returns 409 if user already in a household', async () => {
    // First create one
    await request(app)
      .post('/households')
      .send({ name: 'Test Household Beta' });

    // Try to create another
    const res = await request(app)
      .post('/households')
      .send({ name: 'Test Household Beta2' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Already in a household');
  });

  it('returns 400 if name is missing', async () => {
    const res = await request(app)
      .post('/households')
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('GET /households/me', () => {
  it('returns household and members for user in a household', async () => {
    // First create a household
    await request(app)
      .post('/households')
      .send({ name: 'Test Household Gamma' });

    const res = await request(app).get('/households/me');

    expect(res.status).toBe(200);
    expect(res.body.household).toBeDefined();
    expect(res.body.household.name).toBe('Test Household Gamma');
    expect(Array.isArray(res.body.members)).toBe(true);
    expect(res.body.members.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 404 if user is not in a household', async () => {
    const res = await request(app).get('/households/me');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not in a household');
  });
});

describe('POST /households/invites', () => {
  it('creates an invite and returns token', async () => {
    // Create a household first
    await request(app)
      .post('/households')
      .send({ name: 'Test Household Delta' });

    const res = await request(app)
      .post('/households/invites')
      .send({ email: 'invitee@test.com' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.expires_at).toBeDefined();
  });

  it('returns 403 if user is not in a household', async () => {
    const res = await request(app)
      .post('/households/invites')
      .send({ email: 'invitee@test.com' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Must be in a household to invite');
  });

  it('returns 400 if email is missing', async () => {
    // Create a household first so the 403 doesn't trigger
    await request(app)
      .post('/households')
      .send({ name: 'Test Household Invite Missing Email' });

    const res = await request(app)
      .post('/households/invites')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('email is required');
  });
});

describe('POST /households/invites/:token/accept', () => {
  it('returns 409 if accepting user already has a household', async () => {
    // Create household as primary user
    await request(app)
      .post('/households')
      .send({ name: 'Test Household Zeta' });

    // Create invite
    const inviteRes = await request(app)
      .post('/households/invites')
      .send({ email: 'someone@test.com' });

    const token = inviteRes.body.token;

    // Try to accept as user who already has a household
    const res = await request(app)
      .post(`/households/invites/${token}/accept`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Already in a household');
  });

  it('returns 404 for an unknown token', async () => {
    const res = await request(app)
      .post('/households/invites/totally-fake-token/accept');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Invite not found');
  });

  it('returns 410 when invite is expired', async () => {
    // Create household and invite with past expiry
    await request(app)
      .post('/households')
      .send({ name: 'Test Household Expired' });

    const ownerRow = await db.query(
      `SELECT id, household_id FROM users WHERE provider_uid = $1`,
      [TEST_PROVIDER_UID]
    );
    const owner = ownerRow.rows[0];

    const token = 'expired-token-test-' + Date.now();
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await db.query(
      `INSERT INTO household_invites (household_id, invited_email_hash, invited_by, token, expires_at, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [owner.household_id, hashEmail('expireduser@test.com'), owner.id, token, pastDate]
    );

    const res = await request(app)
      .post(`/households/invites/${token}/accept`);

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('Invite expired');
  });

  it('returns 410 when invite is already accepted', async () => {
    // Create household and invite
    await request(app)
      .post('/households')
      .send({ name: 'Test Household Already Accepted' });

    const inviteRes = await request(app)
      .post('/households/invites')
      .send({ email: 'joiner@test.com' });

    const token = inviteRes.body.token;

    // Create joiner user and accept as them
    await User.findOrCreateByProviderUid({ providerUid: TEST_PROVIDER_UID_JOINER, name: 'Joiner', email: 'joiner@test.com' });
    mockUserId = TEST_PROVIDER_UID_JOINER;

    const firstAccept = await request(app)
      .post(`/households/invites/${token}/accept`);
    expect(firstAccept.status).toBe(200);

    // Try to accept again (invite is now 'accepted', not 'pending')
    // Reset joiner's household so we don't get 409 first
    await db.query(
      `UPDATE users SET household_id = NULL WHERE provider_uid = $1`,
      [TEST_PROVIDER_UID_JOINER]
    );

    const secondAccept = await request(app)
      .post(`/households/invites/${token}/accept`);
    expect(secondAccept.status).toBe(410);
    expect(secondAccept.body.error).toBe('Invite already used or expired');
  });

  it('happy-path: second user accepts invite and joins household', async () => {
    // Create household as owner
    mockUserId = TEST_PROVIDER_UID;
    const householdRes = await request(app)
      .post('/households')
      .send({ name: 'Test Household Happy Accept' });
    expect(householdRes.status).toBe(201);
    const householdId = householdRes.body.id;

    // Create invite
    const inviteRes = await request(app)
      .post('/households/invites')
      .send({ email: 'joiner@test.com' });
    expect(inviteRes.status).toBe(201);
    const token = inviteRes.body.token;

    // Create joiner user
    await User.findOrCreateByProviderUid({ providerUid: TEST_PROVIDER_UID_JOINER, name: 'Joiner', email: 'joiner@test.com' });

    // Switch to joiner
    mockUserId = TEST_PROVIDER_UID_JOINER;

    const acceptRes = await request(app)
      .post(`/households/invites/${token}/accept`);

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.household_id).toBe(householdId);
  });
});

describe('POST /households/invites/:token/accept — email mismatch', () => {
  it('returns 403 when accepting user email does not match invited_email', async () => {
    mockUserId = TEST_PROVIDER_UID;
    await request(app).post('/households').send({ name: 'Test Household Email Mismatch' });
    const inviteRes = await request(app)
      .post('/households/invites')
      .send({ email: 'specifically-invited@test.com' });
    const token = inviteRes.body.token;

    const wrongUid = 'test-wrong-email-user';
    await db.query(
      `INSERT INTO users (provider_uid, name, email) VALUES ($1, 'Wrong User', 'wrong@test.com')
       ON CONFLICT (provider_uid) DO NOTHING`, [wrongUid]
    );
    mockUserId = wrongUid;

    const res = await request(app).post(`/households/invites/${token}/accept`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/email/i);

    await db.query(`DELETE FROM users WHERE provider_uid = $1`, [wrongUid]);
  });
});

describe('Anonymous user guard', () => {
  it('returns 403 on POST / when req.isAnonymous is true', async () => {
    mockIsAnonymous = true;
    const res = await request(app).post('/households').send({ name: 'Test' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Create an account/);
  });
});

describe('DELETE /households/me/members/:userId — ownership', () => {
  it('returns 403 when a non-creator tries to remove a member', async () => {
    mockUserId = TEST_PROVIDER_UID;
    await request(app).post('/households').send({ name: 'Test Household Ownership A' });
    const inviteRes = await request(app)
      .post('/households/invites').send({ email: 'joiner@test.com' });
    await User.findOrCreateByProviderUid({
      providerUid: TEST_PROVIDER_UID_JOINER, name: 'Joiner', email: 'joiner@test.com',
    });
    mockUserId = TEST_PROVIDER_UID_JOINER;
    await request(app).post(`/households/invites/${inviteRes.body.token}/accept`);

    const thirdUid = 'test-third-member-ownership';
    const thirdUser = await User.findOrCreateByProviderUid({
      providerUid: thirdUid, name: 'Third', email: 'third@test.com',
    });
    const ownerRow = await db.query(
      `SELECT household_id FROM users WHERE provider_uid = $1`, [TEST_PROVIDER_UID]
    );
    await db.query(`UPDATE users SET household_id = $1 WHERE id = $2`,
      [ownerRow.rows[0].household_id, thirdUser.id]);

    // Joiner (non-creator) attempts removal
    const res = await request(app).delete(`/households/me/members/${thirdUser.id}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/owner/i);

    await db.query(`DELETE FROM users WHERE provider_uid = $1`, [thirdUid]);
  });

  it('allows the creator to remove a member', async () => {
    mockUserId = TEST_PROVIDER_UID;
    await request(app).post('/households').send({ name: 'Test Household Creator Remove' });
    const inviteRes = await request(app)
      .post('/households/invites').send({ email: 'joiner@test.com' });
    await User.findOrCreateByProviderUid({
      providerUid: TEST_PROVIDER_UID_JOINER, name: 'Joiner', email: 'joiner@test.com',
    });
    mockUserId = TEST_PROVIDER_UID_JOINER;
    await request(app).post(`/households/invites/${inviteRes.body.token}/accept`);

    mockUserId = TEST_PROVIDER_UID;
    const joinerRow = await db.query(
      `SELECT id FROM users WHERE provider_uid = $1`, [TEST_PROVIDER_UID_JOINER]
    );
    const res = await request(app).delete(`/households/me/members/${joinerRow.rows[0].id}`);
    expect(res.status).toBe(200);
  });
});
