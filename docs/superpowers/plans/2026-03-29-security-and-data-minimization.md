# Security & Data Minimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the API against nine identified security vulnerabilities and eliminate unnecessary PII retention server-side.

**Architecture:** Pre-launch with no production data, so all schema changes are made by editing existing migration files in place and resetting the DB — no incremental ALTER TABLE migrations needed. Nine tasks across five phases. All code changes (routes, models, services, tests) are identical to the migration-based approach; only the schema step in each task is simpler. Tasks are independent except Task 6 (depends on Task 2) and Task 9 (self-contained but touches gmail.js last).

**Tech Stack:** Node.js, Express, PostgreSQL (`pg`), Jest + Supertest, Node.js `crypto` (built-in — no new packages)

---

## DB Reset Command (run after any schema file edit)

```bash
dropdb expense_tracker_test && createdb expense_tracker_test
for f in /Users/dangnguyen/curious-trio/api/src/db/migrations/*.sql; do
  psql postgres://test:test@localhost:5432/expense_tracker_test -f "$f"
done
```

Run this at the start of each task that edits a schema file.

---

## File Map

| File | Tasks |
|---|---|
| `api/src/db/migrations/001_initial_schema.sql` | Tasks 3, 5, 6 |
| `api/src/db/migrations/002_gmail.sql` | Tasks 4, 8 |
| `api/src/db/migrations/018_gmail_state_store.sql` *(new)* | Task 9 |
| `api/src/db/index.js` | Task 1 |
| `api/src/index.js` | Task 1 |
| `api/src/routes/expenses.js` | Tasks 1, 5 |
| `api/src/routes/households.js` | Tasks 2, 3, 6 |
| `api/src/routes/gmail.js` | Tasks 4, 9 |
| `api/src/models/household.js` | Task 3 |
| `api/src/models/householdInvite.js` | Task 6 |
| `api/src/models/emailImportLog.js` | Task 4 |
| `api/src/models/expense.js` | Task 5 |
| `api/src/models/oauthToken.js` | Tasks 7, 8 |
| `api/src/services/emailHmac.js` *(new)* | Task 6 |
| `api/src/services/gmailClient.js` | Tasks 7, 8, 9 |
| `api/src/services/tokenCrypto.js` *(new)* | Task 8 |
| `api/tests/routes/cors.test.js` *(new)* | Task 1 |
| `api/tests/routes/expenses.test.js` | Tasks 1, 5 |
| `api/tests/routes/households.test.js` | Tasks 2, 3, 6 |
| `api/tests/routes/gmail.test.js` | Tasks 7, 8, 9 |
| `api/tests/models/emailImportLog.test.js` | Task 4 |
| `api/tests/services/emailHmac.test.js` *(new)* | Task 6 |
| `api/tests/services/tokenCrypto.test.js` *(new)* | Task 8 |

---

## New Env Vars

Add to `api/.env`, `api/tests/setup.js`, and Render before deploying the relevant task.

| Var | Task | Generate with |
|---|---|---|
| `CORS_ALLOWED_ORIGINS` | 1 | `https://adlo-1j98.onrender.com` |
| `EMAIL_HASH_SECRET` | 6 | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TOKEN_ENCRYPTION_KEY` | 8 | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

---

## Phase A — Immediate Config Fixes (no schema changes)

### Task 1: SSL enforcement, CORS lockdown, input length limits

**Files:**
- Modify: `api/src/db/index.js`
- Modify: `api/src/index.js`
- Modify: `api/src/routes/expenses.js`
- Create: `api/tests/routes/cors.test.js`
- Modify: `api/tests/routes/expenses.test.js`

- [ ] **Step 1: Write failing CORS test**

`/health` is registered before `cors()` middleware so it never passes through it. Test against `GET /expenses` instead.

Create `api/tests/routes/cors.test.js`:

```js
jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => { req.userId = 'cors-test-user'; next(); },
}));

const request = require('supertest');
const app = require('../../src/index');

describe('CORS', () => {
  it('does not return wildcard Access-Control-Allow-Origin for unknown origins', async () => {
    const res = await request(app)
      .get('/expenses')
      .set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('allows requests with no origin (mobile apps, server-to-server)', async () => {
    const res = await request(app).get('/expenses');
    expect(res.status).not.toBe(403);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest tests/routes/cors.test.js --no-coverage
```
Expected: FAIL — `access-control-allow-origin` is currently `*`

- [ ] **Step 3: Fix CORS in `api/src/index.js`**

Replace `app.use(cors());` with:

```js
const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // mobile apps, curl, server-to-server
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`Origin ${origin} not allowed by CORS policy`));
  },
}));
```

- [ ] **Step 4: Fix SSL in `api/src/db/index.js`**

Replace:
```js
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```
With:
```js
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
```

- [ ] **Step 5: Write failing input length tests**

In `api/tests/routes/expenses.test.js` add:

```js
it('POST /expenses/parse returns 400 when input exceeds 500 chars', async () => {
  const res = await request(app)
    .post('/expenses/parse')
    .send({ input: 'a'.repeat(501), today: '2026-03-29' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/too long/i);
});

it('POST /expenses/scan returns 400 when image_base64 exceeds 1.4MB', async () => {
  const res = await request(app)
    .post('/expenses/scan')
    .send({ image_base64: 'a'.repeat(1_400_001), today: '2026-03-29' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/too large/i);
});
```

- [ ] **Step 6: Run to confirm they fail**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest tests/routes/expenses.test.js -t "too long|too large" --no-coverage
```
Expected: FAIL

- [ ] **Step 7: Add length guards in `api/src/routes/expenses.js`**

In `POST /parse`, after the `if (!input)` check:
```js
if (input.length > 500) return res.status(400).json({ error: 'input too long (max 500 characters)' });
```

In `POST /scan`, after the `if (!image_base64)` check:
```js
if (image_base64.length > 1_400_000) return res.status(400).json({ error: 'image too large (max ~1MB base64)' });
```

- [ ] **Step 8: Run all tests**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest --no-coverage
```
Expected: all pass

- [ ] **Step 9: Commit**

```bash
cd /Users/dangnguyen/curious-trio/api
git add src/db/index.js src/index.js src/routes/expenses.js \
        tests/routes/cors.test.js tests/routes/expenses.test.js
git commit -m "security: enforce DB SSL, lock CORS to known origins, add input length limits"
```

---

## Phase B — Security Fixes

### Task 2: Invite accept — verify accepting user's email matches the invited email

No schema change needed.

**Files:**
- Modify: `api/src/routes/households.js`
- Modify: `api/tests/routes/households.test.js`

- [ ] **Step 1: Write failing test**

In `api/tests/routes/households.test.js` add:

```js
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
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest tests/routes/households.test.js -t "email mismatch" --no-coverage
```
Expected: FAIL

- [ ] **Step 3: Add email check in `api/src/routes/households.js`**

In `POST /households/invites/:token/accept`, after the `user.household_id` 409 check, add:

```js
if (invite.invited_email && user.email &&
    invite.invited_email.toLowerCase() !== user.email.toLowerCase()) {
  return res.status(403).json({ error: 'This invite was sent to a different email address' });
}
```

- [ ] **Step 4: Run all tests**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest --no-coverage
```
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/routes/households.js tests/routes/households.test.js
git commit -m "security: verify email match when accepting household invite"
```

---

### Task 3: Household member removal — restrict to creator only

**Schema change:** Edit `001_initial_schema.sql` directly. Reset and reseed test DB.

**Files:**
- Modify: `api/src/db/migrations/001_initial_schema.sql`
- Modify: `api/src/models/household.js`
- Modify: `api/src/routes/households.js`
- Modify: `api/tests/routes/households.test.js`

- [ ] **Step 1: Write failing tests**

In `api/tests/routes/households.test.js` add:

```js
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
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest tests/routes/households.test.js -t "ownership" --no-coverage
```
Expected: FAIL

- [ ] **Step 3: Edit `001_initial_schema.sql` — add `created_by` to `households`**

Change the `households` table definition from:
```sql
CREATE TABLE households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
To:
```sql
CREATE TABLE households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID,  -- FK added after users table; see constraint below
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

And add this after the `users` table definition:
```sql
ALTER TABLE households
  ADD CONSTRAINT fk_households_created_by
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_households_created_by ON households(created_by);
```

`ON DELETE SET NULL` means deleting a user who is the creator does not cascade-delete the household, and test teardown (which deletes users) is not blocked.

- [ ] **Step 4: Reset test DB**

```bash
dropdb expense_tracker_test && createdb expense_tracker_test
for f in /Users/dangnguyen/curious-trio/api/src/db/migrations/*.sql; do
  psql postgres://test:test@localhost:5432/expense_tracker_test -f "$f"
done
```

- [ ] **Step 5: Update `api/src/models/household.js` — include `created_by` everywhere**

```js
async function create({ name, createdBy }) {
  const result = await db.query(
    `INSERT INTO households (name, created_by) VALUES ($1, $2)
     RETURNING id, name, created_by, created_at`,
    [name, createdBy || null]
  );
  return result.rows[0];
}

async function findById(id) {
  const result = await db.query(
    `SELECT id, name, created_by, created_at FROM households WHERE id = $1`, [id]
  );
  return result.rows[0] || null;
}

async function findByUserId(userId) {
  const result = await db.query(
    `SELECT h.id, h.name, h.created_by, h.created_at
     FROM households h JOIN users u ON u.household_id = h.id WHERE u.id = $1`, [userId]
  );
  return result.rows[0] || null;
}

async function updateName(id, name) {
  const result = await db.query(
    `UPDATE households SET name = $1 WHERE id = $2
     RETURNING id, name, created_by, created_at`, [name, id]
  );
  return result.rows[0] || null;
}
```

- [ ] **Step 6: Update household creation and member removal in `api/src/routes/households.js`**

In `POST /`: pass `createdBy: user.id`:
```js
const household = await Household.create({ name, createdBy: user.id });
```

In `DELETE /me/members/:userId`, after the household_id check, add:
```js
const household = await Household.findById(requester.household_id);
if (!household || household.created_by !== requester.id) {
  return res.status(403).json({ error: 'Only the household owner can remove members' });
}
```

- [ ] **Step 7: Run all tests**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest --no-coverage
```
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add src/db/migrations/001_initial_schema.sql src/models/household.js \
        src/routes/households.js tests/routes/households.test.js
git commit -m "security: restrict member removal to household creator"
```

---

## Phase C — Data Minimization

### Task 4: Email import log — strip metadata columns, add 90-day expiry function

**Schema change:** Edit `002_gmail.sql` directly. Reset test DB.

Also fixes a pre-existing broken column reference (`auth0_id` → `provider_uid`) in the existing test file.

**Files:**
- Modify: `api/src/db/migrations/002_gmail.sql`
- Modify: `api/src/models/emailImportLog.js`
- Modify: `api/src/routes/gmail.js`
- Modify: `api/tests/models/emailImportLog.test.js`

- [ ] **Step 1: Fix the pre-existing `auth0_id` reference in `emailImportLog.test.js`**

The test currently uses `auth0_id` (the column name before migration 010 renamed it). This is already broken against the live schema. Fix it before touching anything else:

- `beforeAll` line 8: `INSERT INTO users (auth0_id, ...)` → `INSERT INTO users (provider_uid, ...)`
- `beforeAll` line 10: `ON CONFLICT (auth0_id)` → `ON CONFLICT (provider_uid)`
- `afterAll` line 18: `WHERE auth0_id = 'test-auth0-email-log'` → `WHERE provider_uid = 'test-auth0-email-log'`

Also remove all assertions and parameters referencing `subject` and `from_address` from every test in the file.

- [ ] **Step 2: Confirm the test file now passes before schema changes**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest tests/models/emailImportLog.test.js --no-coverage
```
Expected: PASS (baseline)

- [ ] **Step 3: Edit `002_gmail.sql` — remove `subject`/`from_address` from `email_import_log`, add expiry function**

Change the `email_import_log` table definition from:
```sql
CREATE TABLE email_import_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  message_id TEXT NOT NULL,
  subject TEXT,
  from_address TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expense_id UUID REFERENCES expenses(id),
  status TEXT NOT NULL DEFAULT 'imported' CHECK (status IN ('imported','skipped','failed')),
  UNIQUE(user_id, message_id)
);
```
To:
```sql
CREATE TABLE email_import_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  message_id TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expense_id UUID REFERENCES expenses(id),
  status TEXT NOT NULL DEFAULT 'imported' CHECK (status IN ('imported','skipped','failed')),
  UNIQUE(user_id, message_id)
);

CREATE INDEX idx_email_import_log_imported_at ON email_import_log(imported_at);

-- Call from a cron job to prune records older than the Gmail lookback window
CREATE OR REPLACE FUNCTION expire_email_import_log() RETURNS void AS $$
  DELETE FROM email_import_log WHERE imported_at < NOW() - INTERVAL '90 days';
$$ LANGUAGE sql;
```

- [ ] **Step 4: Reset test DB**

```bash
dropdb expense_tracker_test && createdb expense_tracker_test
for f in /Users/dangnguyen/curious-trio/api/src/db/migrations/*.sql; do
  psql postgres://test:test@localhost:5432/expense_tracker_test -f "$f"
done
```

- [ ] **Step 5: Update `api/src/models/emailImportLog.js`**

```js
async function create({ userId, messageId, expenseId, status = 'imported' }) {
  const result = await db.query(
    `INSERT INTO email_import_log (user_id, message_id, expense_id, status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, message_id) DO NOTHING
     RETURNING *`,
    [userId, messageId, expenseId, status]
  );
  return result.rows[0] || null;
}

async function listByUser(userId, limit = 100) {
  const result = await db.query(
    `SELECT id, user_id, message_id, expense_id, status, imported_at
     FROM email_import_log WHERE user_id = $1 ORDER BY imported_at DESC LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}
```

- [ ] **Step 6: Remove `subject`/`fromAddress` from all three `EmailImportLog.create` calls in `api/src/routes/gmail.js`**

There are three calls in the import route. Strip `subject` and `fromAddress` from each.

- [ ] **Step 7: Run all tests**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest --no-coverage
```
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add src/db/migrations/002_gmail.sql src/models/emailImportLog.js \
        src/routes/gmail.js tests/models/emailImportLog.test.js
git commit -m "privacy: drop email_import_log subject/from_address, add 90-day expiry function"
```

---

### Task 5: Expense schema — drop unused location fields and dead column

**Schema change:** Edit `001_initial_schema.sql`. Reset test DB.

`place_name` and `address` are display-only — zero server-side queries use them. `raw_receipt_url` has never been written. `mapkit_stable_id` is kept (used for duplicate detection).

**Files:**
- Modify: `api/src/db/migrations/001_initial_schema.sql`
- Modify: `api/src/models/expense.js`
- Modify: `api/src/routes/expenses.js`
- Modify: `api/tests/routes/expenses.test.js`

- [ ] **Step 1: Write failing test**

In `api/tests/routes/expenses.test.js` add:

```js
it('POST /expenses/confirm does not store or return place_name or address', async () => {
  const res = await request(app)
    .post('/expenses/confirm')
    .send({
      merchant: 'Test Cafe', amount: 12.50, date: '2026-03-29', source: 'manual',
      place_name: 'Test Cafe Downtown', address: '123 Main St',
    });
  expect(res.status).toBe(201);
  expect(res.body.expense).not.toHaveProperty('place_name');
  expect(res.body.expense).not.toHaveProperty('address');
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest tests/routes/expenses.test.js -t "place_name" --no-coverage
```
Expected: FAIL

- [ ] **Step 3: Edit `001_initial_schema.sql` — remove three columns from `expenses`**

In the `expenses` table definition, delete these three lines:
```sql
  place_name TEXT,
  address TEXT,
  ...
  raw_receipt_url TEXT,
```

- [ ] **Step 4: Reset test DB**

```bash
dropdb expense_tracker_test && createdb expense_tracker_test
for f in /Users/dangnguyen/curious-trio/api/src/db/migrations/*.sql; do
  psql postgres://test:test@localhost:5432/expense_tracker_test -f "$f"
done
```

- [ ] **Step 5: Update `api/src/models/expense.js` — remove `placeName`, `address` from `create()`**

Remove both from the function signature, the INSERT column list, and the VALUES params. Renumber remaining positional params accordingly.

- [ ] **Step 6: Update `api/src/routes/expenses.js`**

In `POST /expenses/confirm`: remove `place_name`, `address` from `req.body` destructuring and from the `Expense.create(...)` call.

In `PATCH /expenses/:id`: remove any remaining reference to these fields.

- [ ] **Step 7: Run all tests**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest --no-coverage
```
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add src/db/migrations/001_initial_schema.sql src/models/expense.js \
        src/routes/expenses.js tests/routes/expenses.test.js
git commit -m "privacy: drop expense location fields (place_name, address, raw_receipt_url)"
```

---

### Task 6: Hash invited email in `household_invites`

**Schema change:** Edit `001_initial_schema.sql`. Reset test DB.

**Dependency:** Task 2 must be merged first (the email match check in Task 2 is updated here to compare hashes).

**Pre-condition:** Generate `EMAIL_HASH_SECRET` and add to `api/.env`, `api/tests/setup.js`, and Render.

**Files:**
- Create: `api/src/services/emailHmac.js`
- Create: `api/tests/services/emailHmac.test.js`
- Modify: `api/src/db/migrations/001_initial_schema.sql`
- Modify: `api/src/models/householdInvite.js`
- Modify: `api/src/routes/households.js`
- Modify: `api/tests/routes/households.test.js`

- [ ] **Step 1: Write failing unit tests for the HMAC helper**

Create `api/tests/services/emailHmac.test.js`:

```js
process.env.EMAIL_HASH_SECRET = 'test-secret-32chars-padded-xxxxx';
const { hashEmail } = require('../../src/services/emailHmac');

describe('hashEmail', () => {
  it('returns a 64-char hex string', () => {
    expect(hashEmail('user@example.com')).toHaveLength(64);
  });
  it('is deterministic', () => {
    expect(hashEmail('user@example.com')).toBe(hashEmail('user@example.com'));
  });
  it('normalises case before hashing', () => {
    expect(hashEmail('User@Example.COM')).toBe(hashEmail('user@example.com'));
  });
  it('different emails produce different hashes', () => {
    expect(hashEmail('a@example.com')).not.toBe(hashEmail('b@example.com'));
  });
  it('throws if EMAIL_HASH_SECRET is not set', () => {
    const saved = process.env.EMAIL_HASH_SECRET;
    delete process.env.EMAIL_HASH_SECRET;
    expect(() => hashEmail('x@y.com')).toThrow();
    process.env.EMAIL_HASH_SECRET = saved;
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest tests/services/emailHmac.test.js --no-coverage
```
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement `api/src/services/emailHmac.js`**

```js
const crypto = require('crypto');

function hashEmail(email) {
  if (!process.env.EMAIL_HASH_SECRET) {
    throw new Error('EMAIL_HASH_SECRET env var is not set');
  }
  return crypto
    .createHmac('sha256', process.env.EMAIL_HASH_SECRET)
    .update(email.toLowerCase().trim())
    .digest('hex');
}

module.exports = { hashEmail };
```

- [ ] **Step 4: Run unit tests to confirm they pass**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest tests/services/emailHmac.test.js --no-coverage
```
Expected: PASS

- [ ] **Step 5: Edit `001_initial_schema.sql` — rename column in `household_invites`**

In the `household_invites` table definition, change:
```sql
  invited_email TEXT NOT NULL,
```
To:
```sql
  invited_email_hash TEXT NOT NULL,
```

- [ ] **Step 6: Reset test DB**

```bash
dropdb expense_tracker_test && createdb expense_tracker_test
for f in /Users/dangnguyen/curious-trio/api/src/db/migrations/*.sql; do
  psql postgres://test:test@localhost:5432/expense_tracker_test -f "$f"
done
```

- [ ] **Step 7: Update `api/src/models/householdInvite.js` — rename column in all three functions**

```js
async function create({ householdId, invitedEmail, invitedBy, token, expiresAt }) {
  const result = await db.query(
    `INSERT INTO household_invites (household_id, invited_email_hash, invited_by, token, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, household_id, invited_email_hash, invited_by, token, status, expires_at, created_at`,
    [householdId, invitedEmail, invitedBy, token, expiresAt]
  );
  return result.rows[0];
}

async function findByToken(token) {
  const result = await db.query(
    `SELECT id, household_id, invited_email_hash, invited_by, token, status, expires_at, created_at
     FROM household_invites WHERE token = $1`, [token]
  );
  return result.rows[0] || null;
}

async function accept(token) {
  const result = await db.query(
    `UPDATE household_invites SET status = 'accepted' WHERE token = $1 AND status = 'pending'
     RETURNING id, household_id, invited_email_hash, invited_by, token, status, expires_at, created_at`,
    [token]
  );
  return result.rows[0] || null;
}
```

- [ ] **Step 8: Update `api/src/routes/households.js`**

Add at top: `const { hashEmail } = require('../services/emailHmac');`

In `POST /households/invites` — hash before storing:
```js
await HouseholdInvite.create({
  householdId: user.household_id,
  invitedEmail: hashEmail(email),  // hash, not plaintext
  invitedBy: user.id,
  token,
  expiresAt,
});
```

In `POST /households/invites/:token/accept` — replace the Task 2 plaintext check with a hash comparison:
```js
if (invite.invited_email_hash && user.email &&
    invite.invited_email_hash !== hashEmail(user.email)) {
  return res.status(403).json({ error: 'This invite was sent to a different email address' });
}
```

- [ ] **Step 9: Update `api/tests/routes/households.test.js`**

Add near the top:
```js
process.env.EMAIL_HASH_SECRET = 'test-secret-32chars-padded-xxxxx';
const { hashEmail } = require('../../src/services/emailHmac');
```

Update the raw SQL INSERT in the expired-invite test (which inserts directly into `household_invites`):
```js
// Before: invited_email: 'expireduser@test.com'
// After:
[owner.household_id, hashEmail('expireduser@test.com'), owner.id, token, pastDate]
// and the INSERT column: invited_email_hash
```

The happy-path accept test continues to work because the invite is created with `hashEmail('joiner@test.com')` and the accepting user's stored email is also `joiner@test.com`.

- [ ] **Step 10: Run all tests**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest --no-coverage
```
Expected: all pass

- [ ] **Step 11: Commit**

```bash
git add src/db/migrations/001_initial_schema.sql src/services/emailHmac.js \
        src/models/householdInvite.js src/routes/households.js \
        tests/services/emailHmac.test.js tests/routes/households.test.js
git commit -m "privacy: hash invited_email in household_invites using HMAC-SHA256"
```

---

## Phase D — Credential Hardening

### Task 7: OAuth — stop persisting access_token after refresh

No schema change. The access_token column stays; it will always be `NULL` going forward.

**Files:**
- Modify: `api/src/services/gmailClient.js`
- Modify: `api/tests/routes/gmail.test.js`

- [ ] **Step 1: Update the stale assertion in `gmail.test.js` first**

Line 98 asserts `expect(token.rows[0].access_token).toBe('new_access')`. Change to:
```js
expect(token.rows[0].access_token).toBeNull();
```

This will now fail (confirming the right signal exists) until the implementation is changed.

- [ ] **Step 2: Confirm the updated test now fails**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest tests/routes/gmail.test.js -t "saves token" --no-coverage
```
Expected: FAIL

- [ ] **Step 3: Update `api/src/services/gmailClient.js`**

In `getAuthenticatedClient`, set initial credentials using only the refresh_token — the Google client fetches a fresh access_token automatically:

```js
client.setCredentials({
  refresh_token: tokenRow.refresh_token,
});
```

In the refresh block, null out `access_token` in the DB while keeping fresh credentials in memory for this request:

```js
await OAuthToken.upsert({
  userId,
  accessToken: null,       // do not persist
  refreshToken: credentials.refresh_token || tokenRow.refresh_token,
  expiresAt: null,
  scope: tokenRow.scope,
});
client.setCredentials(credentials); // in-memory only, valid for this request
```

- [ ] **Step 4: Run all tests**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest --no-coverage
```
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/services/gmailClient.js tests/routes/gmail.test.js
git commit -m "privacy: do not persist OAuth access_token — regenerate from refresh_token each use"
```

---

### Task 8: Encrypt OAuth refresh_token at rest

**Schema change:** Edit `002_gmail.sql` to add a comment documenting the encrypted contract. Reset test DB. No re-encryption script needed — no existing data.

**Files:**
- Create: `api/src/services/tokenCrypto.js`
- Create: `api/tests/services/tokenCrypto.test.js`
- Modify: `api/src/db/migrations/002_gmail.sql`
- Modify: `api/src/models/oauthToken.js`
- Modify: `api/tests/routes/gmail.test.js`

**Pre-condition:** Generate `TOKEN_ENCRYPTION_KEY` and add to `api/.env`, `api/tests/setup.js`, and Render.

- [ ] **Step 1: Write failing unit tests**

Create `api/tests/services/tokenCrypto.test.js`:

```js
process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes as hex

const { encrypt, decrypt } = require('../../src/services/tokenCrypto');

describe('tokenCrypto', () => {
  it('returns a string different from plaintext', () => {
    expect(encrypt('secret')).not.toBe('secret');
  });
  it('round-trips correctly', () => {
    expect(decrypt(encrypt('refresh-token-abc'))).toBe('refresh-token-abc');
  });
  it('each encrypt produces a unique ciphertext', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });
  it('throws on tampered ciphertext', () => {
    const ct = encrypt('valid');
    expect(() => decrypt(ct.slice(0, -4) + 'xxxx')).toThrow();
  });
  it('throws if TOKEN_ENCRYPTION_KEY is not set', () => {
    const saved = process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encrypt('x')).toThrow();
    process.env.TOKEN_ENCRYPTION_KEY = saved;
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest tests/services/tokenCrypto.test.js --no-coverage
```
Expected: FAIL

- [ ] **Step 3: Implement `api/src/services/tokenCrypto.js`**

```js
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LEN  = 12; // 96-bit IV for GCM
const TAG_LEN = 16; // 128-bit auth tag

function getKey() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/** Returns base64: iv(12) + authTag(16) + ciphertext */
function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv, { authTagLength: TAG_LEN });
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

/** Throws on invalid or tampered input */
function decrypt(ciphertext) {
  const buf = Buffer.from(ciphertext, 'base64');
  const iv  = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct  = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
```

- [ ] **Step 4: Run unit tests to confirm they pass**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest tests/services/tokenCrypto.test.js --no-coverage
```
Expected: PASS

- [ ] **Step 5: Edit `002_gmail.sql` — document encryption contract**

Add after the `oauth_tokens` table definition:

```sql
COMMENT ON COLUMN oauth_tokens.refresh_token IS
  'AES-256-GCM encrypted. Use tokenCrypto.decrypt() to read.';
COMMENT ON COLUMN oauth_tokens.access_token IS
  'Always NULL. Not persisted — regenerated from refresh_token on each use.';
```

Reset test DB:

```bash
dropdb expense_tracker_test && createdb expense_tracker_test
for f in /Users/dangnguyen/curious-trio/api/src/db/migrations/*.sql; do
  psql postgres://test:test@localhost:5432/expense_tracker_test -f "$f"
done
```

- [ ] **Step 6: Update `api/src/models/oauthToken.js`**

Key detail: `upsert` is called both on initial connect (with a new plaintext `refreshToken`) and after refresh cycles (Task 7 passes the existing stored token). Only encrypt when a new value is provided; otherwise preserve the existing encrypted value via `COALESCE`.

```js
const { encrypt, decrypt } = require('../services/tokenCrypto');

async function upsert({ userId, provider = 'google', accessToken, refreshToken, expiresAt, scope }) {
  const encryptedRefresh = refreshToken ? encrypt(refreshToken) : null;
  const result = await db.query(
    `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, scope)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       access_token  = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
       expires_at    = EXCLUDED.expires_at,
       scope         = EXCLUDED.scope,
       updated_at    = NOW()
     RETURNING *`,
    [userId, provider, null, encryptedRefresh, expiresAt, scope]
  );
  const row = result.rows[0];
  return { ...row, refresh_token: row.refresh_token ? decrypt(row.refresh_token) : null };
}

async function findByUserId(userId, provider = 'google') {
  const result = await db.query(
    'SELECT * FROM oauth_tokens WHERE user_id = $1 AND provider = $2', [userId, provider]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return { ...row, refresh_token: row.refresh_token ? decrypt(row.refresh_token) : null };
}
```

- [ ] **Step 7: Update direct SQL inserts in `api/tests/routes/gmail.test.js`**

The gmail tests insert token rows directly via SQL, bypassing the model. After this task, `OAuthToken.findByUserId` calls `decrypt()` on the stored value — plaintext `'ref_tok'` will throw. Update all direct inserts to store encrypted tokens.

Add at the top of `gmail.test.js`:
```js
process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
const { encrypt } = require('../../src/services/tokenCrypto');
```

Replace every direct token insert (there are several in status and import tests) — for example:
```js
// Before:
await db.query(
  `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
   VALUES ($1, 'google', 'acc_tok', 'ref_tok', 'gmail.readonly')`, [userId]
);

// After:
await db.query(
  `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope)
   VALUES ($1, 'google', NULL, $2, 'gmail.readonly')`, [userId, encrypt('ref_tok')]
);
```

- [ ] **Step 8: Run all tests**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest --no-coverage
```
Expected: all pass

- [ ] **Step 9: Commit**

```bash
git add src/db/migrations/002_gmail.sql src/services/tokenCrypto.js \
        src/models/oauthToken.js tests/services/tokenCrypto.test.js \
        tests/routes/gmail.test.js
git commit -m "security: encrypt OAuth refresh_token at rest using AES-256-GCM"
```

---

## Phase E — CSRF Hardening

### Task 9: Gmail OAuth — replace raw user ID in state param with server-side CSRF token

**Schema change:** New file `018_gmail_state_store.sql` — this genuinely is a new table, not an edit to an existing one.

**Files:**
- Create: `api/src/db/migrations/018_gmail_state_store.sql`
- Modify: `api/src/services/gmailClient.js`
- Modify: `api/src/routes/gmail.js`
- Modify: `api/tests/routes/gmail.test.js`

- [ ] **Step 1: Create `018_gmail_state_store.sql`**

```sql
CREATE TABLE gmail_oauth_states (
  token      TEXT        PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes'
);

CREATE INDEX idx_gmail_oauth_states_expires ON gmail_oauth_states(expires_at);
```

Apply to test DB (append to existing schema — no full reset needed here since it's additive):

```bash
psql postgres://test:test@localhost:5432/expense_tracker_test \
  -f /Users/dangnguyen/curious-trio/api/src/db/migrations/018_gmail_state_store.sql
```

- [ ] **Step 2: Write failing tests**

The existing mock uses `mockReturnValue` (synchronous). `getAuthUrl` becomes async — update the mock to `mockResolvedValue`. Update the existing callback test (line 91) which passes `state=${userId}` directly; replace with a DB-inserted state token.

In `api/tests/routes/gmail.test.js`:

```js
// Update the existing mock at top of file:
getAuthUrl: jest.fn().mockResolvedValue('https://accounts.google.com/o/oauth2/auth?state=test-csrf-token'),

// Add to beforeEach cleanup:
await db.query(`DELETE FROM gmail_oauth_states WHERE user_id = $1`, [userId]);

// Update the existing callback test — replace state=${userId} with a pre-inserted state token:
it('saves token, returns Gmail connected page', async () => {
  await db.query(
    `INSERT INTO gmail_oauth_states (token, user_id) VALUES ('valid-csrf-token', $1)`, [userId]
  );
  exchangeCode.mockResolvedValue({ accessToken: null, refreshToken: 'new_refresh', expiresAt: null, scope: 'gmail.readonly' });

  const res = await request(app).get('/gmail/callback?code=auth_code_123&state=valid-csrf-token');
  expect(res.status).toBe(200);
  expect(res.text).toContain('Gmail connected');

  // State token should be consumed
  const stateRow = await db.query(`SELECT * FROM gmail_oauth_states WHERE token = 'valid-csrf-token'`);
  expect(stateRow.rows).toHaveLength(0);
});

// Add new CSRF rejection test:
it('GET /gmail/callback returns 400 for unknown state token', async () => {
  exchangeCode.mockResolvedValue({ accessToken: null, refreshToken: 'r', expiresAt: null, scope: '' });
  const res = await request(app).get('/gmail/callback?code=code&state=not-a-real-token');
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/invalid|expired/i);
});
```

- [ ] **Step 3: Run to confirm new/updated tests fail**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest tests/routes/gmail.test.js --no-coverage
```
Expected: FAIL

- [ ] **Step 4: Update `api/src/services/gmailClient.js` — make `getAuthUrl` async, store CSRF token**

Add at top: `const crypto = require('crypto'); const db = require('../db');`

Replace `getAuthUrl`:

```js
async function getAuthUrl(userId) {
  const stateToken = crypto.randomUUID();
  await db.query(
    `INSERT INTO gmail_oauth_states (token, user_id) VALUES ($1, $2)`, [stateToken, userId]
  );
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    prompt: 'consent',
    state: stateToken,
  });
}
```

- [ ] **Step 5: Update `api/src/routes/gmail.js`**

In `GET /gmail/auth` — await the now-async function:
```js
const url = await getAuthUrl(user.id);
res.json({ url });
```

Replace the callback handler:
```js
router.get('/callback', async (req, res, next) => {
  try {
    const { code, state: stateToken } = req.query;
    if (!code || !stateToken) return res.status(400).json({ error: 'Missing code or state' });

    const stateRow = await db.query(
      `DELETE FROM gmail_oauth_states
       WHERE token = $1 AND expires_at > NOW()
       RETURNING user_id`,
      [stateToken]
    );
    if (!stateRow.rows.length) {
      return res.status(400).json({ error: 'Invalid or expired state token' });
    }

    const userId = stateRow.rows[0].user_id;
    const tokens = await exchangeCode(code);
    await OAuthToken.upsert({ userId, ...tokens });
    res.send('<html><body><h2>Gmail connected!</h2><p>You can close this tab.</p></body></html>');
  } catch (err) { next(err); }
});
```

Add `const db = require('../db');` at the top of `gmail.js` if not already present.

- [ ] **Step 6: Run all tests**

```bash
cd /Users/dangnguyen/curious-trio/api && npx jest --no-coverage
```
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/018_gmail_state_store.sql src/services/gmailClient.js \
        src/routes/gmail.js tests/routes/gmail.test.js
git commit -m "security: replace raw user ID in Gmail OAuth state param with server-side CSRF token"
```

---

## Deployment Checklist (pre-launch)

Since there's no production data, deployment is a clean reset:

```bash
# 1. Set env vars in Render:
#    CORS_ALLOWED_ORIGINS, EMAIL_HASH_SECRET, TOKEN_ENCRYPTION_KEY

# 2. Reset the production DB and apply the full schema
dropdb <prod_db> && createdb <prod_db>
for f in api/src/db/migrations/*.sql; do
  psql $DATABASE_URL -f "$f"
done
```

That's it. No re-encryption script. No backfill queries. No ordered migration sequencing.
