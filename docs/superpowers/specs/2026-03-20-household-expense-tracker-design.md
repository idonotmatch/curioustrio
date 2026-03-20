# Household Expense Tracker — Design Spec
**Date:** 2026-03-20
**Project:** Curious Trio Personal OS
**Status:** Approved for implementation

---

## Overview

A native iOS expense tracker for households. Replaces Spending Tracker for a two-person household (extensible to more members). Individual expense feeds roll up into a shared household view. Three capture paths feed a single processing pipeline. Designed as the second app in the Curious Trio personal OS, following Popstart.

---

## Goals

- Replace Spending Tracker with a faster, smarter alternative
- Support shared visibility between two household members
- Reduce manual entry friction via natural language input, receipt scanning, and email import
- Auto-categorize expenses using household-defined categories
- Flag duplicate expenses across all capture paths
- Track recurring expenses and surface overdue bills

### Out of Scope (v1)

- Direct bank/Plaid connections
- Investment or portfolio tracking
- Financial advice or projections
- Android support (web-first after iOS validation)
- Budget limits or envelope budgeting (future v2)

---

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| Mobile | React Native + Expo | Reuses React knowledge from Popstart; Expo EAS handles iOS builds and App Store distribution |
| Backend | Node.js / Express | Consistent with existing Curious Trio backend patterns |
| Database | PostgreSQL | Relational data model; `pg` already used in Popstart |
| Auth | Auth0 | Already battle-tested in Popstart; single login across personal OS |
| AI | Claude API (Anthropic) | Vision for receipt scanning; text parsing for email + NL input; `@anthropic-ai/sdk` already in use |
| Location | Apple MapKit | Free with Apple Developer account; native iOS integration; no API key management |
| Deploy | Expo EAS (iOS) · Railway or Render (API) · Supabase or Neon (Postgres) | |

---

## Data Model

### User
```
id              uuid PK
auth0_id        string UNIQUE
name            string
email           string
household_id    uuid FK → Household
created_at      timestamp
```

### Household
```
id              uuid PK
name            string
created_at      timestamp
```

### Expense
```
id              uuid PK
user_id         uuid FK → User
household_id    uuid FK → Household
merchant        string
amount          decimal(10,2)
date            date
category_id     uuid FK → Category
source          enum: manual | camera | email
status          enum: pending | confirmed
place_id        string (Apple MapKit place identifier)
place_name      string
address         string
notes           string
raw_receipt_url string (S3 or similar for receipt image)
created_at      timestamp
```

### Category
```
id              uuid PK
household_id    uuid FK → Household
name            string
icon            string
color           string
created_at      timestamp
```

### MerchantMapping
```
id              uuid PK
household_id    uuid FK → Household
merchant_name   string
category_id     uuid FK → Category
hit_count       integer (for confidence scoring)
updated_at      timestamp
UNIQUE (household_id, merchant_name)
```

### DuplicateFlag
```
id              uuid PK
expense_id_a    uuid FK → Expense
expense_id_b    uuid FK → Expense
confidence      enum: exact | fuzzy | uncertain
status          enum: pending | kept_both | dismissed
created_at      timestamp
```

### RecurringExpense
```
id              uuid PK
household_id    uuid FK → Household
user_id         uuid FK → User
merchant        string
expected_amount decimal(10,2)
category_id     uuid FK → Category
frequency       enum: daily | weekly | monthly | yearly
next_expected_date  date
last_matched_expense_id  uuid FK → Expense
created_at      timestamp
```

---

## Capture Paths

### Path A — Natural Language Quick Entry (primary)
1. User opens Add Expense → defaults to "quick" mode
2. Types natural language: `"242.50 trader joes"`, `"lunch chipotle 14.50"`, `"60 gas yesterday"`
3. Claude parses: amount, merchant, date (defaults to today if omitted), contextual notes
4. Apple MapKit queried with merchant name + device GPS → returns specific location
5. MerchantMapping checked for category → Claude fallback for unknown merchants
6. Confirm screen shown with all fields pre-filled; every field tappable to edit
7. User confirms → pipeline runs → lands in ledger

**Guided mode fallback:** Step-by-step conversational entry available via toggle for new users or complex entries.

### Path B — Camera Receipt Scan
1. User taps "Scan receipt" → camera opens
2. Photo captured
3. Claude Vision API call → extracts merchant, amount, date, line items
4. Apple MapKit enrichment on extracted merchant name + device GPS
5. Pre-filled confirm screen → user reviews and confirms
6. On unreadable receipt: "We couldn't read this clearly" → retry or enter manually

### Path C — Gmail Email Import (background)
1. User connects Gmail via OAuth during onboarding (optional, skippable)
2. Background sync job polls for emails matching receipt/order patterns (subject: "order confirmation", "your receipt", "order shipped", etc.)
3. Claude parses email body → extracts merchant, amount, date
4. Category suggested via MerchantMapping → Claude fallback
5. Expense lands in **Pending Queue** with `status: pending` — never auto-confirms
6. User reviews from Pending Queue, edits if needed, confirms

**Gmail sync failure:** Silent retry × 3, then surface reconnect prompt in Settings only. Never blocks the main app.

---

## Shared Processing Pipeline

Every expense (regardless of capture path) passes through:

### 1. Deduplication Check
- **Exact match:** same merchant + same amount + same date + same household → auto-flag, high confidence
- **Fuzzy match:** same merchant + amount within ±$1 + date within ±2 days → flag with lower confidence
- **Place ID match:** same `place_id` + same amount + same date → near-certain duplicate
- **Cross-user check:** runs across all household members, not just the submitting user
- Flagged duplicates appear in Pending Queue with orange indicator
- User resolves: keep both | dismiss new | replace original

### 2. Category Assignment
1. Check `MerchantMapping` for household's known merchant → apply category (no API call)
2. If unknown merchant: Claude API call with merchant name + place type (from MapKit) + household category list → returns best match + confidence score
3. Confirmed category updates `MerchantMapping` (increments `hit_count`)
4. Confidence displayed: `from memory ●●●●` vs `suggested ●●○○`

### 3. Recurring Match
- Check new expense against `RecurringExpense` templates: merchant + date within expected window
- If matched: link via `last_matched_expense_id`, update `next_expected_date`
- If a recurring expense's `next_expected_date` passes without a match: trigger overdue notification

---

## Core Screens

### My Feed
- Personal expense list, newest first
- Monthly total at top
- Filter by category, date range
- Tap expense to view/edit detail

### Pending Queue
- Badged count on tab when items present
- Two sections: **Review** (email imports) and **Duplicates** (flagged conflicts)
- Inline confirm/discard actions

### Household View
- Side-by-side individual totals for each member
- Combined household total
- Shared expense feed filterable by member
- Monthly and category breakdowns

### Add Expense
- Quick (NL) / Guided toggle
- NL input with example hints
- Confirm screen with all parsed fields + location chip
- Location picker if MapKit returns multiple matches

### Settings
- Profile
- Household members (invite, remove)
- Categories (add, rename, reorder)
- Gmail connection (connect / reconnect / disconnect)
- Recurring expenses (manage templates)
- Notification preferences

---

## Location Enrichment (Apple MapKit)

- Triggered after NL parse or receipt scan extracts merchant name
- Query: merchant name + device GPS coordinates
- Returns: `place_id`, `place_name`, full `address`, place type
- Place type feeds category suggestion (e.g. `restaurant` → Dining, `gas_station` → Gas)
- Multiple results → inline picker on confirm screen
- Offline or permission denied → graceful fallback to merchant name only
- `place_id` stored on `Expense` for dedup and future location-based analytics

---

## Notifications

| Trigger | Message |
|---|---|
| New email receipt detected | "Amazon · $47.32 detected — tap to review" |
| Duplicate flagged | "Possible duplicate: Trader Joe's · $84.17 — tap to resolve" |
| Recurring expense matched | "Netflix · $15.99 matched and logged" |
| Recurring expense overdue | "Rent · $2,400 expected 3 days ago — not yet seen" |
| Monthly wrap | "March closed · Household spent $1,842" |

Partner expense activity: **not notified in real-time** (too noisy). Visible in Household feed passively.

---

## Onboarding (5 Steps)

1. **Account** — Auth0 sign-in (email/password or Google SSO). Same credentials as Popstart.
2. **Household** — Name the household. Invite partner via email or shareable link. Partner receives push + email notification; once accepted, feeds are linked.
3. **Categories** — Start from defaults or enter existing categories from Spending Tracker. Household-scoped; shared between all members.
4. **Gmail** — Connect Gmail for automatic receipt import. Clearly scoped to receipt emails only. Skippable; accessible later in Settings.
5. **First expense** — Prompted to add one expense immediately. Builds the habit and validates the NL parser for the user's input style.

---

## Error States

| Scenario | Behavior |
|---|---|
| Receipt unreadable by Claude | "We couldn't read this receipt clearly." → retry scan or enter manually |
| Offline | Expenses queued locally (AsyncStorage); synced automatically on reconnect. Badge shows pending count. |
| Gmail sync failure | Silent retry × 3 → reconnect prompt in Settings only; never interrupts main app |
| MapKit no results | Confirm screen shows merchant name only; address field left blank |
| Claude API timeout | Fall back to unclassified category; user prompted to assign on confirm screen |

---

## Future Considerations (not v1)

- **Budget envelopes:** category-level monthly limits with progress tracking
- **CSV import:** from bank statement exports for historical data
- **Pattern detection:** query-based recurring pattern identification from expense history (no schema change needed)
- **Android:** React Native cross-platform once iOS is validated
- **Additional household members:** data model already supports multiple members per household
- **Parenting OS module:** next app in the Curious Trio personal OS
- **Popstart integration:** shared Auth0 login already planned; unified navigation shell as the OS matures
