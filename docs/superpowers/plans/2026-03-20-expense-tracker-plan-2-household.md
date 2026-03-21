# Household Expense Tracker — Implementation Plan 2: Household Sharing + Deduplication

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the expense tracker with household membership, an invite flow, a deduplication pipeline (exact/fuzzy/location match), a pending queue, and three new mobile screens (Household rollup, Pending Queue, Expense Detail).

**Architecture:** Builds on top of Plan 1. The DB schema already has `households`, `household_invites`, `duplicate_flags` tables. Plan 2 wires them up with models, routes, a duplicate-detection service, and mobile screens.

**Tech Stack:** Same as Plan 1 — React Native + Expo SDK 51+, Node.js 20+, Express 4, PostgreSQL 15+, Auth0, Jest + Supertest (API), Jest + React Native Testing Library (mobile).

**This is Plan 2 of 4. Subsequent plans:**
- Plan 3: Camera receipt scan, Gmail email import, MapKit location enrichment
- Plan 4: Recurring expenses, push notifications, onboarding flow, settings, security hardening

---

## File Structure

### New/Modified Backend (`api/`)
```
api/
  src/
    models/
      household.js          # NEW: create, findById, findByUserId
      householdInvite.js    # NEW: create, findByToken, accept, expire
      user.js               # MODIFIED: add setHouseholdId
      expense.js            # MODIFIED: add findByHousehold, findById, update,
                            #           findPotentialDuplicates, findByMapkitStableId,
                            #           updateStatusByHousehold
    routes/
      households.js         # NEW: POST /, GET /me, POST /invites, POST /invites/:token/accept
      expenses.js           # MODIFIED: add GET /pending, POST /:id/dismiss,
                            #           GET /:id, PATCH /:id, update /confirm to run dedup
    services/
      duplicateDetector.js  # NEW: detectDuplicates(expense) → duplicate_flags[]
    index.js                # MODIFIED: mount /households router
  tests/
    models/
      household.test.js     # NEW
    routes/
      households.test.js    # NEW
      expenses.test.js      # MODIFIED: add pending/dismiss/detail tests + dedup integration
    services/
      duplicateDetector.test.js  # NEW
```

### New/Modified Mobile (`mobile/`)
```
mobile/
  app/
    (tabs)/
      _layout.js            # MODIFIED: add Household + Pending tabs
      household.js          # NEW: Household rollup screen
      pending.js            # NEW: Pending Queue screen
    expense/
      [id].js               # NEW: Expense Detail screen
  hooks/
    useHouseholdExpenses.js # NEW: GET /expenses/household
    usePendingExpenses.js   # NEW: GET /expenses/pending
  components/
    ExpenseItem.js          # MODIFIED: add optional showUser prop (shows user name)
    DuplicateAlert.js       # NEW: inline warning banner for flagged duplicates
```

---

## Shared Context for All Tasks

### DB schema (already migrated — do NOT re-run migrations)
- `households(id, name, created_at)`
- `users(id, auth0_id, name, email, household_id, created_at)`
- `household_invites(id, household_id, invited_email, invited_by, token, status, expires_at, created_at)`
- `expenses(id, user_id, household_id, merchant, amount, date, category_id, source, status, place_name, address, mapkit_stable_id, notes, raw_receipt_url, created_at)`
- `duplicate_flags(id, expense_id_a, expense_id_b, confidence, status, resolved_by, created_at)`

### Deduplication rules
- **Exact match:** same merchant (case-insensitive), same amount, same date, same household → `confidence='exact'`
- **Fuzzy match:** same merchant (case-insensitive), amount within ±$1.00, date within ±2 days, same household → `confidence='fuzzy'`
- **Location match:** same `mapkit_stable_id` (non-null), amount within ±$1.00, date within ±2 days, same household → `confidence='uncertain'`
- A new expense should be checked against all confirmed/pending expenses in the same household
- Create a `duplicate_flags` row for each match found
- `POST /expenses/confirm` returns `{ expense, duplicate_flags: [] }` (array may be empty)

### Invite flow
- `POST /households` — creates a new household, sets the requesting user's `household_id`
- `GET /households/me` — returns household info + member list
- `POST /households/invites` — body: `{ email }`, creates an invite token (UUID), returns `{ token }`
- `POST /households/invites/:token/accept` — accepting user joins the household, invite marked `accepted`
- Invite tokens expire after 7 days (`expires_at = NOW() + INTERVAL '7 days'`)
- A user can only be in one household. If already in one, `POST /households` returns 409. Same for accepting an invite when already in a household.

### Auth pattern (consistent with Plan 1)
All routes behind `authenticate` middleware. User lookup: `User.findByAuth0Id(req.auth0Id)`.

---

## Tasks

### Task 1: Household model + Invite model + user.setHouseholdId

**Goal:** Add Household and HouseholdInvite models, and `setHouseholdId` to the User model. No routes yet.

**Files to create/modify:**
- `api/src/models/household.js` (new)
- `api/src/models/householdInvite.js` (new)
- `api/src/models/user.js` (modify — add `setHouseholdId`)
- `api/tests/models/household.test.js` (new)

**Household model (`api/src/models/household.js`):**
```js
// create({ name }) → household row
// findById(id) → household row or null
// findByUserId(userId) → household row or null (JOIN through users table)
// findMembers(householdId) → users[] (id, name, email, created_at)
```

**HouseholdInvite model (`api/src/models/householdInvite.js`):**
```js
// create({ householdId, invitedEmail, invitedBy, token, expiresAt }) → invite row
// findByToken(token) → invite row or null
// accept(token) → updated invite row (set status='accepted')
// expireOld() → count of rows updated (status='pending' AND expires_at < NOW() → 'expired')
```
- `token` is generated with `require('crypto').randomUUID()` inside the route (not the model).
- `expiresAt` is computed in the route: `new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()`

**User model addition:**
```js
// setHouseholdId(userId, householdId) → updated user row
```
Uses `UPDATE users SET household_id = $1 WHERE id = $2 RETURNING id, auth0_id, name, email, household_id, created_at`.

**Tests (`api/tests/models/household.test.js`):**
- Uses real DB (same pattern as existing tests — beforeAll creates test household + user, afterAll deletes)
- Tests: `Household.create`, `Household.findById`, `Household.findByUserId`, `Household.findMembers`
- Tests: `HouseholdInvite.create`, `HouseholdInvite.findByToken`, `HouseholdInvite.accept`
- Tests: `User.setHouseholdId`

**Checklist:**
- [ ] `api/src/models/household.js` created with `create`, `findById`, `findByUserId`, `findMembers`
- [ ] `api/src/models/householdInvite.js` created with `create`, `findByToken`, `accept`, `expireOld`
- [ ] `api/src/models/user.js` updated with `setHouseholdId`
- [ ] `api/tests/models/household.test.js` created with tests for all model functions
- [ ] All tests pass (`npm test` in `api/`)
- [ ] Committed

---

### Task 2: Household routes

**Goal:** Add `api/src/routes/households.js` with four endpoints, mount it in `index.js`.

**Files to create/modify:**
- `api/src/routes/households.js` (new)
- `api/src/index.js` (modify — add `/households` route)
- `api/tests/routes/households.test.js` (new)

**Endpoints:**
```
POST   /households              Create household + assign user
GET    /households/me           Get my household + members
POST   /households/invites      Invite by email
POST   /households/invites/:token/accept   Accept invite
```

**POST /households:**
- Body: `{ name }` (required)
- If user already has `household_id`, return `409 { error: 'Already in a household' }`
- Create household with `Household.create({ name })`
- Set user's `household_id` via `User.setHouseholdId`
- Return `201` with household object

**GET /households/me:**
- If user has no household, return `404 { error: 'Not in a household' }`
- Return `{ household, members }` where `members` comes from `Household.findMembers`

**POST /households/invites:**
- Body: `{ email }` (required)
- If user has no household, return `403 { error: 'Must be in a household to invite' }`
- Generate token: `require('crypto').randomUUID()`
- Set `expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()`
- Create invite via `HouseholdInvite.create`
- Return `201 { token, expires_at }`

**POST /households/invites/:token/accept:**
- Look up invite via `HouseholdInvite.findByToken(token)`
- If not found → `404`
- If `status !== 'pending'` → `410 { error: 'Invite already used or expired' }`
- If `expires_at < NOW()` → `410 { error: 'Invite expired' }` and call `HouseholdInvite.accept` with status='expired'
- If accepting user already has a `household_id` → `409 { error: 'Already in a household' }`
- Call `User.setHouseholdId` and `HouseholdInvite.accept`
- Return `200 { household_id }`

**Tests (`api/tests/routes/households.test.js`):**
- Mock `authenticate` middleware (set req.auth0Id to test user's auth0_id)
- Create test user (no household) before each test
- Test: POST /households creates household and assigns user
- Test: POST /households 409 if already in household
- Test: GET /households/me returns household + members
- Test: GET /households/me 404 if not in household
- Test: POST /households/invites creates invite
- Test: POST /households/invites/:token/accept assigns user to household

**Checklist:**
- [ ] `api/src/routes/households.js` created with all 4 endpoints
- [ ] `api/src/index.js` updated to mount `/households` router
- [ ] `api/tests/routes/households.test.js` created
- [ ] All tests pass (`npm test` in `api/`)
- [ ] Committed

---

### Task 3: DuplicateDetector service + DuplicateFlag model

**Goal:** Build the deduplication service and the DuplicateFlag model. No route integration yet.

**Files to create:**
- `api/src/services/duplicateDetector.js` (new)
- `api/src/models/duplicateFlag.js` (new)
- `api/src/models/expense.js` (modify — add `findPotentialDuplicates`, `findByMapkitStableId`)
- `api/tests/services/duplicateDetector.test.js` (new)

**Expense model additions (`api/src/models/expense.js`):**
```js
// findPotentialDuplicates({ householdId, merchant, amount, date }) → expenses[]
//   Returns confirmed/pending expenses in same household where:
//   - merchant matches (LOWER) AND amount within ±1 AND date within ±2 days
//   Excludes the expense being checked (passed as excludeId optional param)

// findByMapkitStableId({ householdId, mapkitStableId, amount, date, excludeId }) → expenses[]
//   Returns confirmed/pending expenses with same mapkit_stable_id (non-null),
//   amount within ±1, date within ±2 days, same household
```

**DuplicateFlag model (`api/src/models/duplicateFlag.js`):**
```js
// create({ expenseIdA, expenseIdB, confidence }) → flag row
// findByExpenseId(expenseId) → flags[] (where expense_id_a = expenseId OR expense_id_b = expenseId)
// updateStatus(id, { status, resolvedBy }) → updated flag row
```

**DuplicateDetector service (`api/src/services/duplicateDetector.js`):**
```js
// detectDuplicates(expense) → Promise<duplicate_flags[]>
//   expense: { id, householdId, merchant, amount, date, mapkit_stable_id }
//   1. If no householdId, return []
//   2. Find fuzzy matches via Expense.findPotentialDuplicates
//   3. For each match, determine confidence:
//      - Same merchant + same amount + same date → 'exact'
//      - Otherwise → 'fuzzy'
//   4. If mapkit_stable_id non-null, find location matches via Expense.findByMapkitStableId
//      - Location matches not already in fuzzy set → 'uncertain'
//   5. For each unique match (deduped by expense id pair), call DuplicateFlag.create
//   6. Return array of created flag rows
```

**Tests (`api/tests/services/duplicateDetector.test.js`):**
- Uses real DB
- Test: exact match detected (same merchant/amount/date)
- Test: fuzzy match detected (amount within $1, date within 2 days)
- Test: location match detected (same mapkit_stable_id)
- Test: no duplicates when different household
- Test: no duplicates when no household
- Test: returns [] when no matches

**Checklist:**
- [ ] `api/src/models/expense.js` updated with `findPotentialDuplicates`, `findByMapkitStableId`
- [ ] `api/src/models/duplicateFlag.js` created with `create`, `findByExpenseId`, `updateStatus`
- [ ] `api/src/services/duplicateDetector.js` created with `detectDuplicates`
- [ ] `api/tests/services/duplicateDetector.test.js` created with all tests
- [ ] All tests pass (`npm test` in `api/`)
- [ ] Committed

---

### Task 4: Dedup integration + expand expense routes

**Goal:** Wire deduplication into `POST /expenses/confirm`, add `GET /pending`, `POST /:id/dismiss`, `GET /:id`, `PATCH /:id`. Expand Expense model with remaining methods.

**Files to modify:**
- `api/src/routes/expenses.js`
- `api/src/models/expense.js` (add `findByHousehold`, `findById`, `update`, `updateStatusByHousehold`)
- `api/tests/routes/expenses.test.js` (add new endpoint tests)

**Expense model additions:**
```js
// findById(id) → expense row with category join or null
// findByHousehold(householdId, { limit=50, offset=0 }) → expenses[] with category join
//   Excludes dismissed expenses, ordered by date DESC
// update(id, userId, { merchant, amount, date, categoryId, notes }) → updated expense row
//   Scoped to user_id for ownership enforcement
//   Uses COALESCE patch pattern (only update provided fields)
// updateStatusByHousehold(id, householdId, status) → updated expense row
//   Used for household-level status updates (dismiss duplicate)
```

**Updated POST /expenses/confirm:**
- After creating expense, call `detectDuplicates(expense)` from `duplicateDetector.js`
- Return `201 { expense, duplicate_flags: [] }` (was previously just the expense object)
- If detectDuplicates throws, log error but do NOT fail the request (expense was already saved)

**New endpoints:**

`GET /expenses/pending`
- Returns expenses with `status='pending'` for the authenticated user
- Also returns expenses with active `duplicate_flags` (status='pending') for the user's household
- Query: `SELECT e.* FROM expenses e WHERE e.user_id = $1 AND e.status = 'pending'`
- Include category join (same as findByUser)

`POST /expenses/:id/dismiss`
- Sets `status='dismissed'` on the expense
- Scoped to user_id: only the owner can dismiss
- Uses `Expense.updateStatus(id, userId, 'dismissed')`
- Returns `200` with updated expense, or `404` if not found/not owned

`GET /expenses/:id`
- Returns single expense with category join
- Scoped to user's household (if in household) or user_id
- Includes `duplicate_flags` array via `DuplicateFlag.findByExpenseId`
- Returns `404` if not found

`PATCH /expenses/:id`
- Body: `{ merchant?, amount?, date?, category_id?, notes? }` (all optional)
- Validates `category_id` as UUID if provided (same UUID_RE pattern)
- Uses `Expense.update(id, userId, fields)`
- Returns updated expense or `404`

**Tests (additions to `api/tests/routes/expenses.test.js`):**
- POST /expenses/confirm returns `{ expense, duplicate_flags }` shape
- POST /expenses/confirm creates duplicate_flags when duplicate exists
- GET /expenses/pending returns pending expenses
- POST /expenses/:id/dismiss marks as dismissed
- GET /expenses/:id returns expense with duplicate_flags
- PATCH /expenses/:id updates fields

**Checklist:**
- [ ] `api/src/models/expense.js` updated with `findById`, `findByHousehold`, `update`, `updateStatusByHousehold`
- [ ] `api/src/routes/expenses.js` updated: confirm returns `{expense, duplicate_flags}`, 4 new endpoints
- [ ] `api/tests/routes/expenses.test.js` updated with new tests
- [ ] All tests pass (`npm test` in `api/`)
- [ ] Committed

---

### Task 5: Household View mobile screen

**Goal:** Add a "Household" tab showing the combined expense feed for all household members, with member attribution on each expense row.

**Files to create/modify:**
- `mobile/app/(tabs)/household.js` (new)
- `mobile/app/(tabs)/_layout.js` (modify — add Household tab)
- `mobile/hooks/useHouseholdExpenses.js` (new)
- `mobile/components/ExpenseItem.js` (modify — add `showUser` prop)

**`mobile/hooks/useHouseholdExpenses.js`:**
```js
// Calls GET /expenses/household (not yet implemented — use GET /expenses for now with householdId filter)
// Actually: add GET /expenses?scope=household support in the API route (returns household expenses)
// OR: use a separate endpoint. Keep it simple — call GET /expenses and the backend already
//   returns user expenses. For household view, we need a new endpoint.
// Implementation: call api.get('/expenses/household') — this maps to findByHousehold which
//   is added in Task 4. The route needs to be added: GET /expenses/household
//   (Add this endpoint to expenses.js in this task — it's a mobile-driven addition)
```

> **Note for implementer:** Task 4 adds model methods but doesn't add a `GET /expenses/household` route. Add it in this task:
> `GET /expenses/household` — returns all non-dismissed expenses for the user's household, ordered by date DESC. If user has no household, returns their personal expenses (same as GET /). Requires `user.household_id` to call `Expense.findByHousehold`.

**`mobile/app/(tabs)/household.js`:**
- Mirrors `index.js` structure (FlatList with RefreshControl)
- Shows "Household" monthly total (sum of all members' expenses this month)
- Renders `<ExpenseItem expense={item} showUser />` so member name appears
- If no household, shows message: "You're not in a household yet. Create or join one in Settings."
- Style: same dark theme as Feed screen

**`ExpenseItem.js` modification:**
- Add optional `showUser` prop (default false)
- When `showUser=true`, render a small `<Text>` below the merchant name showing `expense.user_name` (or fall back to `expense.user_id` truncated)
- The household endpoint should JOIN users table to include `user_name` — add this to `Expense.findByHousehold` query in this task

**Tab layout update:**
- Add `<Tabs.Screen name="household" options={{ title: 'Household', tabBarLabel: 'Household' }} />` between Feed and Add

**Checklist:**
- [ ] `api/src/routes/expenses.js` updated with `GET /expenses/household`
- [ ] `api/src/models/expense.js` `findByHousehold` includes `u.name as user_name` via JOIN
- [ ] `mobile/hooks/useHouseholdExpenses.js` created
- [ ] `mobile/components/ExpenseItem.js` updated with `showUser` prop
- [ ] `mobile/app/(tabs)/household.js` created
- [ ] `mobile/app/(tabs)/_layout.js` updated with Household tab
- [ ] Committed

---

### Task 6: Pending Queue mobile screen

**Goal:** Add a "Pending" tab showing expenses awaiting review or flagged as potential duplicates.

**Files to create/modify:**
- `mobile/app/(tabs)/pending.js` (new)
- `mobile/app/(tabs)/_layout.js` (modify — add Pending tab)
- `mobile/hooks/usePendingExpenses.js` (new)
- `mobile/components/DuplicateAlert.js` (new)

**`mobile/hooks/usePendingExpenses.js`:**
```js
// Calls GET /expenses/pending
// Returns { expenses, loading, refresh }
```

**`mobile/components/DuplicateAlert.js`:**
```js
// Props: { flags: duplicate_flags[], onDismiss: () => void }
// Renders a yellow/amber warning banner: "Possible duplicate detected"
// Shows confidence level (exact/fuzzy/uncertain) and a Dismiss button
// onDismiss calls POST /expenses/:id/dismiss via the parent screen
```

**`mobile/app/(tabs)/pending.js`:**
- FlatList of pending expenses using `usePendingExpenses`
- Each item:
  - Renders `<ExpenseItem expense={item} />`
  - If `item.duplicate_flags?.length > 0`, renders `<DuplicateAlert flags={item.duplicate_flags} onDismiss={() => dismiss(item.id)} />`
- `dismiss(id)` calls `api.post(\`/expenses/${id}/dismiss\`)` then calls `refresh()`
- Empty state: "No pending expenses. You're all caught up!"
- Style: same dark theme

> **Note for implementer:** `GET /expenses/pending` (added in Task 4) returns expenses with status='pending'. The expense objects do NOT include duplicate_flags — you'll need to either:
> a) Fetch flags separately per expense (N+1 — avoid for list view), OR
> b) Extend `GET /expenses/pending` to include a `duplicate_flags` array per expense (preferred)
>
> Extend the backend endpoint: for each pending expense, LEFT JOIN or subquery against `duplicate_flags` to include `duplicate_flags` as a JSON array. Use a CTE or aggregate approach.

**Tab layout update:**
- Add `<Tabs.Screen name="pending" options={{ title: 'Pending', tabBarLabel: 'Pending' }} />`

**Checklist:**
- [ ] `api/src/routes/expenses.js` `GET /pending` extended to include `duplicate_flags` per expense
- [ ] `mobile/hooks/usePendingExpenses.js` created
- [ ] `mobile/components/DuplicateAlert.js` created
- [ ] `mobile/app/(tabs)/pending.js` created
- [ ] `mobile/app/(tabs)/_layout.js` updated with Pending tab
- [ ] Committed

---

### Task 7: Expense Detail mobile screen

**Goal:** Add a tappable expense detail screen accessible from any expense list (Feed, Household, Pending).

**Files to create/modify:**
- `mobile/app/expense/[id].js` (new)
- `mobile/components/ExpenseItem.js` (modify — add `onPress` navigation)

**`mobile/app/expense/[id].js`:**
- Reads `id` from `useLocalSearchParams()`
- Calls `GET /expenses/:id` via `api.get(\`/expenses/${id}\`)`
- Shows loading spinner while fetching
- Displays:
  - Merchant (large, bold)
  - Amount (large)
  - Date (formatted: "March 20, 2026")
  - Category badge (`<CategoryBadge>`)
  - Source (manual / camera / email) as small label
  - Notes (if present)
  - Location: place_name + address (if present)
  - Duplicate flags section: if `duplicate_flags.length > 0`, show warning section with each flag's confidence level
- Dismiss button: calls `POST /expenses/:id/dismiss`, navigates back on success
- Style: dark theme, full-screen modal or stack screen

**`ExpenseItem.js` modification:**
- Wrap the row in `<TouchableOpacity onPress={() => router.push(\`/expense/${expense.id}\`)} />`
- Import `useRouter` from `expo-router`

**Navigation setup:**
- The `[id].js` file under `mobile/app/expense/` will be a stack screen automatically via expo-router file-based routing
- No changes needed to `_layout.js` unless header styling is needed (add `<Stack.Screen>` options in `[id].js` using `<Stack.Screen options={{ title: expense.merchant }} />`)

**Checklist:**
- [ ] `mobile/app/expense/[id].js` created with full expense detail view
- [ ] `mobile/components/ExpenseItem.js` updated with `onPress` navigation
- [ ] Navigation from Feed, Household, and Pending screens works (tapping item opens detail)
- [ ] Committed

---

## Definition of Done

- [ ] All 7 tasks committed (one commit per task minimum)
- [ ] `npm test` passes with no failures in `api/`
- [ ] Household create + invite flow works end-to-end
- [ ] Dedup pipeline catches exact + fuzzy matches
- [ ] Mobile app has 4 tabs: Feed, Household, Pending, Add
- [ ] Expense Detail screen navigable from all list views
