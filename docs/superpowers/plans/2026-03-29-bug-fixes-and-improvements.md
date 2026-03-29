# Bug Fixes & Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 9 bugs and UX issues across the Adlo expense tracker covering parser improvements, confirm screen editing, scan error messages, location search, individual budgets, anonymous auth, onboarding skip, and past-month navigation.

**Architecture:** Changes span three layers — API (Node.js/Express + PostgreSQL), mobile (React Native/Expo), and one new DB migration. Tasks are ordered to avoid conflicts: shared files (`confirm.js`, `expenses.js`) are touched in a deliberate sequence. Bug 9 (auth) must precede Bug 8 (onboarding). Budget migration must precede budget API changes.

**Tech Stack:** Node.js/Express, PostgreSQL 15, React Native/Expo SDK 55, Supabase Auth, `expo-location`, Apple MapKit Web Services API, Jest + Supertest (API tests)

---

## File Map

| File | Change |
|------|--------|
| `api/src/routes/expenses.js` | Modify — add `category_name` to `/parse` and `/scan` responses; add `?month` filter to list endpoints |
| `api/src/services/nlParser.js` | Modify — add `items` field to system prompt |
| `api/src/routes/budgets.js` | Modify — replace `requireHousehold` with `requireUser`; user-scoped GET/PUT/DELETE; `?month` param |
| `api/src/models/budgetSetting.js` | Modify — `upsert`/`remove`/`findByUser`/`findByHousehold` rewritten for user scope |
| `api/src/db/migrations/019_budget_user_scope.sql` | Create — add `user_id`, drop old constraint, add new constraints |
| `api/src/services/mapkitService.js` | Create — MapKit JWT generation + `searchPlace` |
| `api/src/routes/places.js` | Create — `GET /places/search` |
| `api/src/index.js` | Modify — mount `/places` router |
| `api/.env.example` | Modify — add MapKit env vars |
| `api/src/routes/households.js` | Modify — anonymous user guard on mutation endpoints |
| `mobile/app/(tabs)/add.js` | Modify — targeted scan error messages |
| `mobile/app/confirm.js` | Modify — editable Amount/Date fields; MapKit location auto-populate on mount |
| `mobile/app/login.js` | Modify — "Continue without account" anonymous sign-in |
| `mobile/app/_layout.js` | Modify — anonymous user handling in `checkHousehold` |
| `mobile/app/onboarding.js` | Modify — "I'm tracking solo" skip; anonymous-aware button visibility |
| `mobile/hooks/useExpenses.js` | Modify — accept `month` argument |
| `mobile/hooks/useBudget.js` | Modify — accept `month` argument |
| `mobile/hooks/useHouseholdExpenses.js` | Modify — accept `month` argument |
| `mobile/app/(tabs)/summary.js` | Modify — `selectedMonth` state; tappable month label; month picker modal |
| `mobile/app/(tabs)/index.js` | Modify — `selectedMonth` state; month picker; fix `SpendHeader` date prop |
| `api/tests/routes/expenses.test.js` | Modify — add `category_name` assertions for parse and scan |
| `api/tests/services/nlParser.test.js` | Modify — add items extraction test |
| `api/tests/routes/budgets.test.js` | Modify — rewrite for user-scoped budgets; add solo-user and `?month` tests |
| `api/tests/routes/places.test.js` | Create — places search route tests |
| `api/tests/services/mapkitService.test.js` | Create — `searchPlace` unit test |
| `api/tests/routes/households.test.js` | Modify — add anonymous user 403 test |

---

## Task 1: Parser — Category Name in Parse/Scan Response (Bug 1)

**Files:**
- Modify: `api/src/routes/expenses.js`
- Modify: `api/tests/routes/expenses.test.js`

- [ ] **Step 1: Write failing tests**

First, add `assignCategory.mockReset()` and `parseExpense.mockReset()` to `beforeEach` in `expenses.test.js` (currently only `parseReceipt.mockReset()` is called). This prevents mock state leaking between tests:

```js
beforeEach(() => {
  parseReceipt.mockReset();
  parseExpense.mockReset();
  assignCategory.mockReset();
});
```

Then add after the existing `POST /expenses/parse` describe block:

```js
it('returns category_name alongside category_id in parse response', async () => {
  parseExpense.mockResolvedValueOnce({
    merchant: "Trader Joe's", amount: 84.17, date: '2026-03-20', notes: null,
  });
  // Insert a real category so the route can look up its name
  const catRes = await db.query(
    `INSERT INTO categories (name, household_id) VALUES ('Groceries', $1) RETURNING id, name`,
    [householdId]
  );
  const catId = catRes.rows[0].id;
  assignCategory.mockResolvedValueOnce({ category_id: catId, source: 'memory', confidence: 4 });

  const res = await request(app)
    .post('/expenses/parse')
    .send({ input: '84.17 trader joes', today: '2026-03-20' });

  expect(res.status).toBe(200);
  expect(res.body.category_id).toBe(catId);
  expect(res.body.category_name).toBe('Groceries');
  expect(res.body.category_source).toBe('memory');

  await db.query('DELETE FROM categories WHERE id = $1', [catId]);
});

it('returns category_name: null when no category matched', async () => {
  parseExpense.mockResolvedValueOnce({
    merchant: 'Unknown Shop', amount: 10, date: '2026-03-20', notes: null,
  });
  assignCategory.mockResolvedValueOnce({ category_id: null, source: 'claude', confidence: 0 });

  const res = await request(app)
    .post('/expenses/parse')
    .send({ input: '10 unknown shop', today: '2026-03-20' });

  expect(res.status).toBe(200);
  expect(res.body.category_id).toBeNull();
  expect(res.body.category_name).toBeNull();
});
```

Also add a test for `/expenses/scan` that asserts `category_name` is returned (mirror of the parse test, using `parseReceipt.mockResolvedValueOnce`).

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/dangnguyen/curious-trio && npm test -- --testPathPattern="expenses.test" 2>&1 | tail -20
```

Expected: tests fail because `category_name` is not in the response.

- [ ] **Step 3: Fix the `/parse` handler**

In `api/src/routes/expenses.js`, find the `/parse` handler (around line 38–46). After `assignCategory`, add the name lookup and update `res.json`:

```js
const { category_id, source, confidence } = await assignCategory({
  merchant: parsed.merchant,
  description: parsed.description,
  householdId: user?.household_id,
  categories,
});
const matchedCat = categories.find(c => c.id === category_id);
res.json({
  ...parsed,
  category_id,
  category_name: matchedCat?.name || null,
  category_source: source,
  category_confidence: confidence,
});
```

- [ ] **Step 4: Fix the `/scan` handler**

In the same file, find the `/scan` handler (around line 60–70). Apply the identical change — add `matchedCat` lookup and include `category_name` and `category_source` in the response.

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd /Users/dangnguyen/curious-trio && npm test -- --testPathPattern="expenses.test" 2>&1 | tail -20
```

Expected: all expenses tests pass.

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/expenses.js api/tests/routes/expenses.test.js
git commit -m "fix: include category_name in /expenses/parse and /scan responses"
```

---

## Task 2: Parser — NL Items Extraction (Bug 7)

**Files:**
- Modify: `api/src/services/nlParser.js`
- Modify: `api/tests/services/nlParser.test.js`

- [ ] **Step 1: Write a failing test**

In `api/tests/services/nlParser.test.js`, add a test for item extraction. First read the file to understand the existing mock pattern, then add:

```js
it('extracts items, merchant, and card_label from a rich input string', async () => {
  const mockCompletion = JSON.stringify({
    merchant: 'Nordstrom',
    description: null,
    amount: 125,
    date: '2026-03-29',
    notes: null,
    payment_method: 'credit',
    card_label: 'amex platinum',
    items: [{ description: 'Nike running shoes', amount: 125 }],
  });
  complete.mockResolvedValueOnce(mockCompletion);

  const result = await parseExpense('125 nike running shoes from nordstrom using amex platinum', '2026-03-29');
  expect(result.merchant).toBe('Nordstrom');
  expect(result.payment_method).toBe('credit');
  expect(result.card_label).toBe('amex platinum');
  expect(result.items).toHaveLength(1);
  expect(result.items[0].description).toBe('Nike running shoes');
});
```

- [ ] **Step 2: Write a test that actually fails before the implementation**

The mock-based test above will pass even without changing the prompt. Instead, add a test that asserts the system prompt string itself contains the word `items` — this test will fail before the update and pass after:

```js
it('system prompt documents the items field', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../src/services/nlParser.js'),
    'utf8'
  );
  expect(src).toContain('items');
});
```

- [ ] **Step 3: Run to confirm it fails**

```bash
cd /Users/dangnguyen/curious-trio && npm test -- --testPathPattern="nlParser.test" 2>&1 | tail -20
```

Expected: the `items` prompt test fails; other tests pass.

- [ ] **Step 5: Update the system prompt in `nlParser.js`**

In `api/src/services/nlParser.js`, add `items` to the `SYSTEM_PROMPT`:

1. In the field list, add after `card_label`:
```
- items (array or null): individual line items if specific products/services are named, each as { "description": string, "amount": number or null }. Set to null if no specific items are mentioned beyond the overall description.
```

2. Add a new example before the last line:
```
- "125 nike running shoes from nordstrom using amex platinum" → { merchant: "Nordstrom", description: null, amount: 125, items: [{ description: "Nike running shoes", amount: 125 }], payment_method: "credit", card_label: "amex platinum", ... }
- "50 dinner and drinks at nobu with two glasses of wine" → { merchant: "Nobu", description: "dinner and drinks", amount: 50, items: [{ description: "dinner", amount: null }, { description: "drinks (2 glasses wine)", amount: null }], ... }
```

- [ ] **Step 6: Run all nlParser tests**

```bash
cd /Users/dangnguyen/curious-trio && npm test -- --testPathPattern="nlParser.test" 2>&1 | tail -20
```

Expected: all pass including the prompt-contents test.

- [ ] **Step 7: Commit**

```bash
git add api/src/services/nlParser.js api/tests/services/nlParser.test.js
git commit -m "feat: add items extraction to NL expense parser"
```

---

## Task 3: Confirm Screen — Editable Amount & Date (Bug 6)

**Files:**
- Modify: `mobile/app/confirm.js`

- [ ] **Step 1: Add `amountText` state**

In `confirm.js`, find the existing `useState` declarations near the top of `ConfirmScreen`. Add:

```js
const [amountText, setAmountText] = useState(String(Math.abs(parsed?.amount ?? 0)));
```

- [ ] **Step 2: Replace Amount `ConfirmField` with editable row**

Find the line:
```js
<ConfirmField label="Amount" value={`$${Number(expense.amount).toFixed(2)}`} />
```

Replace with:
```js
<View style={styles.editableRow}>
  <Text style={styles.editableLabel}>AMOUNT</Text>
  <TextInput
    style={styles.editableInput}
    value={amountText}
    onChangeText={value => {
      setAmountText(value);
      setExpense(prev => ({
        ...prev,
        amount: isRefund
          ? -Math.abs(parseFloat(value) || 0)
          : Math.abs(parseFloat(value) || 0),
      }));
    }}
    keyboardType="decimal-pad"
    placeholder="0.00"
    placeholderTextColor="#444"
  />
</View>
```

- [ ] **Step 3: Update `handleRefundToggle` to use `amountText`**

Find the existing `handleRefundToggle` function and replace its body:

```js
function handleRefundToggle(value) {
  setIsRefund(value);
  setExpense(prev => ({
    ...prev,
    amount: value
      ? -Math.abs(parseFloat(amountText) || 0)
      : Math.abs(parseFloat(amountText) || 0),
  }));
}
```

- [ ] **Step 4: Replace Date `ConfirmField` with editable row**

Find the line:
```js
<ConfirmField label="Date" value={expense.date} />
```

Replace with:
```js
<View style={styles.editableRow}>
  <Text style={styles.editableLabel}>DATE</Text>
  <TextInput
    style={styles.editableInput}
    value={expense.date || ''}
    onChangeText={value => setExpense(prev => ({ ...prev, date: value }))}
    placeholder="YYYY-MM-DD"
    placeholderTextColor="#444"
    autoCapitalize="none"
    autoCorrect={false}
  />
</View>
```

- [ ] **Step 5: Verify `TextInput` is already imported**

Check that `TextInput` is in the existing import from `react-native` at line 1 — it already is. No import change needed.

- [ ] **Step 6: Manual smoke test**

Run the app and navigate to confirm screen via the parser. Verify:
- Amount field is editable; changing it updates the displayed value
- Tapping refund toggle after editing amount uses the edited value, not the original
- Date field is editable
- Confirming an edited expense saves the updated values

- [ ] **Step 7: Commit**

```bash
git add mobile/app/confirm.js
git commit -m "fix: make Amount and Date editable on confirm screen"
```

---

## Task 4: Scan Receipt Error Handling (Bug 3)

**Files:**
- Modify: `mobile/app/(tabs)/add.js`

- [ ] **Step 1: Update the `handleScan` catch block**

In `add.js`, find the `catch (err)` block inside `handleScan` (currently a single `Alert.alert('Scan failed', ...)`). Replace it:

```js
} catch (err) {
  const msg = err?.message || '';
  if (msg.includes('image too large')) {
    Alert.alert('Image too large', 'Receipt image is too large. Try a closer crop.');
  } else if (msg.includes('Could not parse receipt')) {
    Alert.alert('Could not read receipt', "Couldn't read that receipt. Try better lighting or enter manually.");
  } else {
    Alert.alert('Scan failed', 'Could not reach the server. Check your connection and try again.');
  }
}
```

- [ ] **Step 2: Manual smoke test**

Test three cases (or simulate by temporarily throwing errors):
1. Submit an image larger than 1MB → verify "Image too large" alert
2. Submit a non-receipt image → verify "Couldn't read that receipt" alert
3. Kill the API server and scan → verify "Could not reach the server" alert

- [ ] **Step 3: Commit**

```bash
git add mobile/app/(tabs)/add.js
git commit -m "fix: show targeted error messages for scan receipt failures"
```

---

## Task 5: Anonymous Auth & Onboarding Guard (Bugs 9 & 8)

**Files:**
- Modify: `mobile/app/login.js`
- Modify: `mobile/app/_layout.js`
- Modify: `api/src/routes/households.js`
- Modify: `mobile/app/onboarding.js`
- Modify: `api/tests/routes/households.test.js`

### Part A — Backend household guard

- [ ] **Step 1: Write failing test for anonymous guard**

In `api/tests/routes/households.test.js`, add a describe block at the end:

```js
describe('Anonymous user guard', () => {
  // Override the mock to simulate an anonymous user
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns 403 when anonymous user tries to create a household', async () => {
    // Manually decode req to simulate is_anonymous claim
    // The auth middleware mock sets req.userId; we need to also set req.isAnonymous
    // We test this by checking the route code path — see implementation notes below
  });
});
```

Note: Because the auth middleware is fully mocked in tests, the cleanest approach is to check that the `households.js` route reads `req.isAnonymous` and returns 403. Add a second mock variant for this test file that sets `req.isAnonymous = true`.

Restructure the test file's mock to support both cases:

```js
let mockIsAnonymous = false;
jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = 'auth0|test-household-user';
    req.isAnonymous = mockIsAnonymous;
    next();
  },
}));
```

Then add:
```js
describe('Anonymous user guard', () => {
  it('returns 403 on POST / when req.isAnonymous is true', async () => {
    mockIsAnonymous = true;
    const res = await request(app).post('/households').send({ name: 'Test' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Create an account/);
    mockIsAnonymous = false;
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /Users/dangnguyen/curious-trio && npm test -- --testPathPattern="households.test" 2>&1 | tail -20
```

Expected: new test fails (no anonymous guard exists yet).

- [ ] **Step 3: Update `auth.js` middleware to expose `isAnonymous`**

In `api/src/middleware/auth.js`, inside the `authenticate` function, after setting `req.userId = decoded.sub`, add:

```js
req.isAnonymous = decoded.is_anonymous === true;
```

- [ ] **Step 4: Add anonymous guard to households routes**

In `api/src/routes/households.js`, add a helper after the imports:

```js
function rejectAnonymous(req, res) {
  if (req.isAnonymous) {
    res.status(403).json({ error: 'Create an account to join a household' });
    return true;
  }
  return false;
}
```

Add `if (rejectAnonymous(req, res)) return;` as the first line of the handler bodies for: `POST /` (create), `POST /invites` (send invite), `POST /invites/:token/accept` (join), `POST /me/leave`, `DELETE /me/members/:memberId`.

- [ ] **Step 5: Run household tests**

```bash
cd /Users/dangnguyen/curious-trio && npm test -- --testPathPattern="households.test" 2>&1 | tail -20
```

Expected: all pass including new anonymous guard test.

- [ ] **Step 6: Commit backend guard**

```bash
git add api/src/middleware/auth.js api/src/routes/households.js api/tests/routes/households.test.js
git commit -m "feat: block anonymous users from household mutation endpoints"
```

### Part B — Mobile anonymous auth

- [ ] **Step 7: Add "Continue without account" to `login.js`**

In `mobile/app/login.js`, add state and handler:

```js
const [loadingAnon, setLoadingAnon] = useState(false);

async function handleContinueAnonymously() {
  setLoadingAnon(true);
  try {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    // _layout.js onAuthStateChange handles routing
  } catch (e) {
    Alert.alert('Sign in failed', 'Please try again.');
  } finally {
    setLoadingAnon(false);
  }
}
```

Add the import at the top: `import { supabase } from '../lib/supabase';`

Add the button below the Apple button (or Google button on Android):

```js
<TouchableOpacity
  style={styles.anonBtn}
  onPress={handleContinueAnonymously}
  disabled={loadingAnon}
>
  {loadingAnon
    ? <ActivityIndicator color="#888" />
    : <Text style={styles.anonBtnText}>Continue without account</Text>}
</TouchableOpacity>
```

Add style:
```js
anonBtn: { marginTop: 24, alignItems: 'center', padding: 12 },
anonBtnText: { color: '#555', fontSize: 14 },
```

- [ ] **Step 8: Update `_layout.js` `checkHousehold` for anonymous users**

In `mobile/app/_layout.js`, find the `checkHousehold` function. Update the `/users/sync` call:

```js
async function checkHousehold(session) {
  try {
    const isAnon = session.user.is_anonymous === true;
    const me = await api.post('/users/sync', {
      name: isAnon ? 'Anonymous' : (session.user.user_metadata?.full_name || session.user.email || 'User'),
      email: isAnon ? null : (session.user.email || null),
    }, { token: session.access_token });
    if (!me?.household_id) {
      router.replace('/onboarding');
    } else {
      router.replace('/(tabs)/summary');
    }
  } catch (err) {
    console.error('[checkHousehold] sync failed:', err?.message ?? err);
    router.replace('/onboarding');
  }
}
```

- [ ] **Step 9: Update `onboarding.js` for skip + anonymous awareness**

In `mobile/app/onboarding.js`:

1. Add imports at top:
```js
import { useEffect, useState } from 'react'; // add useState if not present
import { supabase } from '../lib/supabase';
```

2. Add state inside the component:
```js
const [isAnonymous, setIsAnonymous] = useState(false);

useEffect(() => {
  supabase.auth.getSession().then(({ data: { session } }) => {
    setIsAnonymous(session?.user?.is_anonymous === true);
  });
}, []);
```

3. In the `mode === null` view (the initial screen), update the JSX to be anonymous-aware:

```js
if (mode === null) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome</Text>
      {isAnonymous ? (
        <>
          <Text style={styles.subtitle}>You're tracking solo. Create an account to join or create a household.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/login')}>
            <Text style={styles.primaryText}>Create an account →</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.replace('/(tabs)/summary')}>
            <Text style={styles.skipText}>Continue solo</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.subtitle}>Set up your household to start tracking expenses together.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setMode('create')}>
            <Text style={styles.primaryText}>Create a household</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setMode('join')}>
            <Text style={styles.secondaryText}>Join with invite code</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.replace('/(tabs)/summary')}>
            <Text style={styles.skipText}>I'm tracking solo</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}
```

4. Add style:
```js
skipText: { color: '#555', textAlign: 'center', marginTop: 16, fontSize: 13 },
```

- [ ] **Step 10: Manual smoke test**

1. Sign out, tap "Continue without account" → verify lands on onboarding with only "Continue solo" / "Create an account" shown
2. Tap "Continue solo" → verify lands on summary
3. Try adding an expense as anonymous user → verify it saves correctly
4. Sign out, sign in with Google → verify onboarding shows full household options + "I'm tracking solo"
5. Tap "I'm tracking solo" → verify lands on summary

- [ ] **Step 11: Commit**

```bash
git add mobile/app/login.js mobile/app/_layout.js mobile/app/onboarding.js
git commit -m "feat: add anonymous sign-in and onboarding skip for solo users"
```

---

## Task 6: Budget DB Migration + Model Rewrite (Bug 5, Part 1)

**Files:**
- Create: `api/src/db/migrations/019_budget_user_scope.sql`
- Modify: `api/src/models/budgetSetting.js`

- [ ] **Step 1: Write the migration file**

```sql
-- api/src/db/migrations/019_budget_user_scope.sql
-- Rekey budget_settings from household scope to user scope.

ALTER TABLE budget_settings
  ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE budget_settings
  ALTER COLUMN household_id DROP NOT NULL;

ALTER TABLE budget_settings
  DROP CONSTRAINT budget_settings_household_category_uq;

ALTER TABLE budget_settings
  ADD CONSTRAINT budget_settings_user_category_uq
  UNIQUE (user_id, category_id);

ALTER TABLE budget_settings
  ADD CONSTRAINT budget_settings_scope_check
  CHECK (user_id IS NOT NULL OR household_id IS NOT NULL);
```

- [ ] **Step 2: Run the migration**

```bash
psql $DATABASE_URL -f api/src/db/migrations/019_budget_user_scope.sql
```

Expected: `ALTER TABLE` × 3, `DROP CONSTRAINT`, `ADD CONSTRAINT` × 2 — no errors.

- [ ] **Step 3: Verify schema**

```bash
psql $DATABASE_URL -c "\d budget_settings"
```

Expected: `user_id uuid` column present; `household_id` no longer `NOT NULL`; new constraint names visible.

- [ ] **Step 4: Rewrite `budgetSetting.js`**

Replace the entire file contents:

```js
const db = require('../db');

// Upsert a per-user budget setting (total or per-category).
// categoryId: null for total monthly budget.
async function upsert({ userId, categoryId = null, monthlyLimit }) {
  const result = await db.query(
    `INSERT INTO budget_settings (user_id, category_id, monthly_limit)
     VALUES ($1, $2, $3)
     ON CONFLICT ON CONSTRAINT budget_settings_user_category_uq DO UPDATE
       SET monthly_limit = EXCLUDED.monthly_limit, updated_at = NOW()
     RETURNING *`,
    [userId, categoryId, monthlyLimit]
  );
  return result.rows[0];
}

// All budget settings for a single user.
async function findByUser(userId) {
  const result = await db.query(
    'SELECT * FROM budget_settings WHERE user_id = $1 ORDER BY category_id NULLS FIRST',
    [userId]
  );
  return result.rows;
}

// Aggregate budget settings across all members of a household.
// Returns rows shaped like { category_id, monthly_limit } where monthly_limit
// is the SUM of all members' limits for that category (null category_id = total).
async function findByHousehold(householdId) {
  const result = await db.query(
    `SELECT bs.category_id, SUM(bs.monthly_limit) AS monthly_limit
     FROM budget_settings bs
     JOIN users u ON bs.user_id = u.id
     WHERE u.household_id = $1
     GROUP BY bs.category_id
     ORDER BY bs.category_id NULLS FIRST`,
    [householdId]
  );
  return result.rows;
}

// Remove a user's category budget (or total budget if categoryId is null).
async function remove({ userId, categoryId = null }) {
  const result = await db.query(
    `DELETE FROM budget_settings
     WHERE user_id = $1
       AND (category_id = $2 OR (category_id IS NULL AND $2 IS NULL))
     RETURNING *`,
    [userId, categoryId]
  );
  return result.rows[0] || null;
}

module.exports = { upsert, findByUser, findByHousehold, remove };
```

- [ ] **Step 5: Rewrite `budgetSetting.test.js` to match new model**

The existing test file uses `auth0_id` (old column name, now `provider_uid`) and `householdId` in all `upsert`/`remove` calls. Replace `api/tests/models/budgetSetting.test.js` entirely:

```js
const db = require('../../src/db');
const BudgetSetting = require('../../src/models/budgetSetting');

let testUserId;
let testCategoryId;

beforeAll(async () => {
  const uResult = await db.query(
    `INSERT INTO users (provider_uid, name, email)
     VALUES ('test|budget-model-user', 'Budget Model User', 'bmodel@test.com')
     ON CONFLICT (provider_uid) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  testUserId = uResult.rows[0].id;

  const cResult = await db.query(
    `INSERT INTO categories (name) VALUES ('Budget Test Cat') RETURNING id`
  );
  testCategoryId = cResult.rows[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM budget_settings WHERE user_id = $1`, [testUserId]);
  await db.query(`DELETE FROM categories WHERE id = $1`, [testCategoryId]);
  await db.query(`DELETE FROM users WHERE provider_uid = 'test|budget-model-user'`);
});

afterEach(async () => {
  await db.query(`DELETE FROM budget_settings WHERE user_id = $1`, [testUserId]);
});

describe('BudgetSetting.upsert', () => {
  it('creates a total budget (categoryId null)', async () => {
    const result = await BudgetSetting.upsert({ userId: testUserId, categoryId: null, monthlyLimit: 1000 });
    expect(result).toBeDefined();
    expect(result.user_id).toBe(testUserId);
    expect(result.category_id).toBeNull();
    expect(parseFloat(result.monthly_limit)).toBe(1000);
  });

  it('creates a category budget', async () => {
    const result = await BudgetSetting.upsert({ userId: testUserId, categoryId: testCategoryId, monthlyLimit: 300 });
    expect(result).toBeDefined();
    expect(result.category_id).toBe(testCategoryId);
    expect(parseFloat(result.monthly_limit)).toBe(300);
  });

  it('updates on conflict', async () => {
    await BudgetSetting.upsert({ userId: testUserId, categoryId: null, monthlyLimit: 500 });
    const updated = await BudgetSetting.upsert({ userId: testUserId, categoryId: null, monthlyLimit: 750 });
    expect(parseFloat(updated.monthly_limit)).toBe(750);
    const rows = await db.query(`SELECT * FROM budget_settings WHERE user_id = $1 AND category_id IS NULL`, [testUserId]);
    expect(rows.rows.length).toBe(1);
  });
});

describe('BudgetSetting.findByUser', () => {
  it('returns all settings for user', async () => {
    await BudgetSetting.upsert({ userId: testUserId, categoryId: null, monthlyLimit: 800 });
    await BudgetSetting.upsert({ userId: testUserId, categoryId: testCategoryId, monthlyLimit: 200 });
    const settings = await BudgetSetting.findByUser(testUserId);
    expect(settings.length).toBe(2);
    expect(settings[0].category_id).toBeNull(); // total first
  });
});

describe('BudgetSetting.remove', () => {
  it('deletes the row and returns it', async () => {
    await BudgetSetting.upsert({ userId: testUserId, categoryId: testCategoryId, monthlyLimit: 200 });
    const removed = await BudgetSetting.remove({ userId: testUserId, categoryId: testCategoryId });
    expect(removed).toBeDefined();
    expect(removed.user_id).toBe(testUserId);
    const check = await db.query(`SELECT * FROM budget_settings WHERE user_id = $1 AND category_id = $2`, [testUserId, testCategoryId]);
    expect(check.rows.length).toBe(0);
  });

  it('returns null when not found', async () => {
    const result = await BudgetSetting.remove({ userId: '00000000-0000-0000-0000-000000000000', categoryId: null });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 6: Run budget model tests to confirm they pass**

```bash
cd /Users/dangnguyen/curious-trio && npm test -- --testPathPattern="budgetSetting.test" 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add api/src/db/migrations/019_budget_user_scope.sql api/src/models/budgetSetting.js api/tests/models/budgetSetting.test.js
git commit -m "feat: migration 019 — rekey budget_settings to user scope"
```

---

## Task 7: Budget API Redesign (Bug 5, Part 2)

**Files:**
- Modify: `api/src/routes/budgets.js`
- Modify: `api/tests/routes/budgets.test.js`
- Modify: `api/tests/models/budgetSetting.test.js`

- [ ] **Step 1: Rewrite `budgets.test.js` for user-scoped budgets**

The test file needs significant changes. Replace `beforeAll`/`afterAll`/`afterEach` to create a solo user (no household) and a household with two members:

```js
const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = 'test|budget-user-solo';
    next();
  },
}));

let soloUserId;
let householdId;
let member1Id;
let categoryId;

beforeAll(async () => {
  // Solo user (no household)
  const u1 = await db.query(
    `INSERT INTO users (provider_uid, name) VALUES ('test|budget-user-solo', 'Solo User')
     ON CONFLICT (provider_uid) DO UPDATE SET name = 'Solo User' RETURNING id`
  );
  soloUserId = u1.rows[0].id;

  // Household with a member (same user for simplicity)
  const hh = await db.query(`INSERT INTO households (name) VALUES ('Budget HH') RETURNING id`);
  householdId = hh.rows[0].id;
  const u2 = await db.query(
    `INSERT INTO users (provider_uid, name, household_id)
     VALUES ('test|budget-member-1', 'Member 1', $1) RETURNING id`,
    [householdId]
  );
  member1Id = u2.rows[0].id;

  const cat = await db.query(
    `INSERT INTO categories (name, household_id) VALUES ('Groceries', $1) RETURNING id`,
    [householdId]
  );
  categoryId = cat.rows[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM budget_settings WHERE user_id IN ($1, $2)`, [soloUserId, member1Id]);
  await db.query(`DELETE FROM expenses WHERE user_id IN ($1, $2)`, [soloUserId, member1Id]);
  await db.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
  await db.query(`DELETE FROM users WHERE provider_uid IN ('test|budget-user-solo', 'test|budget-member-1')`);
  await db.query(`DELETE FROM households WHERE id = $1`, [householdId]);
});

afterEach(async () => {
  await db.query(`DELETE FROM budget_settings WHERE user_id IN ($1, $2)`, [soloUserId, member1Id]);
  await db.query(`DELETE FROM expenses WHERE user_id IN ($1, $2)`, [soloUserId, member1Id]);
});
```

Then add tests:

```js
describe('GET /budgets — solo user', () => {
  it('returns null total and empty categories when no settings', async () => {
    const res = await request(app).get('/budgets');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeNull();
    expect(res.body.categories).toEqual([]);
  });

  it('returns total budget with solo user spending', async () => {
    await db.query(
      `INSERT INTO budget_settings (user_id, category_id, monthly_limit) VALUES ($1, NULL, 500)`,
      [soloUserId]
    );
    const thisMonth = new Date().toISOString().slice(0, 7);
    await db.query(
      `INSERT INTO expenses (user_id, amount, date, source, status) VALUES ($1, 75, $2, 'manual', 'confirmed')`,
      [soloUserId, `${thisMonth}-15`]
    );

    const res = await request(app).get('/budgets');
    expect(res.status).toBe(200);
    expect(res.body.total.limit).toBe(500);
    expect(res.body.total.spent).toBe(75);
    expect(res.body.total.remaining).toBe(425);
  });
});

describe('PUT /budgets/total', () => {
  it('saves a budget for the solo user', async () => {
    const res = await request(app).put('/budgets/total').send({ monthly_limit: 1000 });
    expect(res.status).toBe(200);
    expect(Number(res.body.monthly_limit)).toBe(1000);
  });
});

describe('DELETE /budgets/category/:id', () => {
  it('deletes a category budget for the user', async () => {
    await db.query(
      `INSERT INTO budget_settings (user_id, category_id, monthly_limit) VALUES ($1, $2, 200)`,
      [soloUserId, categoryId]
    );
    const res = await request(app).delete(`/budgets/category/${categoryId}`);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/dangnguyen/curious-trio && npm test -- --testPathPattern="budgets.test" 2>&1 | tail -30
```

Expected: new tests fail because budget endpoints still require a household.

- [ ] **Step 3: Rewrite `budgets.js`**

Replace the entire `requireHousehold` function and all route handlers. Key changes:

```js
// Replace requireHousehold with requireUser
async function requireUser(req, res) {
  const user = await User.findByProviderUid(req.userId);
  if (!user) { res.status(401).json({ error: 'User not synced' }); return null; }
  return user;
}
```

Update `GET /budgets`:

```js
router.get('/', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const month = req.query.month || new Date().toISOString().slice(0, 7);

    if (user.household_id) {
      // Household path: aggregate across all members
      const settings = await BudgetSetting.findByHousehold(user.household_id);

      const spendResult = await db.query(
        `SELECT category_id, SUM(amount) as spent FROM expenses
         WHERE household_id = $1 AND status = 'confirmed' AND to_char(date, 'YYYY-MM') = $2
         GROUP BY category_id`,
        [user.household_id, month]
      );
      const spendByCategory = {};
      for (const row of spendResult.rows) {
        spendByCategory[row.category_id || '__total__'] = Number(row.spent);
      }
      const totalSpent = Object.values(spendByCategory).reduce((a, b) => a + b, 0);

      const parentSpendResult = await db.query(
        `SELECT COALESCE(c.parent_id, e.category_id) AS group_id, SUM(e.amount) AS spent
         FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
         WHERE e.household_id = $1 AND e.status = 'confirmed' AND to_char(e.date, 'YYYY-MM') = $2
         GROUP BY group_id`,
        [user.household_id, month]
      );
      const groupIds = parentSpendResult.rows.map(r => r.group_id).filter(Boolean);
      const catNames = {};
      if (groupIds.length > 0) {
        const catRes = await db.query('SELECT id, name FROM categories WHERE id = ANY($1)', [groupIds]);
        for (const row of catRes.rows) catNames[row.id] = row.name;
      }
      const by_parent = parentSpendResult.rows
        .filter(r => r.group_id)
        .map(r => {
          const spent = Number(r.spent);
          const setting = settings.find(s => s.category_id === r.group_id);
          const limit = setting ? Number(setting.monthly_limit) : null;
          return { group_id: r.group_id, name: catNames[r.group_id] || 'Unknown', spent, limit, remaining: limit !== null ? limit - spent : null };
        });

      const totalSetting = settings.find(s => s.category_id === null);
      const categorySummaries = settings
        .filter(s => s.category_id !== null)
        .map(s => {
          const spent = spendByCategory[s.category_id] || 0;
          return { id: s.category_id, limit: Number(s.monthly_limit), spent, remaining: Number(s.monthly_limit) - spent };
        });

      return res.json({
        total: totalSetting
          ? { limit: Number(totalSetting.monthly_limit), spent: totalSpent, remaining: Number(totalSetting.monthly_limit) - totalSpent }
          : null,
        categories: categorySummaries,
        by_parent,
      });
    } else {
      // Solo user path
      const settings = await BudgetSetting.findByUser(user.id);

      const spendResult = await db.query(
        `SELECT category_id, SUM(amount) as spent FROM expenses
         WHERE user_id = $1 AND status = 'confirmed' AND to_char(date, 'YYYY-MM') = $2
         GROUP BY category_id`,
        [user.id, month]
      );
      const spendByCategory = {};
      for (const row of spendResult.rows) {
        spendByCategory[row.category_id || '__total__'] = Number(row.spent);
      }
      const totalSpent = Object.values(spendByCategory).reduce((a, b) => a + b, 0);

      const totalSetting = settings.find(s => s.category_id === null);
      const categorySummaries = settings
        .filter(s => s.category_id !== null)
        .map(s => {
          const spent = spendByCategory[s.category_id] || 0;
          return { id: s.category_id, limit: Number(s.monthly_limit), spent, remaining: Number(s.monthly_limit) - spent };
        });

      return res.json({
        total: totalSetting
          ? { limit: Number(totalSetting.monthly_limit), spent: totalSpent, remaining: Number(totalSetting.monthly_limit) - totalSpent }
          : null,
        categories: categorySummaries,
        by_parent: [],
      });
    }
  } catch (err) { next(err); }
});
```

Update `PUT /budgets/total`:
```js
router.put('/total', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const { monthly_limit } = req.body;
    if (!monthly_limit || isNaN(Number(monthly_limit)) || Number(monthly_limit) <= 0) {
      return res.status(400).json({ error: 'monthly_limit must be a positive number' });
    }
    const setting = await BudgetSetting.upsert({ userId: user.id, categoryId: null, monthlyLimit: monthly_limit });
    res.json(setting);
  } catch (err) { next(err); }
});
```

Update `PUT /budgets/category/:id`:
```js
router.put('/category/:id', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const { monthly_limit } = req.body;
    if (!monthly_limit || isNaN(Number(monthly_limit)) || Number(monthly_limit) <= 0) {
      return res.status(400).json({ error: 'monthly_limit must be a positive number' });
    }
    const setting = await BudgetSetting.upsert({ userId: user.id, categoryId: req.params.id, monthlyLimit: monthly_limit });
    res.json(setting);
  } catch (err) { next(err); }
});
```

Update `DELETE /budgets/category/:id`:
```js
router.delete('/category/:id', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const removed = await BudgetSetting.remove({ userId: user.id, categoryId: req.params.id });
    if (!removed) return res.status(404).json({ error: 'Budget not found' });
    res.json(removed);
  } catch (err) { next(err); }
});
```

- [ ] **Step 4: Run all budget tests**

```bash
cd /Users/dangnguyen/curious-trio && npm test -- --testPathPattern="budget" 2>&1 | tail -30
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/budgets.js api/tests/routes/budgets.test.js api/tests/models/budgetSetting.test.js
git commit -m "feat: rewrite budget endpoints for individual user scope"
```

---

## Task 8: MapKit Places Service + API (Bug 2, Backend)

**Files:**
- Create: `api/src/services/mapkitService.js`
- Create: `api/src/routes/places.js`
- Modify: `api/src/index.js`
- Modify: `api/.env.example`
- Create: `api/tests/services/mapkitService.test.js`
- Create: `api/tests/routes/places.test.js`

- [ ] **Step 1: Write failing unit test for `searchPlace`**

```js
// api/tests/services/mapkitService.test.js
const { searchPlace } = require('../../src/services/mapkitService');

jest.mock('node-fetch');
const fetch = require('node-fetch');

it('returns top place result from MapKit search', async () => {
  process.env.APPLE_MAPS_KEY_ID = 'test-key-id';
  process.env.APPLE_MAPS_TEAM_ID = 'test-team-id';
  process.env.APPLE_MAPS_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIBBkfJQRNE0hFkV0x0b9kFpqMJUq3DnEJxMaHnq0fY8p\n-----END PRIVATE KEY-----\n';

  // Mock MapKit token endpoint
  fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ accessToken: 'mock-access-token', expiresInSeconds: 1800 }),
  });

  // Mock MapKit search endpoint
  fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      results: [{
        displayLines: ["Trader Joe's", '123 Main St, San Francisco, CA'],
        coordinate: { latitude: 37.7749, longitude: -122.4194 },
      }],
    }),
  });

  const result = await searchPlace("Trader Joe's", 37.775, -122.419);
  expect(result).not.toBeNull();
  expect(result.place_name).toBe("Trader Joe's");
  expect(result.mapkit_stable_id).toContain('37.');
});

it('returns null when no results found', async () => {
  fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ accessToken: 'mock-access-token', expiresInSeconds: 1800 }),
  });
  fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ results: [] }),
  });

  const result = await searchPlace('Nonexistent Place', 37.775, -122.419);
  expect(result).toBeNull();
});
```

- [ ] **Step 2: Install `node-fetch` if not present**

```bash
cd /Users/dangnguyen/curious-trio/api && grep '"node-fetch"' package.json || npm install node-fetch@2
```

Note: use `node-fetch@2` (CommonJS compatible) unless the project already uses v3+.

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd /Users/dangnguyen/curious-trio && npm test -- --testPathPattern="mapkitService.test" 2>&1 | tail -20
```

Expected: fails with "Cannot find module '../../src/services/mapkitService'".

- [ ] **Step 4: Create `mapkitService.js`**

```js
// api/src/services/mapkitService.js
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

const MAPKIT_TOKEN_URL = 'https://maps-api.apple.com/v1/token';
const MAPKIT_SEARCH_URL = 'https://maps-api.apple.com/v1/search';

let cachedToken = null;
let tokenExpiry = 0;

async function getMapKitToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken;

  const { APPLE_MAPS_KEY_ID, APPLE_MAPS_TEAM_ID, APPLE_MAPS_PRIVATE_KEY } = process.env;
  if (!APPLE_MAPS_KEY_ID || !APPLE_MAPS_TEAM_ID || !APPLE_MAPS_PRIVATE_KEY) {
    throw new Error('Apple Maps credentials not configured');
  }

  const now = Math.floor(Date.now() / 1000);
  const authJwt = jwt.sign(
    { iss: APPLE_MAPS_TEAM_ID, iat: now, exp: now + 1800 },
    APPLE_MAPS_PRIVATE_KEY,
    { algorithm: 'ES256', keyid: APPLE_MAPS_KEY_ID }
  );

  const res = await fetch(MAPKIT_TOKEN_URL, {
    headers: { Authorization: `Bearer ${authJwt}` },
  });
  if (!res.ok) throw new Error(`MapKit token request failed: ${res.status}`);
  const { accessToken, expiresInSeconds } = await res.json();

  cachedToken = accessToken;
  tokenExpiry = Date.now() + expiresInSeconds * 1000;
  return cachedToken;
}

async function searchPlace(query, lat, lng) {
  const token = await getMapKitToken();
  const url = new URL(MAPKIT_SEARCH_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('userLocation', `${lat},${lng}`);
  url.searchParams.set('limitToCountries', 'US');
  url.searchParams.set('resultTypeFilter', 'Poi');
  url.searchParams.set('lang', 'en-US');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;

  const data = await res.json();
  const top = data.results?.[0];
  if (!top) return null;

  const place_name = top.displayLines?.[0] || query;
  const address = top.displayLines?.slice(1).join(', ') || '';
  const { latitude, longitude } = top.coordinate || {};
  const mapkit_stable_id = latitude != null
    ? `${latitude.toFixed(4)},${longitude.toFixed(4)}`
    : null;

  return { place_name, address, mapkit_stable_id };
}

module.exports = { searchPlace };
```

- [ ] **Step 5: Run mapkitService tests**

```bash
cd /Users/dangnguyen/curious-trio && npm test -- --testPathPattern="mapkitService.test" 2>&1 | tail -20
```

Expected: both tests pass.

- [ ] **Step 6: Write failing places route test**

```js
// api/tests/routes/places.test.js
const request = require('supertest');
const app = require('../../src/index');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => { req.userId = 'auth0|test-user-123'; next(); },
}));
jest.mock('../../src/services/mapkitService');
const { searchPlace } = require('../../src/services/mapkitService');

describe('GET /places/search', () => {
  it('returns place result for valid query', async () => {
    searchPlace.mockResolvedValueOnce({
      place_name: "Trader Joe's",
      address: '123 Main St, SF, CA',
      mapkit_stable_id: '37.7749,-122.4194',
    });

    const res = await request(app)
      .get('/places/search')
      .query({ q: "Trader Joe's", lat: '37.775', lng: '-122.419' });

    expect(res.status).toBe(200);
    expect(res.body.result.place_name).toBe("Trader Joe's");
  });

  it('returns result: null when no place found', async () => {
    searchPlace.mockResolvedValueOnce(null);
    const res = await request(app)
      .get('/places/search')
      .query({ q: 'Nowhere', lat: '37.775', lng: '-122.419' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBeNull();
  });

  it('returns 400 when query params are missing', async () => {
    const res = await request(app).get('/places/search');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 7: Run to confirm failure**

```bash
cd /Users/dangnguyen/curious-trio && npm test -- --testPathPattern="places.test" 2>&1 | tail -20
```

Expected: fails (no route exists yet).

- [ ] **Step 8: Create `places.js` route**

```js
// api/src/routes/places.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { searchPlace } = require('../services/mapkitService');

router.use(authenticate);

router.get('/search', async (req, res, next) => {
  try {
    const { q, lat, lng } = req.query;
    if (!q || !lat || !lng) {
      return res.status(400).json({ error: 'q, lat, and lng are required' });
    }
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    if (isNaN(parsedLat) || isNaN(parsedLng)) {
      return res.status(400).json({ error: 'lat and lng must be numbers' });
    }
    const result = await searchPlace(q, parsedLat, parsedLng);
    res.json({ result });
  } catch (err) { next(err); }
});

module.exports = router;
```

- [ ] **Step 9: Mount router in `api/src/index.js`**

Find where other routers are mounted (e.g. `app.use('/expenses', ...)`) and add:
```js
const placesRouter = require('./routes/places');
app.use('/places', placesRouter);
```

- [ ] **Step 10: Add env vars to `.env.example`**

Add to `api/.env.example`:
```
APPLE_MAPS_KEY_ID=your-key-id
APPLE_MAPS_TEAM_ID=your-team-id
APPLE_MAPS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

- [ ] **Step 11: Run all places tests**

```bash
cd /Users/dangnguyen/curious-trio && npm test -- --testPathPattern="places.test" 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git add api/src/services/mapkitService.js api/src/routes/places.js api/src/index.js api/.env.example api/tests/services/mapkitService.test.js api/tests/routes/places.test.js
git commit -m "feat: add MapKit places search service and /places/search endpoint"
```

---

## Task 9: Location Auto-Populate in Confirm Screen (Bug 2, Frontend)

**Files:**
- Modify: `mobile/app/confirm.js`

Note: `confirm.js` was already modified in Task 3. Build on top of that version.

- [ ] **Step 1: Add location auto-populate on mount**

In `confirm.js`, add an import at the top:
```js
import * as Location from 'expo-location';
```

Inside `ConfirmScreen`, add a `useEffect` after the existing `useEffect` that fetches saved cards:

```js
useEffect(() => {
  if (!merchant?.trim()) return; // only auto-populate when merchant is known

  async function autoPopulateLocation() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = position.coords;

      const result = await api.get(
        `/places/search?q=${encodeURIComponent(merchant)}&lat=${latitude}&lng=${longitude}`
      );
      if (result?.result) {
        setLocationData(result.result);
      }
    } catch {
      // Non-fatal — location stays unpopulated, user can add manually
    }
  }

  autoPopulateLocation();
}, []); // run once on mount; merchant is captured from closure at parse time
```

- [ ] **Step 2: Manual smoke test**

1. Parse "50 trader joes" → confirm screen opens
2. Verify the LOCATION section auto-populates with the nearest Trader Joe's (not just an address)
3. Verify the user can still clear and re-pick location manually
4. Parse a description-only expense like "lunch 14" → verify location stays empty (no auto-populate)
5. Test with location permission denied → verify no crash, location stays empty

- [ ] **Step 3: Commit**

```bash
git add mobile/app/confirm.js
git commit -m "feat: auto-populate specific store location on confirm screen from merchant name"
```

---

## Task 10: Past Months Navigation (Bug 10)

**Files:**
- Modify: `mobile/hooks/useExpenses.js`
- Modify: `mobile/hooks/useBudget.js`
- Modify: `mobile/hooks/useHouseholdExpenses.js`
- Modify: `mobile/app/(tabs)/summary.js`
- Modify: `mobile/app/(tabs)/index.js`
- Modify: `api/src/routes/expenses.js`
- Modify: `api/src/routes/budgets.js`

### Part A — API month filter

- [ ] **Step 1: Capture `userId` in `expenses.test.js` `beforeAll` and write failing test**

The existing `beforeAll` in `expenses.test.js` does not capture `userId`. First add it:

```js
// Add alongside the existing householdId declaration at the top of the file
let userId;

// In beforeAll, after the existing user INSERT, capture the id:
const userRow = await db.query(
  `SELECT id FROM users WHERE provider_uid = 'auth0|test-user-123'`
);
userId = userRow.rows[0].id;
```

Then add the month filter test:

```js
describe('GET /expenses with ?month filter', () => {
  afterEach(async () => {
    await db.query(`DELETE FROM expenses WHERE merchant IN ('Jan Merchant', 'Feb Merchant')`);
  });

  it('returns only expenses from the specified month', async () => {
    await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
       VALUES ($1, $2, 'Jan Merchant', 10.00, '2026-01-15', 'manual', 'confirmed'),
              ($1, $2, 'Feb Merchant', 20.00, '2026-02-15', 'manual', 'confirmed')`,
      [userId, householdId]
    );

    const res = await request(app).get('/expenses?month=2026-01');
    expect(res.status).toBe(200);
    expect(res.body.every(e => String(e.date).startsWith('2026-01'))).toBe(true);
    expect(res.body.some(e => e.merchant === 'Jan Merchant')).toBe(true);
    expect(res.body.some(e => e.merchant === 'Feb Merchant')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/dangnguyen/curious-trio && npm test -- --testPathPattern="expenses.test" 2>&1 | grep -E "PASS|FAIL|month" | tail -10
```

- [ ] **Step 3: Add `?month` filter to `GET /expenses` and `GET /expenses/household`**

In `api/src/routes/expenses.js`, find `GET /` (around line 147):

```js
router.get('/', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    const { month } = req.query;
    const expenses = month
      ? await Expense.findByUser(user.id, { month })
      : await Expense.findByUser(user.id);
    res.json(expenses);
  } catch (err) { next(err); }
});
```

The current `Expense.findByUser` signature is `(userId, { limit = 50, offset = 0 } = {})`. Add `month` while preserving the existing options — do NOT drop `limit` and `offset`:

```js
async function findByUser(userId, { limit = 50, offset = 0, month } = {}) {
  const params = [userId, limit, offset];
  let monthClause = '';
  if (month) {
    params.push(month);
    monthClause = `AND to_char(e.date, 'YYYY-MM') = $${params.length}`;
  }
  const result = await db.query(
    `SELECT e.*,
            c.name  AS category_name,
            c.icon  AS category_icon,
            c.color AS category_color,
            pc.name AS category_parent_name,
            (SELECT COUNT(*) FROM expense_items WHERE expense_id = e.id)::int AS item_count
     FROM expenses e
     LEFT JOIN categories  c  ON e.category_id = c.id
     LEFT JOIN categories  pc ON c.parent_id   = pc.id
     WHERE e.user_id = $1 AND e.status != 'dismissed'
     ${monthClause}
     ORDER BY e.date DESC, e.created_at DESC
     LIMIT $2 OFFSET $3`,
    params
  );
  return result.rows;
}
```

Apply the same `month` pattern to `findByHousehold` in `expense.js` (the query used by `GET /expenses/household`). Check `expense.js` for the `findByHousehold` function and add an equivalent `monthClause`.

Apply the same pattern to `GET /expenses/household`.

- [ ] **Step 4: Add `?month` filter to `GET /budgets`**

In `api/src/routes/budgets.js`, the `month` variable is already introduced in Task 7's `GET /` rewrite (it reads `req.query.month`). Verify it's wired correctly in both the household and solo paths.

- [ ] **Step 5: Run expense and budget tests**

```bash
cd /Users/dangnguyen/curious-trio && npm test -- --testPathPattern="(expenses|budgets).test" 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 6: Commit API changes**

```bash
git add api/src/routes/expenses.js api/src/models/expense.js api/src/routes/budgets.js
git commit -m "feat: add ?month=YYYY-MM filter to expenses and budgets endpoints"
```

### Part B — Hooks update

- [ ] **Step 7: Update `useExpenses.js` to accept a `month` argument**

Replace the hook:

```js
import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

export function useExpenses(month) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const url = month ? `/expenses?month=${month}` : '/expenses';
      const data = await api.get(url);
      setExpenses(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { refresh(); }, [refresh]);

  return { expenses, loading, error, refresh };
}
```

- [ ] **Step 8: Update `useBudget.js`**

```js
import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';

export function useBudget(month) {
  const [budget, setBudget] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const url = month ? `/budgets?month=${month}` : '/budgets';
      const data = await api.get(url);
      setBudget(data);
    } catch {
      setBudget(null);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { refresh(); }, [refresh]);

  return { budget, loading, refresh };
}
```

- [ ] **Step 9: Update `useHouseholdExpenses.js`**

Apply the same pattern — accept `month`, append `?month=${month}` to the fetch URL when present, include `month` in `useCallback` deps. Also update the `currentMonth` client-side filter to use the `month` param instead of `new Date()`:

```js
export function useHouseholdExpenses(month) {
  // ... same pattern as useExpenses
  const url = month ? `/expenses/household?month=${month}` : '/expenses/household';

  // Remove the client-side currentMonth filter — server handles it
  // total is now just sum of all returned expenses
  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return { expenses, loading, error, refresh, total };
}
```

- [ ] **Step 10: Commit hook changes**

```bash
git add mobile/hooks/useExpenses.js mobile/hooks/useBudget.js mobile/hooks/useHouseholdExpenses.js
git commit -m "feat: add month argument to useExpenses, useBudget, useHouseholdExpenses hooks"
```

### Part C — Summary screen month picker

- [ ] **Step 11: Add month picker to `summary.js`**

In `mobile/app/(tabs)/summary.js`:

1. Add `selectedMonth` state and month picker modal state:
```js
const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
const [showMonthPicker, setShowMonthPicker] = useState(false);
```

2. Generate the list of past 13 months:
```js
function getPastMonths() {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}
```

3. Pass `selectedMonth` to hooks:
```js
const { expenses, refresh: refreshExpenses } = useExpenses(selectedMonth);
const { budget, refresh: refreshBudget } = useBudget(selectedMonth);
```

4. Remove the client-side `monthlyExpenses` filter (lines ~42–45). With `?month=` sent to the API, all returned expenses are already for the selected month. Replace `monthlyExpenses.reduce` with `expenses.reduce`.

5. Replace the static month label with a tappable one:
```js
<TouchableOpacity onPress={() => setShowMonthPicker(true)}>
  <Text style={styles.spendMonth}>
    {MONTH_NAMES[new Date(selectedMonth + '-02').getMonth()]} {new Date(selectedMonth + '-02').getFullYear()}
    {selectedMonth !== new Date().toISOString().slice(0, 7) ? '  ·  tap to change' : ''}
  </Text>
</TouchableOpacity>
```

6. Add the month picker modal before the closing `</ScrollView>`:
```js
{showMonthPicker && (
  <View style={styles.monthPickerOverlay}>
    <View style={styles.monthPickerSheet}>
      <Text style={styles.monthPickerTitle}>Select month</Text>
      {getPastMonths().map(m => (
        <TouchableOpacity
          key={m}
          style={[styles.monthOption, m === selectedMonth && styles.monthOptionActive]}
          onPress={() => { setSelectedMonth(m); setShowMonthPicker(false); }}
        >
          <Text style={[styles.monthOptionText, m === selectedMonth && styles.monthOptionTextActive]}>
            {MONTH_NAMES[new Date(m + '-02').getMonth()]} {new Date(m + '-02').getFullYear()}
          </Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={styles.monthPickerClose} onPress={() => setShowMonthPicker(false)}>
        <Text style={styles.monthPickerCloseText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  </View>
)}
```

7. Add styles:
```js
monthPickerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
monthPickerSheet: { backgroundColor: '#111', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 40 },
monthPickerTitle: { fontSize: 13, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 },
monthOption: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
monthOptionActive: { },
monthOptionText: { fontSize: 16, color: '#999' },
monthOptionTextActive: { color: '#f5f5f5', fontWeight: '600' },
monthPickerClose: { paddingVertical: 16, alignItems: 'center', marginTop: 8 },
monthPickerCloseText: { color: '#888', fontSize: 15 },
```

- [ ] **Step 12: Add month picker to `index.js` (feed screen)**

1. Add state at the top of `FeedScreen`:
```js
const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
const [showMonthPicker, setShowMonthPicker] = useState(false);
```

2. Pass `selectedMonth` to hooks:
```js
const { expenses: myExpenses, loading: myLoading, refresh: refreshMine } = useExpenses(selectedMonth);
const { expenses: householdExpenses, loading: householdLoading, refresh: refreshHousehold } = useHouseholdExpenses(selectedMonth);
const { budget, refresh: refreshBudget } = useBudget(selectedMonth);
```

3. Replace `const now = new Date()` with:
```js
const selectedDate = new Date(selectedMonth + '-02');
```

4. Replace the `monthlyTotal` computation (remove the `currentMonth` filter):
```js
const monthlyTotal = displayExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
```

5. Update `SpendHeader` invocation to use `selectedDate` and make the month label tappable. `SpendHeader` is defined in the same file — add an `onMonthPress` prop to it:

```js
// Updated SpendHeader signature:
function SpendHeader({ total, budget, month, mode, onMonthPress }) {
  // ... existing code unchanged ...
  return (
    <View style={styles.spendHeader}>
      <View style={styles.spendRow}>
        <TouchableOpacity onPress={onMonthPress}>
          <Text style={styles.spendMonth}>{monthName} {month.getFullYear()}{mode === 'household' ? ' · Household' : ''}</Text>
        </TouchableOpacity>
        <Text style={styles.spendAmount}>${total.toFixed(0)}</Text>
      </View>
      {/* rest unchanged */}
    </View>
  );
}
```

```js
// Updated invocation in FeedScreen:
<SpendHeader
  total={monthlyTotal}
  budget={budget}
  month={selectedDate}
  mode={mode}
  onMonthPress={() => setShowMonthPicker(true)}
/>
```

6. Add the month picker modal (same JSX as in summary.js Step 11) inside the `FeedScreen` return, just before the closing `</View>`. Reuse the same `getPastMonths()` helper (define it once at module level, outside both components).

7. Add matching styles for `monthPickerOverlay`, `monthPickerSheet`, etc. (copy from summary.js styles).

- [ ] **Step 13: Manual smoke test**

1. Tap month label on summary → picker appears with 13 months
2. Select a past month → expenses and spend total update to that month
3. Spend bar reflects past month's budget status
4. Switch to feed tab → same month selection UI works
5. Switching back to current month → current data restored

- [ ] **Step 14: Commit**

```bash
git add mobile/app/(tabs)/summary.js mobile/app/(tabs)/index.js
git commit -m "feat: add past month navigation to summary and feed screens"
```

---

## Final Verification

- [ ] **Run full test suite**

```bash
cd /Users/dangnguyen/curious-trio && npm test 2>&1 | tail -30
```

Expected: all tests pass with no failures.

- [ ] **Run the app end-to-end**

Verify each of the 9 bugs is fixed:
1. Parse "50 trader joes" → confirm screen shows correct category (not "Unassigned")
2. Parse "50 trader joes" → location auto-populates with nearest Trader Joe's
3. Scan a non-receipt image → targeted error message (not generic "Scan failed")
4. Open Settings → set a budget as solo user (no "Must be in a household" error)
5. Parse "84.50 trader joes" → confirm screen: Amount and Date fields are editable
6. Parse "125 nike running shoes from nordstrom using amex platinum" → items section populated, merchant = Nordstrom
7. Log out → tap "Continue without account" → lands on onboarding with solo-only options
8. From onboarding → tap "I'm tracking solo" → lands on summary
9. Tap month label on summary → past month picker appears; selecting past month updates data

- [ ] **Final commit (if any cleanup needed)**

```bash
git add -p  # stage only intentional changes
git commit -m "chore: final cleanup for bug fixes and improvements"
```
