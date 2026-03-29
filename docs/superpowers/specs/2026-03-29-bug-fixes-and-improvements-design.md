# Bug Fixes & Improvements — Design Spec
**Date:** 2026-03-29
**Status:** Approved

## Overview

Ten bug fixes and UX improvements across the Adlo expense tracker. Items are grouped by theme. Bug #4 (consolidate Google sign-in + Gmail OAuth into one flow) was assessed and deferred — not a simple config change; current two-flow approach remains.

---

## 1. Parser Improvements

### Bug 1 — Category name missing from parse response

**Problem:** `/expenses/parse` returns `category_id` from `assignCategory` but never looks up the category name. The confirm screen checks `expense.category_name` which is always `undefined`, so it always renders "Unassigned" even when a category was matched.

**Fix:** In `api/src/routes/expenses.js`, after `assignCategory` resolves a `category_id`, find the matching entry in the already-fetched `categories` array and include `category_name` in the JSON response. Zero extra DB calls.

```
// before
res.json({ ...parsed, category_id, category_source, category_confidence });

// after
const matched = categories.find(c => c.id === category_id);
res.json({ ...parsed, category_id, category_name: matched?.name || null, category_source, category_confidence });
```

**Files:** `api/src/routes/expenses.js`

---

### Bug 7 — NL parser doesn't extract line items

**Problem:** `nlParser.js` system prompt has no `items` field. Input like `"125 nike running shoes from nordstrom using amex platinum"` produces a single expense with no item breakdown.

**Fix:** Add `items` to the NL parser system prompt — same shape as `receiptParser.js`: `[{ description: string, amount: number | null }]`. Update examples to cover merchant + item + payment cases.

Example addition:
```
- "125 nike running shoes from nordstrom using amex platinum"
  → { merchant: "Nordstrom", description: null, amount: 125, items: [{ description: "Nike running shoes", amount: 125 }], payment_method: "credit", card_label: "amex platinum" }
```

The confirm screen already renders `items` when present — no frontend changes needed.

**Files:** `api/src/services/nlParser.js`

---

## 2. Confirm Screen — Editable Fields (Bug 6)

**Problem:** Amount and Date in `confirm.js` use `ConfirmField` which renders a `TouchableOpacity` + `Text` — display-only. Users cannot correct parser mistakes for these fields.

**Fix:** Replace `ConfirmField` for Amount and Date with inline `TextInput` components styled to match the existing editable merchant/description rows.

- Amount: `keyboardType="decimal-pad"`, stores as string in local state, parsed to float on confirm
- Date: plain text input, ISO format `YYYY-MM-DD`, validated before submit

`ConfirmField` component itself is unchanged — it's still used for read-only display elsewhere.

**Files:** `mobile/app/confirm.js`

---

## 3. Scan Receipt Error Handling (Bug 3)

**Problem:** The `handleScan` catch block in `add.js` shows the same generic "Scan failed / Could not read receipt" alert for every failure mode.

**Fix:** Inspect `err.message` in the catch block and show targeted messages:

| Error condition | Message shown |
|---|---|
| `image too large` in message | "Receipt image is too large. Try a closer crop." |
| `HTTP 422` or `Could not parse` | "Couldn't read that receipt. Try better lighting or enter manually." |
| Network / other server error | "Could not reach the server. Check your connection and try again." |

Camera permission denial is already handled before the try block — no change needed there.

**Files:** `mobile/app/(tabs)/add.js`

---

## 4. Location — Specific Store Recommendation (Bug 2)

**Problem:** `locationService.js` only reverse-geocodes coordinates to a street address. When the parser identifies a merchant (e.g. "Trader Joe's"), the location picker has no awareness of it and can't suggest the specific nearby store.

**Approach:** Apple MapKit Places API (server-side), with client coordinates as region bias.

### Backend

New service `api/src/services/mapkitService.js`:
- Generates a signed MapKit JWT from `APPLE_MAPS_KEY_ID`, `APPLE_MAPS_TEAM_ID`, `APPLE_MAPS_PRIVATE_KEY` env vars
- Exports `searchPlace(query, lat, lng)` — calls `GET https://maps-api.apple.com/v1/search` and returns the top result as `{ place_name, address, mapkit_stable_id }`

New route `GET /places/search?q=<merchant>&lat=<lat>&lng=<lng>`:
- Validates params, calls `searchPlace`, returns top result or `null`
- Authenticated (requires valid session)

Add to `api/.env.example`:
```
APPLE_MAPS_KEY_ID=your-key-id
APPLE_MAPS_TEAM_ID=your-team-id
APPLE_MAPS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
```

### Frontend

In `confirm.js`, on mount: if `merchant` is non-null, request location permission and — if granted — call `GET /places/search?q=<merchant>&lat=<lat>&lng=<lng>`. Pre-populate `locationData` with the result. User can still override or clear via the existing `LocationPicker`.

If no location permission or no result returned, fall back to current behavior (empty location, user taps to add manually).

**Files:** `api/src/services/mapkitService.js` (new), `api/src/routes/places.js` (new), `api/src/index.js`, `api/.env.example`, `mobile/app/confirm.js`

---

## 5. Budget Redesign — Individual Budgets (Bug 5)

**Problem:** All budget endpoints call `requireHousehold` which returns 403 for users without a `household_id`. Solo users cannot set a budget. Budget is stored per-household with no per-user granularity.

**Approach:** User-scoped budget_settings. Household total is always a roll-up of member budgets — never set independently (override feature backlogged).

### DB Migration

```sql
ALTER TABLE budget_settings
  ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Allow household_id to be nullable
ALTER TABLE budget_settings
  ALTER COLUMN household_id DROP NOT NULL;

-- Ensure at least one scope is set
ALTER TABLE budget_settings
  ADD CONSTRAINT budget_settings_scope_check
  CHECK (user_id IS NOT NULL OR household_id IS NOT NULL);
```

Existing rows are unaffected (`user_id` defaults to NULL).

### API Changes (`api/src/routes/budgets.js`)

- Remove `requireHousehold`; replace with `requireUser` (returns user or 401, no household check)
- `GET /budgets`:
  - No household: return the authenticated user's budget settings
  - In household: query `budget_settings` for all members of the household, aggregate totals (sum of `monthly_limit`), return same response shape as today so the summary screen needs no changes
- `PUT /budgets/total`, `PUT /budgets/category/:id`, `DELETE /budgets/category/:id`: upsert/delete against `user_id` instead of `household_id`

### Model Changes (`api/src/models/budgetSetting.js`)

- `upsert({ userId, categoryId, monthlyLimit })` — scoped to user
- `findByUser(userId)` — new, replaces `findByHousehold` for solo path
- `findByHousehold(householdId)` — now does a JOIN across all household members' user rows and aggregates

**Files:** new migration SQL, `api/src/models/budgetSetting.js`, `api/src/routes/budgets.js`

---

## 6. Auth & Onboarding (Bugs 8 & 9)

### Bug 8 — Skip household creation in onboarding

**Problem:** `onboarding.js` forces Create or Join with no way to proceed as a solo user.

**Fix:** Add a "I'm tracking solo" tertiary text link below both buttons. Taps `router.replace('/(tabs)/summary')`. No API call — the user is already synced by the time they reach onboarding.

**Files:** `mobile/app/onboarding.js`

---

### Bug 9 — Anonymous local user

**Problem:** `login.js` only offers Google and Apple sign-in. Users who want to track expenses without creating an account are blocked.

**Fix:** Add a "Continue without account" link below social buttons. Calls `supabase.auth.signInAnonymously()`. Supabase fires `SIGNED_IN`, which `_layout.js` already handles — routing proceeds normally.

**Guard changes:**

- `mobile/app/_layout.js` `checkHousehold`: if `session.user.is_anonymous === true`, skip `/users/sync` (no name/email to sync) and route directly to `/onboarding`
- `api/src/routes/households.js`: check `is_anonymous` claim in JWT and return `403: "Create an account to join a household"` on all household mutation endpoints

Anonymous users can use all expense tracking features. Household features prompt account creation.

**Files:** `mobile/app/login.js`, `mobile/app/_layout.js`, `api/src/routes/households.js`

---

## 7. Past Months Navigation (Bug 10)

**Problem:** Summary and all-transactions screens are hardcoded to the current month. Users cannot view historical spend.

### UX

Both screens get a tappable month label (e.g. "March 2026"). Tapping opens a flat modal list showing the current month + 12 previous months. Selecting a month closes the modal and updates the view. A back-to-current-month affordance is shown when viewing a past month.

### Frontend

- `selectedMonth` state (default: current `YYYY-MM`) added to `summary.js` and `mobile/app/(tabs)/index.js`
- `useExpenses` and `useBudget` hooks accept an optional `month` param, appended as `?month=YYYY-MM` on fetch
- Month filtering currently done client-side in summary (`monthlyExpenses` filter) moves to server — local filter removed

### API Changes

- `GET /expenses` and `GET /expenses/household`: accept optional `?month=YYYY-MM`. When present, add `AND to_char(date, 'YYYY-MM') = $n` to the query. When absent, returns all (existing behavior preserved).
- `GET /budgets`: accept optional `?month=YYYY-MM`. When present, spending sub-queries use that month instead of `new Date().toISOString().slice(0, 7)`.

**Files:** `mobile/app/(tabs)/summary.js`, `mobile/app/(tabs)/index.js`, `mobile/hooks/useExpenses.js`, `mobile/hooks/useBudget.js`, `api/src/routes/expenses.js`, `api/src/routes/budgets.js`

---

## Out of Scope

- **Bug 4** (consolidate Google sign-in + Gmail OAuth): not a simple config change — requires `serverAuthCode` exchange flow. Left as separate flows.
- **Budget household override**: individual member budgets roll up automatically; manual household-level override deferred to backlog.
- **Email/password auth**: anonymous auth is in scope; email+password sign-up deferred to backlog.
