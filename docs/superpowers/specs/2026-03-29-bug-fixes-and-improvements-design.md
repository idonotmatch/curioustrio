# Bug Fixes & Improvements — Design Spec
**Date:** 2026-03-29
**Status:** Approved

## Overview

Ten bug fixes and UX improvements across the Adlo expense tracker. Items are grouped by theme. Bug #4 (consolidate Google sign-in + Gmail OAuth into one flow) was assessed and deferred — not a simple config change; current two-flow approach remains.

---

## 1. Parser Improvements

### Bug 1 — Category name missing from parse response

**Problem:** `/expenses/parse` and `/expenses/scan` both call `assignCategory` and return `category_id`, but never look up the category name. The confirm screen checks `expense.category_name` which is always `undefined`, so it always renders "Unassigned" even when a category was matched.

**Fix:** In `api/src/routes/expenses.js`, after `assignCategory` resolves a `category_id` in **both** the `/parse` and `/scan` route handlers, find the matching entry in the already-fetched `categories` array and include `category_name` in the JSON response. Zero extra DB calls.

Note: both handlers destructure the `assignCategory` result with a local variable named `source` (not `category_source`). The response must rename it:

```js
const { category_id, source, confidence } = await assignCategory({ ... });
const matched = categories.find(c => c.id === category_id);
res.json({
  ...parsed,
  category_id,
  category_name: matched?.name || null,
  category_source: source,   // rename source → category_source in response
  category_confidence: confidence,
});
```

**Files:** `api/src/routes/expenses.js` (both `/parse` and `/scan` handlers)

---

### Bug 7 — NL parser doesn't extract line items

**Problem:** `nlParser.js` system prompt has no `items` field. Input like `"125 nike running shoes from nordstrom using amex platinum"` produces a single expense with no item breakdown.

**Fix:** Add `items` to the NL parser system prompt — same shape as `receiptParser.js`: `[{ description: string, amount: number | null }]`. Update examples to cover merchant + item + payment cases.

Example addition:
```
- "125 nike running shoes from nordstrom using amex platinum"
  → { merchant: "Nordstrom", description: null, amount: 125,
      items: [{ description: "Nike running shoes", amount: 125 }],
      payment_method: "credit", card_label: "amex platinum" }
```

The confirm screen already renders `items` when present — no frontend changes needed.

**Files:** `api/src/services/nlParser.js`

---

## 2. Confirm Screen — Editable Fields (Bug 6)

**Problem:** Amount and Date in `confirm.js` use `ConfirmField` which renders a `TouchableOpacity` + `Text` — display-only. Users cannot correct parser mistakes for these fields.

**Fix:** Replace `ConfirmField` for Amount and Date with inline `TextInput` components styled to match the existing merchant/description editable rows.

**Amount field — required changes:**

1. Add `amountText` local state (string), initialised from `String(Math.abs(parsed.amount))`.
2. Replace the Amount `ConfirmField` with a `TextInput` bound to `amountText`, `keyboardType="decimal-pad"`.
3. On `amountText` change: update both `amountText` and `expense.amount` in state:
   ```js
   setAmountText(value);
   setExpense(prev => ({
     ...prev,
     amount: isRefund ? -Math.abs(parseFloat(value) || 0) : Math.abs(parseFloat(value) || 0),
   }));
   ```
4. **Required:** Update `handleRefundToggle` to re-derive from `amountText` (not `prev.amount`):
   ```js
   function handleRefundToggle(value) {
     setIsRefund(value);
     setExpense(prev => ({
       ...prev,
       amount: value ? -Math.abs(parseFloat(amountText) || 0) : Math.abs(parseFloat(amountText) || 0),
     }));
   }
   ```
   Without this, toggling refund after editing the amount field will revert to the previously stored numeric value rather than the currently typed string.
5. On confirm: `expense.amount` is already a number in state — send as-is.

**Date field:**
- Replace Date `ConfirmField` with a `TextInput`, ISO format `YYYY-MM-DD`.
- Updates `expense.date` in state directly on change.

`ConfirmField` component itself is unchanged.

**Files:** `mobile/app/confirm.js`

---

## 3. Scan Receipt Error Handling (Bug 3)

**Problem:** The `handleScan` catch block in `add.js` shows the same generic "Scan failed / Could not read receipt" alert for every failure mode.

**Fix:** Inspect `err.message` in the catch block. `api.js` propagates the server's `error.error` body field as the thrown message string. Match on exact substrings:

| Error condition | `err.message` match | Message shown |
|---|---|---|
| Image too large (400) | contains `"image too large"` | "Receipt image is too large. Try a closer crop." |
| AI couldn't parse (422) | contains `"Could not parse receipt"` | "Couldn't read that receipt. Try better lighting or enter manually." |
| Network / other | anything else | "Could not reach the server. Check your connection and try again." |

Camera permission denial is already handled before the try block — no change needed there.

**Files:** `mobile/app/(tabs)/add.js`

---

## 4. Location — Specific Store Recommendation (Bug 2)

**Problem:** `locationService.js` only reverse-geocodes coordinates to a street address. When the parser identifies a merchant (e.g. "Trader Joe's"), the location picker has no awareness of it and can't suggest the specific nearby store.

**Approach:** Apple MapKit Places API (server-side), with client coordinates as region bias. The existing `LocationPicker` component and `locationService.js` are **unchanged** — the new auto-populate logic runs separately on confirm screen mount and pre-fills `locationData` before the user interacts with `LocationPicker`.

To avoid double-requesting location permission:
- The auto-populate logic on mount calls `expo-location` directly (same as `locationService.js` does internally) to get coordinates.
- If the user does NOT have a merchant (i.e. description-only expense), skip the auto-populate entirely — `LocationPicker` remains in its default state.
- If the auto-populate fails (no permission, no result from Places API), `locationData` stays `null` and `LocationPicker` shows its normal "Use current location" button. No double-prompt.

### Backend

New service `api/src/services/mapkitService.js`:
- Generates a signed MapKit JWT from `APPLE_MAPS_KEY_ID`, `APPLE_MAPS_TEAM_ID`, `APPLE_MAPS_PRIVATE_KEY` env vars
- Exports `searchPlace(query, lat, lng)` — calls `GET https://maps-api.apple.com/v1/search` and returns the top result as `{ place_name, address, mapkit_stable_id }` or `null`

New route file `api/src/routes/places.js` — `GET /places/search?q=<merchant>&lat=<lat>&lng=<lng>`:
- Validates params, calls `searchPlace`, returns `{ result }` where result is the place object or `null`
- Authenticated (requires valid session)
- Mount in `api/src/index.js`: `app.use('/places', placesRouter)`

Add to `api/.env.example`:
```
APPLE_MAPS_KEY_ID=your-key-id
APPLE_MAPS_TEAM_ID=your-team-id
APPLE_MAPS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
```

### Frontend

In `confirm.js`, on mount: if `merchant` is non-null:
1. Request location permission via `expo-location`
2. If granted, get coordinates
3. Call `GET /places/search?q=<merchant>&lat=<lat>&lng=<lng>`
4. If a result is returned, call `setLocationData(result)` to pre-populate `LocationPicker`

**`place_name` and `address` in `locationData` are display-only.** Per prior schema migration (commit `1106b1b`), these columns were removed from the `expenses` table. Only `mapkit_stable_id` is persisted. `confirm.js` sends them in the confirm body but the server ignores them.

**Files:** `api/src/services/mapkitService.js` (new), `api/src/routes/places.js` (new), `api/src/index.js`, `api/.env.example`, `mobile/app/confirm.js`

---

## 5. Budget Redesign — Individual Budgets (Bug 5)

**Problem:** All budget endpoints call `requireHousehold` which returns 403 for users without a `household_id`. Solo users cannot set a budget. Budget is stored per-household with no per-user granularity.

**Approach:** User-scoped budget_settings. Household total is always a roll-up of member budgets — never set independently (override feature backlogged).

### DB Migration

```sql
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

Existing household-scoped rows retain `user_id = NULL` — they become inert until replaced by user-scoped rows.

### API Changes (`api/src/routes/budgets.js`)

- Remove `requireHousehold`; add `requireUser` helper that returns the authenticated user or 401 (no household check).

- **`PUT /budgets/total`:** replace `requireHousehold` with `requireUser`; update the `BudgetSetting.upsert` call to pass `userId: user.id` instead of `householdId: user.household_id`:
  ```js
  await BudgetSetting.upsert({ userId: user.id, categoryId: null, monthlyLimit: monthly_limit });
  ```

- **`PUT /budgets/category/:id`:** same scope change — pass `userId: user.id`.

- **`DELETE /budgets/category/:id`:** replace `requireHousehold` with `requireUser`; update `BudgetSetting.remove` call to pass `userId: user.id` instead of `householdId`.

- **`GET /budgets` — solo user path** (no `household_id`):
  - Query `budget_settings WHERE user_id = $userId` for limits
  - Spending sub-queries: change `WHERE household_id = $1` to `WHERE user_id = $1` (use user_id, not household_id, for solo users)
  - Return same response shape as today

- **`GET /budgets` — household path**:
  - Query `budget_settings` for all members (JOIN `users WHERE household_id = $householdId`)
  - Aggregate `total.limit` = SUM of each member's total (category_id IS NULL) limit
  - Aggregate per-category limits = SUM each member's limit per category_id
  - `total.spent` and `by_parent` spending queries remain household-scoped (unchanged)
  - `by_parent` is computed from expense data grouped by parent category — not from budget_settings — so no change needed there

### Model Changes (`api/src/models/budgetSetting.js`)

- `upsert({ userId, categoryId, monthlyLimit })` — rewrites both the INSERT column list (replacing `household_id` with `user_id`) and the conflict clause to `ON CONFLICT ON CONSTRAINT budget_settings_user_category_uq DO UPDATE`. No code path should reference the old `budget_settings_household_category_uq` constraint after this change — the migration drops it.
- `remove({ userId, categoryId })` — delete by `user_id + category_id` (replaces `household_id` scope)
- `findByUser(userId)` — new, returns all settings for a single user
- `findByHousehold(householdId)` — updated to JOIN across all household members and SUM limits per category_id

**Files:** new migration SQL, `api/src/models/budgetSetting.js`, `api/src/routes/budgets.js`

---

## 6. Auth & Onboarding (Bugs 8 & 9)

### Bug 9 — Anonymous local user (implement first — affects onboarding)

**Problem:** `login.js` only offers Google and Apple sign-in.

**Fix:** Add "Continue without account" link below social buttons. Calls `supabase.auth.signInAnonymously()`. Supabase fires `SIGNED_IN`, handled by existing `_layout.js` logic.

**`_layout.js` — updated `checkHousehold`:**

Anonymous users still call `/users/sync` (to create the minimal user row required for expense saving):
```js
const isAnon = session.user.is_anonymous === true;
const me = await api.post('/users/sync', {
  name: isAnon ? 'Anonymous' : (session.user.user_metadata?.full_name || session.user.email || 'User'),
  email: isAnon ? null : (session.user.email || null),
}, { token: session.access_token });
```
After sync, route to `/onboarding` (same as today when `household_id` is null).

**Household API guard** (`api/src/routes/households.js`): check the `is_anonymous` claim in the decoded JWT on all household mutation endpoints and return `403: "Create an account to join a household"`.

**Files:** `mobile/app/login.js`, `mobile/app/_layout.js`, `api/src/routes/households.js`

---

### Bug 8 — Skip household creation in onboarding

**Problem:** `onboarding.js` forces Create or Join with no way to proceed as a solo user. Anonymous users will hit a 403 if they tap "Create a household."

**Fix:**

- Add "I'm tracking solo" tertiary text link below both buttons → `router.replace('/(tabs)/summary')`. No API call needed.
- On mount, read `supabase.auth.getSession()` and check `session.user.is_anonymous`. If anonymous: hide the "Create a household" and "Join with invite code" buttons, show only "I'm tracking solo" and a "Create an account →" link that routes to `/login`. This prevents the 403 surface for anonymous users.

**Files:** `mobile/app/onboarding.js`

---

## 7. Past Months Navigation (Bug 10)

**Problem:** Summary and all-transactions screens are hardcoded to the current month.

### UX

Both screens get a tappable month label (e.g. "March 2026"). Tapping opens a flat modal list showing the current month + 12 previous months. Selecting a month closes the modal and updates the view. A "Back to current month" affordance appears when viewing a past month.

### Frontend

**`selectedMonth` state** (default: current `YYYY-MM`) added to `summary.js` and `index.js`.

**`useExpenses(month)` and `useBudget(month)`:** `month` is passed as an argument from the calling screen (not held in hook-internal state — callers own `selectedMonth`). Each hook appends `?month=${month}` to its fetch URL when `month` is provided. The `useCallback` dependency arrays in both hooks must include `month` to avoid stale closures.

**`summary.js`:** Remove the client-side `monthlyExpenses` filter (lines ~42–45). The server returns only the selected month's data when `?month=` is provided. The month label (currently `MONTH_NAMES[now.getMonth()] + now.getFullYear()`) becomes a `TouchableOpacity` driven by `selectedMonth`.

**`index.js`:**
- Replace the hardcoded `now` passed to `SpendHeader` with a `Date` object derived from `selectedMonth`: `new Date(selectedMonth + '-02')` (day 2 avoids timezone edge cases on the 1st).
- Remove/update the client-side `currentMonth` / `monthlyTotal` computation to use `selectedMonth` instead of `now`.

### API Changes

- `GET /expenses` and `GET /expenses/household`: accept optional `?month=YYYY-MM`. When present, add `AND to_char(date, 'YYYY-MM') = $n`. When absent, return all (existing behavior preserved).
- `GET /budgets`: accept optional `?month=YYYY-MM`. When present, spending sub-queries use that month string instead of `new Date().toISOString().slice(0, 7)`.

**Files:** `mobile/app/(tabs)/summary.js`, `mobile/app/(tabs)/index.js`, `mobile/hooks/useExpenses.js`, `mobile/hooks/useBudget.js`, `mobile/hooks/useHouseholdExpenses.js`, `api/src/routes/expenses.js`, `api/src/routes/budgets.js`

---

## Out of Scope

- **Bug 4** (consolidate Google sign-in + Gmail OAuth): not a simple config change — requires `serverAuthCode` exchange flow. Left as separate flows.
- **Budget household override**: individual member budgets roll up automatically; manual household-level override deferred to backlog.
- **Email/password auth**: anonymous auth is in scope; email+password sign-up deferred to backlog.
