# Auth Migration: Auth0 → Supabase Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Auth0 with native Google + Apple Sign-In via Supabase Auth, across the mobile app and API, with zero disruption to existing user and expense data.

**Architecture:** The mobile app uses `@react-native-google-signin/google-signin` and `expo-apple-authentication` to obtain identity tokens natively, exchanges them with Supabase Auth via `signInWithIdToken()`, then passes the resulting Supabase access token to the Express API. The API verifies tokens using the Supabase HS256 JWT secret instead of Auth0's RS256 JWKS endpoint.

**Tech Stack:** Supabase JS v2, `@react-native-google-signin/google-signin`, `expo-apple-authentication`, `@react-native-async-storage/async-storage`, `jsonwebtoken` (already in API), Expo SDK 55, EAS Build.

**Spec:** `docs/superpowers/specs/2026-03-22-auth-migration-auth0-to-supabase.md`

---

## Pre-flight: Supabase Dashboard Setup (MANUAL — do before any code)

> These steps must be completed by a human in the Supabase dashboard. All code tasks depend on these being done first.

- [ ] **Step 1: Enable Supabase Auth**
  - Go to your Supabase project → Authentication → click Enable
  - Confirm the Auth section is now active

- [ ] **Step 2: Add Google OAuth provider**
  - Authentication → Providers → Google → Enable
  - Client ID: `<GOOGLE_WEB_CLIENT_ID>` (from `api/.env`)
  - Client Secret: `<GOOGLE_CLIENT_SECRET>` (from `api/.env`)
  - Save

- [ ] **Step 3: Add Apple OAuth provider**
  - Authentication → Providers → Apple → Enable
  - You need: Apple Developer Team ID, Service ID, Key ID, and the `.p8` private key
  - (Requires Apple Developer account — get from developer.apple.com → Certificates, Identifiers & Profiles)
  - Save

- [ ] **Step 4: Add redirect URLs (precautionary)**
  - Authentication → URL Configuration → Redirect URLs
  - Add: `adlo://` and `exp://`

- [ ] **Step 5: Copy credentials — you'll need these in later tasks**
  - `SUPABASE_URL`: Project Settings → API → Project URL
  - `SUPABASE_ANON_KEY`: Project Settings → API → anon/public key
  - `SUPABASE_JWT_SECRET`: Project Settings → API → JWT Secret (**private — API only, never in mobile bundle**)

- [ ] **Step 6: Get iOS Google Client ID from Google Cloud Console**
  - Go to console.cloud.google.com → your project → APIs & Services → Credentials
  - You need TWO client IDs:
    - **Web client ID** (already exists): `<GOOGLE_WEB_CLIENT_ID>` — used in `GoogleSignin.configure({ webClientId })` and Supabase
    - **iOS client ID** (create if it doesn't exist): Application type = iOS, Bundle ID = `com.curioustrio.expensetracker`
  - The **reversed iOS client ID** looks like: `com.googleusercontent.apps.XXXXXXXXXX` — needed for `app.json` URL scheme and `GoogleSignin.configure({ iosClientId })`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `api/src/db/migrations/010_rename_auth0_id.sql` | Create | Rename `users.auth0_id` → `users.provider_uid` |
| `api/src/middleware/auth.js` | Modify | Replace JWKS/RS256 with HS256 JWT secret |
| `api/tests/middleware/auth.test.js` | Modify | Update mocks for HS256, `req.userId` |
| `api/tests/routes/*.test.js` (all 8) | Modify | Update auth mock + SQL column references |
| `api/src/models/user.js` | Modify | Rename column refs, rename/add methods |
| `api/src/routes/users.js` | Modify | Email-match upsert on sync, update me |
| `api/src/routes/households.js` | Modify | `req.auth0Id` → `req.userId`, `findByAuth0Id` → `findByProviderUid` |
| `api/src/routes/expenses.js` | Modify | Same rename |
| `api/src/routes/budgets.js` | Modify | Same rename |
| `api/src/routes/push.js` | Modify | Same rename |
| `api/src/routes/gmail.js` | Modify | Same rename |
| `api/src/routes/categories.js` | Modify | Same rename |
| `api/src/routes/recurring.js` | Modify | Same rename |
| `api/.env` | Modify | Remove Auth0 vars, add `SUPABASE_JWT_SECRET` (gitignored, no commit) |
| `mobile/package.json` | Modify | Remove `react-native-auth0`, add Supabase + Google + Apple + AsyncStorage deps |
| `mobile/app.json` | Modify | Add Apple entitlement, Apple plugin, Google URL scheme |
| `mobile/eas.json` | Modify | Swap Auth0 env vars for Supabase + Google env vars |
| `mobile/.env.local` | Modify | Swap Auth0 vars for Supabase + Google vars (gitignored, no commit) |
| `mobile/lib/supabase.js` | Create | Supabase client singleton with AsyncStorage |
| `mobile/lib/auth.js` | Create | `signInWithGoogle`, `signInWithApple`, `signOut` helpers |
| `mobile/services/api.js` | Modify | Replace `SecureStore` token fetch with `supabase.auth.getSession()` |
| `mobile/app/login.js` | Modify | Replace Auth0 button with Google + Apple buttons |
| `mobile/app/_layout.js` | Modify | Replace `Auth0Provider`/`useAuth0` with `onAuthStateChange` |

---

## Task 1: Database migration — rename `auth0_id` → `provider_uid`

**Files:**
- Create: `api/src/db/migrations/010_rename_auth0_id.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 010_rename_auth0_id.sql
ALTER TABLE users RENAME COLUMN auth0_id TO provider_uid;
```

- [ ] **Step 2: Run the migration against the Supabase DB**

```bash
cd api
psql "$DATABASE_URL" -f src/db/migrations/010_rename_auth0_id.sql
```

Expected output: `ALTER TABLE`

- [ ] **Step 3: Verify the column was renamed**

```bash
psql "$DATABASE_URL" -c "\d users"
```

Expected: column list shows `provider_uid` — `auth0_id` no longer present.

- [ ] **Step 4: Commit**

```bash
git add api/src/db/migrations/010_rename_auth0_id.sql
git commit -m "feat: rename users.auth0_id to provider_uid for Supabase migration"
```

---

## Task 2: API — update auth middleware

**Files:**
- Modify: `api/src/middleware/auth.js`
- Modify: `api/tests/middleware/auth.test.js`

- [ ] **Step 1: Write the failing test**

Replace the contents of `api/tests/middleware/auth.test.js`:

```js
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const { authenticate } = require('../../src/middleware/auth');

describe('authenticate middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when no Authorization header', async () => {
    const req = { headers: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for non-Bearer authorization', async () => {
    const req = { headers: { authorization: 'Basic abc123' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('sets req.userId from decoded sub when token is valid', async () => {
    jwt.verify.mockReturnValue({ sub: 'supabase-uuid-123' });

    const req = { headers: { authorization: 'Bearer valid-token' } };
    const res = {};
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(req.userId).toBe('supabase-uuid-123');
    expect(next).toHaveBeenCalled();
    expect(jwt.verify).toHaveBeenCalledWith(
      'valid-token',
      process.env.SUPABASE_JWT_SECRET,
      { algorithms: ['HS256'] }
    );
  });

  it('returns 401 when token is invalid', async () => {
    jwt.verify.mockImplementation(() => { throw new Error('invalid signature'); });

    const req = { headers: { authorization: 'Bearer bad-token' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd api
npx jest tests/middleware/auth.test.js --no-coverage
```

Expected: FAIL (old middleware uses RS256 JWKS, sets `req.auth0Id` not `req.userId`)

- [ ] **Step 3: Replace `api/src/middleware/auth.js`**

```js
const jwt = require('jsonwebtoken');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    // SUPABASE_JWT_SECRET: raw HS256 secret from
    // Supabase Dashboard → Settings → API → JWT Secret
    // NOT the anon key or service role key.
    const decoded = jwt.verify(
      token,
      process.env.SUPABASE_JWT_SECRET,
      { algorithms: ['HS256'] }
    );
    req.userId = decoded.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { authenticate };
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest tests/middleware/auth.test.js --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 5: Remove `jwks-rsa` dependency**

```bash
cd api && npm uninstall jwks-rsa
```

- [ ] **Step 6: Commit**

```bash
git add api/src/middleware/auth.js api/tests/middleware/auth.test.js api/package.json api/package-lock.json
git commit -m "feat: replace Auth0 JWKS middleware with Supabase HS256 JWT verification"
```

---

## Task 3: API — update all route test files for new column name and auth mock

All 8 route test files in `api/tests/routes/` have two types of references that must be updated:
1. The `authenticate` mock sets `req.auth0Id` → must become `req.userId`
2. Inline SQL strings use `auth0_id` column and `auth0_id` values → must become `provider_uid`
3. `households.test.js` calls `User.findOrCreate({ auth0Id: ... })` → must become `User.findOrCreateByProviderUid({ providerUid: ... })`

**Files:** `api/tests/routes/budgets.test.js`, `categories.test.js`, `expenses.test.js`, `gmail.test.js`, `households.test.js`, `push.test.js`, `recurring.test.js`, `users.test.js`

- [ ] **Step 1: Run all route tests to establish current baseline**

```bash
cd api && npx jest tests/routes/ --no-coverage
```

Note which tests pass and fail before changes.

- [ ] **Step 2: Replace auth mock and SQL in all 7 non-users route test files**

For each of: `budgets.test.js`, `categories.test.js`, `expenses.test.js`, `gmail.test.js`, `push.test.js`, `recurring.test.js`

Replace the mock line:
```js
req.auth0Id = 'auth0|test-xxx';   // OLD
```
With:
```js
req.userId = 'supabase-test-uuid-xxx';   // NEW — use a plain UUID-style string
```

Replace all inline SQL references — for example, in `budgets.test.js`:
```sql
-- OLD
INSERT INTO users (auth0_id, name, email, household_id) VALUES ($1, ...) ON CONFLICT (auth0_id) ...
UPDATE users SET household_id = $1 WHERE auth0_id = 'auth0|test-budget-user'
-- NEW
INSERT INTO users (provider_uid, name, email, household_id) VALUES ($1, ...) ON CONFLICT (provider_uid) ...
UPDATE users SET household_id = $1 WHERE provider_uid = 'supabase-test-uuid-budget'
```

Apply the same pattern to every `auth0_id` string and every `auth0|test-xxx` literal in these 6 files.

- [ ] **Step 3: Update `households.test.js` — more extensive changes**

`households.test.js` has the same SQL and mock changes as above, plus two direct model calls that must be updated:

Find lines like (around lines 231 and 268):
```js
await User.findOrCreate({ auth0Id: TEST_AUTH0_ID_JOINER, name: 'Joiner', email: 'joiner@test.com' });
```

Replace with:
```js
await User.findOrCreateByProviderUid({ providerUid: TEST_AUTH0_ID_JOINER, name: 'Joiner', email: 'joiner@test.com' });
```

Also rename the constants to be clearer:
```js
// OLD
const TEST_AUTH0_ID = 'test-auth0-households-owner';
const TEST_AUTH0_ID_JOINER = 'test-auth0-households-joiner';
// NEW
const TEST_AUTH0_ID = 'supabase-test-uuid-households-owner';
const TEST_AUTH0_ID_JOINER = 'supabase-test-uuid-households-joiner';
```

Update `mockAuth0Id` variable (used to switch which user the middleware mock impersonates) — rename to `mockUserId` and update the mock:
```js
// OLD
let mockAuth0Id = TEST_AUTH0_ID;
jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => { req.auth0Id = mockAuth0Id; next(); }
}));
// NEW
let mockUserId = TEST_AUTH0_ID;
jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => { req.userId = mockUserId; next(); }
}));
```

And update every `mockAuth0Id = ...` assignment to `mockUserId = ...` throughout the file.

- [ ] **Step 4: Note on `users.test.js`**

`users.test.js` is fully replaced in Task 4 — skip it here.

- [ ] **Step 5: Run route tests to confirm they pass**

```bash
cd api && npx jest tests/routes/ --no-coverage --testPathIgnorePatterns='users.test.js'
```

Expected: same pass/fail state as the baseline from Step 1 (or better)

- [ ] **Step 6: Commit**

```bash
git add api/tests/routes/
git commit -m "test: update route test files for provider_uid column rename and Supabase auth mock"
```

---

## Task 4: API — update user model

**Files:**
- Modify: `api/src/models/user.js`

- [ ] **Step 1: Run route tests to confirm they fail (red)**

After Task 3 updated the route test SQL and mocks, they now call `User.findOrCreateByProviderUid` and `User.findByProviderUid` — which don't exist yet on the old model.

```bash
cd api && npx jest tests/routes/ --no-coverage --testPathIgnorePatterns='users.test.js'
```

Expected: FAIL with errors like `User.findByProviderUid is not a function`

- [ ] **Step 2: Replace the contents of `api/src/models/user.js`**

```js
const db = require('../db');

// Upsert by provider_uid.
async function findOrCreateByProviderUid({ providerUid, name, email }) {
  const result = await db.query(
    `INSERT INTO users (provider_uid, name, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider_uid)
     DO UPDATE SET
       name = COALESCE(EXCLUDED.name, users.name),
       email = COALESCE(EXCLUDED.email, users.email)
     RETURNING id, provider_uid, name, email, household_id, created_at`,
    [providerUid, name || null, email || null]
  );
  return result.rows[0];
}

async function findByProviderUid(providerUid) {
  const result = await db.query(
    'SELECT id, provider_uid, name, email, household_id, created_at FROM users WHERE provider_uid = $1',
    [providerUid]
  );
  return result.rows[0] || null;
}

async function findByEmail(email) {
  const result = await db.query(
    'SELECT id, provider_uid, name, email, household_id, created_at FROM users WHERE email = $1',
    [email]
  );
  return result.rows[0] || null;
}

async function findById(id) {
  const result = await db.query(
    'SELECT id, provider_uid, name, email, household_id, created_at FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

async function updateProviderUid(userId, providerUid) {
  const result = await db.query(
    `UPDATE users SET provider_uid = $1 WHERE id = $2
     RETURNING id, provider_uid, name, email, household_id, created_at`,
    [providerUid, userId]
  );
  return result.rows[0] || null;
}

async function setHouseholdId(userId, householdId) {
  const result = await db.query(
    `UPDATE users SET household_id = $1 WHERE id = $2
     RETURNING id, provider_uid, name, email, household_id, created_at`,
    [householdId, userId]
  );
  return result.rows[0] || null;
}

module.exports = {
  findOrCreateByProviderUid,
  findByProviderUid,
  findByEmail,
  findById,
  updateProviderUid,
  setHouseholdId,
};
```

- [ ] **Step 3: Run route tests to confirm they pass (green)**

```bash
cd api && npx jest tests/routes/ --no-coverage --testPathIgnorePatterns='users.test.js'
```

Expected: same pass/fail state as pre-migration baseline (or better)

- [ ] **Step 4: Commit**

```bash
git add api/src/models/user.js
git commit -m "feat: update user model for Supabase provider_uid, add findByEmail and updateProviderUid"
```

---

## Task 5: API — update `/users` routes

**Files:**
- Modify: `api/src/routes/users.js`
- Modify: `api/tests/routes/users.test.js`

- [ ] **Step 1: Write updated tests in `api/tests/routes/users.test.js`**

```js
const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

const TEST_UUID = 'supabase-test-uuid-123';
const TEST_EMAIL = 'dang@test.com';

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = 'supabase-test-uuid-123';
    next();
  },
}));

afterAll(() => db.pool.end());

async function cleanup() {
  await db.query(
    'DELETE FROM users WHERE provider_uid = $1 OR email = $2',
    [TEST_UUID, TEST_EMAIL]
  );
}

describe('POST /users/sync', () => {
  beforeEach(cleanup);

  it('creates a new user when no email or provider_uid match exists', async () => {
    const res = await request(app)
      .post('/users/sync')
      .send({ name: 'Dang Nguyen', email: TEST_EMAIL });

    expect(res.status).toBe(200);
    expect(res.body.provider_uid).toBe(TEST_UUID);
    expect(res.body.name).toBe('Dang Nguyen');
    expect(res.body.email).toBe(TEST_EMAIL);
  });

  it('updates provider_uid when email match found (migration path)', async () => {
    await db.query(
      "INSERT INTO users (provider_uid, name, email) VALUES ('old-auth0-id', 'Dang Nguyen', $1)",
      [TEST_EMAIL]
    );

    const res = await request(app)
      .post('/users/sync')
      .send({ name: 'Dang Nguyen', email: TEST_EMAIL });

    expect(res.status).toBe(200);
    expect(res.body.provider_uid).toBe(TEST_UUID);
    expect(res.body.email).toBe(TEST_EMAIL);
  });

  it('returns existing user by provider_uid when no email provided (Apple re-auth)', async () => {
    await db.query(
      'INSERT INTO users (provider_uid, name, email) VALUES ($1, $2, $3)',
      [TEST_UUID, 'Dang Nguyen', TEST_EMAIL]
    );

    const res = await request(app)
      .post('/users/sync')
      .send({ name: 'Dang Nguyen' }); // no email

    expect(res.status).toBe(200);
    expect(res.body.provider_uid).toBe(TEST_UUID);
  });

  it('creates new user when no email and no provider_uid match', async () => {
    const res = await request(app)
      .post('/users/sync')
      .send({ name: 'New Apple User' });

    expect(res.status).toBe(200);
    expect(res.body.provider_uid).toBe(TEST_UUID);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/users/sync')
      .send({ email: TEST_EMAIL });

    expect(res.status).toBe(400);
  });
});

describe('GET /users/me', () => {
  beforeEach(cleanup);

  it('returns the current user', async () => {
    await db.query(
      'INSERT INTO users (provider_uid, name, email) VALUES ($1, $2, $3)',
      [TEST_UUID, 'Dang Nguyen', TEST_EMAIL]
    );

    const res = await request(app).get('/users/me');

    expect(res.status).toBe(200);
    expect(res.body.provider_uid).toBe(TEST_UUID);
  });

  it('returns 404 when user not found', async () => {
    const res = await request(app).get('/users/me');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd api && npx jest tests/routes/users.test.js --no-coverage
```

Expected: FAIL (routes still use old model methods)

- [ ] **Step 3: Replace `api/src/routes/users.js`**

```js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.post('/sync', authenticate, async (req, res, next) => {
  try {
    const { name, email } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    if (email) {
      // Email provided: check for existing user by email (migration path from Auth0)
      const existingByEmail = await User.findByEmail(email);
      if (existingByEmail) {
        const updated = await User.updateProviderUid(existingByEmail.id, req.userId);
        return res.json(updated);
      }
      // No email match — check by provider_uid, then create
      const existingByUid = await User.findByProviderUid(req.userId);
      if (existingByUid) return res.json(existingByUid);
      const created = await User.findOrCreateByProviderUid({ providerUid: req.userId, name, email });
      return res.json(created);
    } else {
      // No email (Apple re-auth after first sign-in)
      const existing = await User.findByProviderUid(req.userId);
      if (existing) return res.json(existing);
      const created = await User.findOrCreateByProviderUid({ providerUid: req.userId, name, email: null });
      return res.json(created);
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest tests/routes/users.test.js --no-coverage
```

Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/users.js api/tests/routes/users.test.js
git commit -m "feat: update users routes for Supabase auth with email-match upsert on sync"
```

---

## Task 6: API — rename `req.auth0Id` → `req.userId` in all other routes

**Files:**
- Modify: `api/src/routes/households.js`, `expenses.js`, `budgets.js`, `push.js`, `gmail.js`, `categories.js`, `recurring.js`

- [ ] **Step 1: Confirm scope — run a grep for all occurrences**

```bash
cd api
grep -rn "req\.auth0Id\|findByAuth0Id" src/routes/ --include="*.js"
```

Note the count.

- [ ] **Step 2: Replace in all routes**

```bash
cd api/src/routes
sed -i '' 's/req\.auth0Id/req.userId/g' households.js expenses.js budgets.js push.js gmail.js categories.js recurring.js
sed -i '' 's/User\.findByAuth0Id/User.findByProviderUid/g' households.js expenses.js budgets.js push.js gmail.js categories.js recurring.js
```

- [ ] **Step 3: Verify no old references remain**

```bash
grep -rn "req\.auth0Id\|findByAuth0Id" api/src/ --include="*.js"
```

Expected: no output

- [ ] **Step 4: Run all API tests**

```bash
cd api && npx jest --no-coverage
```

Expected: all tests passing

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/
git commit -m "feat: rename req.auth0Id → req.userId and findByAuth0Id → findByProviderUid across all routes"
```

---

## Task 7: API — update environment variables

**Files:**
- Modify: `api/.env` (gitignored — no commit)

- [ ] **Step 1: Update local `api/.env`**

Remove these lines:
```
AUTH0_DOMAIN=dev-666j65ue5kugpg5f.us.auth0.com
AUTH0_AUDIENCE=https://api.expense-tracker.app
```

Add this line:
```
SUPABASE_JWT_SECRET=<paste JWT secret from Supabase Dashboard → Settings → API → JWT Secret>
```

> Note: `api/.env` is gitignored. No commit is needed for this step — the Render dashboard is the source of truth for production env vars.

- [ ] **Step 2: Update Render environment variables**

In the Render dashboard for the API service:
- Delete: `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`
- Add: `SUPABASE_JWT_SECRET` = (JWT secret from Supabase dashboard)

- [ ] **Step 3: Deploy API to Render**

```bash
cd /Users/dangnguyen/curious-trio
git push origin main
```

Wait for Render auto-deploy. Check logs that service starts cleanly.

- [ ] **Step 4: Smoke test the deployed API**

```bash
curl -s https://adlo-1j98.onrender.com/users/me | python3 -m json.tool
```

Expected: `{"error": "Missing authorization header"}`

---

## Task 8: Mobile — install packages and update config

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/app.json`
- Modify: `mobile/eas.json`
- Modify: `mobile/.env.local` (gitignored — no commit)

- [ ] **Step 1: Install new dependencies and remove Auth0**

```bash
cd mobile
npm install @supabase/supabase-js @react-native-google-signin/google-signin expo-apple-authentication @react-native-async-storage/async-storage
npm uninstall react-native-auth0
```

> Note: `expo-secure-store` is kept in `package.json` and `app.json` plugins — it is still required by the Supabase JS client's internal session storage on React Native.

- [ ] **Step 2: Update `mobile/app.json`**

Replace with the following (note: `expo-secure-store` plugin stays):

```json
{
  "expo": {
    "name": "Adlo",
    "slug": "expense-tracker",
    "scheme": "adlo",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "light",
    "splash": {
      "image": "./assets/splash-icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#0a0a0a"
    },
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.curioustrio.expensetracker",
      "usesAppleSignIn": true,
      "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false,
        "CFBundleURLTypes": [
          {
            "CFBundleURLSchemes": ["com.googleusercontent.apps.REPLACE_WITH_IOS_CLIENT_ID"]
          }
        ]
      }
    },
    "android": {
      "adaptiveIcon": {
        "backgroundColor": "#0a0a0a",
        "foregroundImage": "./assets/android-icon-foreground.png",
        "backgroundImage": "./assets/android-icon-background.png",
        "monochromeImage": "./assets/android-icon-monochrome.png"
      },
      "package": "com.anonymous.expensetracker"
    },
    "web": {
      "favicon": "./assets/favicon.png"
    },
    "plugins": [
      "expo-router",
      "expo-secure-store",
      "expo-apple-authentication"
    ],
    "extra": {
      "router": {},
      "eas": {
        "projectId": "e3eaf656-8f47-4549-a70f-79590f31d782"
      }
    }
  }
}
```

Replace `REPLACE_WITH_IOS_CLIENT_ID` with the reversed iOS client ID from Google Cloud Console (e.g. `336238140966-xxxxxxxxxxxx`).

- [ ] **Step 3: Update `mobile/eas.json` production env**

```json
{
  "cli": {
    "version": ">= 18.4.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {
      "autoIncrement": true,
      "env": {
        "EXPO_PUBLIC_SUPABASE_URL": "https://qybozqtugexupxqavtjj.supabase.co",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "<anon key from Supabase dashboard>",
        "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID": "<GOOGLE_WEB_CLIENT_ID>",
        "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID": "<iOS client ID from Google Cloud Console>",
        "EXPO_PUBLIC_API_URL": "https://adlo-1j98.onrender.com"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

- [ ] **Step 4: Update `mobile/.env.local`**

> Note: `.env.local` is gitignored. This file is for local development only.
> The `EXPO_PUBLIC_API_URL` is set to `localhost` for local dev — this is intentional and differs from the production URL in `eas.json`.

```
EXPO_PUBLIC_SUPABASE_URL=https://qybozqtugexupxqavtjj.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key from Supabase dashboard>
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<GOOGLE_WEB_CLIENT_ID>
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<iOS client ID from Google Cloud Console>
EXPO_PUBLIC_API_URL=http://localhost:3002
```

- [ ] **Step 5: Commit config changes**

> `.env.local` is gitignored and is not committed.

```bash
cd mobile
git add package.json package-lock.json app.json eas.json
git commit -m "feat: install Supabase + Google/Apple auth packages, update app.json for Apple Sign-In"
```

---

## Task 9: Mobile — create `lib/supabase.js`

**Files:**
- Create: `mobile/lib/supabase.js`

- [ ] **Step 1: Create `mobile/lib/` directory**

```bash
mkdir -p /Users/dangnguyen/curious-trio/mobile/lib
```

- [ ] **Step 2: Create `mobile/lib/supabase.js`**

```js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
```

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/supabase.js
git commit -m "feat: add Supabase client singleton with AsyncStorage persistence"
```

---

## Task 10: Mobile — create `lib/auth.js`

**Files:**
- Create: `mobile/lib/auth.js`

> Note: Native sign-in flows (Google account picker, Apple Face ID sheet) cannot be unit tested without a device. Testing for this module is covered in the end-to-end smoke test in Task 14.

- [ ] **Step 1: Create `mobile/lib/auth.js`**

```js
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { supabase } from './supabase';

GoogleSignin.configure({
  // webClientId: Web OAuth 2.0 Client ID — used by Supabase to verify the token
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  // iosClientId: iOS OAuth 2.0 Client ID — separate credential, enables native account picker
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
});

export { statusCodes };

export async function signInWithGoogle() {
  await GoogleSignin.hasPlayServices();
  const userInfo = await GoogleSignin.signIn();
  const idToken = userInfo.data?.idToken;
  if (!idToken) throw new Error('No ID token from Google');

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });
  if (error) throw error;
  return data.session;
}

export async function signInWithApple() {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  await supabase.auth.signOut();
  try {
    await GoogleSignin.revokeAccess();
    await GoogleSignin.signOut();
  } catch {
    // Not signed in via Google — ignore
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add mobile/lib/auth.js
git commit -m "feat: add signInWithGoogle, signInWithApple, signOut helpers"
```

---

## Task 11: Mobile — update `services/api.js`

**Files:**
- Modify: `mobile/services/api.js`

- [ ] **Step 1: Replace `mobile/services/api.js`**

```js
import { supabase } from '../lib/supabase';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3002';

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function request(path, options = {}) {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    // If 401, the session is no longer valid — sign out so _layout.js redirects to login
    if (res.status === 401) {
      await supabase.auth.signOut();
    }
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
};
```

- [ ] **Step 2: Commit**

```bash
git add mobile/services/api.js
git commit -m "feat: replace SecureStore token fetch with supabase.auth.getSession() in api service"
```

---

## Task 12: Mobile — update `app/login.js`

**Files:**
- Modify: `mobile/app/login.js`

- [ ] **Step 1: Replace `mobile/app/login.js`**

```js
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { signInWithGoogle, signInWithApple, statusCodes } from '../lib/auth';
import { useState } from 'react';

export default function LoginScreen() {
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingApple, setLoadingApple] = useState(false);

  async function handleGoogleSignIn() {
    setLoadingGoogle(true);
    try {
      await signInWithGoogle();
      // _layout.js onAuthStateChange handles routing after sign-in
    } catch (e) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED) return; // user dismissed
      Alert.alert('Sign in failed', 'Please try again.');
    } finally {
      setLoadingGoogle(false);
    }
  }

  async function handleAppleSignIn() {
    setLoadingApple(true);
    try {
      await signInWithApple();
      // _layout.js onAuthStateChange handles routing after sign-in
    } catch (e) {
      if (e.code === 'ERR_CANCELED') return; // user dismissed
      Alert.alert('Sign in failed', 'Please try again.');
    } finally {
      setLoadingApple(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Adlo</Text>
      <Text style={styles.subtitle}>Track spending together.</Text>

      <TouchableOpacity
        style={styles.googleBtn}
        onPress={handleGoogleSignIn}
        disabled={loadingGoogle}
      >
        {loadingGoogle
          ? <ActivityIndicator color="#000" />
          : <Text style={styles.googleBtnText}>Sign in with Google</Text>}
      </TouchableOpacity>

      {Platform.OS === 'ios' && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={12}
          style={styles.appleBtn}
          onPress={handleAppleSignIn}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 32, justifyContent: 'center' },
  title: { fontSize: 32, color: '#fff', fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#888', fontSize: 16, marginBottom: 48 },
  googleBtn: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  googleBtnText: { color: '#000', fontWeight: '700', fontSize: 16 },
  appleBtn: { width: '100%', height: 52 },
});
```

- [ ] **Step 2: Commit**

```bash
git add mobile/app/login.js
git commit -m "feat: replace Auth0 sign-in with native Google + Apple sign-in buttons"
```

---

## Task 13: Mobile — update `app/_layout.js`

**Files:**
- Modify: `mobile/app/_layout.js`

- [ ] **Step 1: Replace `mobile/app/_layout.js`**

```js
import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Platform } from 'react-native';
import { useEffect } from 'react';
import { api } from '../services/api';
import { supabase } from '../lib/supabase';

function AppNavigator() {
  const router = useRouter();

  // Push notification registration (independent of auth)
  useEffect(() => {
    async function registerForPushNotifications() {
      try {
        const { status: existing } = await Notifications.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') return;

        const tokenData = await Notifications.getExpoPushTokenAsync();
        const platform = Platform.OS === 'ios' ? 'ios' : 'android';
        await api.post('/push/register', { token: tokenData.data, platform });
      } catch {
        // Non-fatal
      }
    }
    registerForPushNotifications();
  }, []);

  // Auth state listener
  useEffect(() => {
    async function checkHousehold(session) {
      try {
        const me = await api.post('/users/sync', {
          name: session.user.user_metadata?.full_name || session.user.email || 'User',
          email: session.user.email || null,
        });
        if (!me?.household_id) {
          router.replace('/onboarding');
        } else {
          router.replace('/(tabs)/summary');
        }
      } catch {
        // Non-fatal sync failure — stay on current screen
      }
    }

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        checkHousehold(session);
      } else if (event === 'SIGNED_OUT' || !session) {
        router.replace('/login');
      }
    });

    // Check session on mount (handles app reopen with persisted session)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/login');
      } else {
        checkHousehold(session);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: '#0a0a0a' },
      headerTintColor: '#f5f5f5',
      headerTitleStyle: { fontWeight: '500', fontSize: 15 },
      headerShadowVisible: false,
      contentStyle: { backgroundColor: '#0a0a0a' },
    }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="confirm" options={{ presentation: 'modal', title: 'Confirm Expense', headerBackTitle: 'Summary' }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="categories" options={{ title: 'Category Details', headerBackTitle: 'Settings' }} />
      <Stack.Screen name="accounts" options={{ title: 'Accounts', headerBackTitle: 'Settings' }} />
      <Stack.Screen name="expense/[id]" options={{ title: '', headerBackTitle: 'Feed' }} />
      <Stack.Screen name="join" options={{ title: 'Join Household', headerBackTitle: 'Back' }} />
    </Stack>
  );
}

export default function RootLayout() {
  // Auth0Provider wrapper is removed — Supabase manages session internally
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppNavigator />
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add mobile/app/_layout.js
git commit -m "feat: replace Auth0Provider/useAuth0 with Supabase onAuthStateChange in root layout"
```

---

## Task 14: Push to origin and trigger EAS build

- [ ] **Step 1: Push all commits**

```bash
cd /Users/dangnguyen/curious-trio
git push origin main
```

- [ ] **Step 2: Trigger EAS production build**

```bash
cd mobile
eas build --platform ios --profile production
```

Monitor output. Expected: build succeeds, no missing env var errors.

- [ ] **Step 3: Submit to TestFlight**

```bash
eas submit --platform ios --latest
```

---

## Task 15: End-to-end smoke test (on device / TestFlight)

> Native auth flows (Google account picker, Apple Face ID) can only be verified on a real device. These are the acceptance criteria for the migration.

- [ ] Login screen shows both "Sign in with Google" and "Sign in with Apple" buttons
- [ ] Tapping Google opens native account picker (not a browser)
- [ ] Completing Google sign-in routes to Summary tab
- [ ] Tapping Apple opens native Face ID / Apple ID sheet
- [ ] Completing Apple sign-in routes to Summary tab
- [ ] Closing and reopening the app skips login (session persisted via AsyncStorage)
- [ ] Expenses load correctly (API JWT validation working with Supabase token)
- [ ] Signing out from Settings returns to login screen
- [ ] Signing back in preserves household association (expense history intact)
- [ ] A second household member can sign in independently and see shared household expenses
