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
- Guided (step-by-step) entry mode (future v2; NL quick entry is the only manual path in v1)

---

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| Mobile | React Native + Expo | Reuses React knowledge from Popstart; Expo EAS handles iOS builds and App Store distribution |
| Backend | Node.js / Express | Consistent with existing Curious Trio backend patterns |
| Database | PostgreSQL | Relational data model; `pg` already used in Popstart |
| Auth | Auth0 | Already battle-tested in Popstart; single login across personal OS |
| AI | Claude API (Anthropic) | Vision for receipt scanning; text parsing for email + NL input; `@anthropic-ai/sdk` already in use |
| Location | Apple MapKit (MKLocalSearch) | Free with Apple Developer account; native iOS integration; no API key management |
| Image storage | Cloudflare R2 or AWS S3 | Receipt images uploaded before confirm; URL stored on Expense |
| Deploy | Expo EAS (iOS) · Railway or Render (API) · Supabase or Neon (Postgres) | |

---

## Data Model

### User
```
id              uuid PK
auth0_id        string UNIQUE
name            string
email           string
household_id    uuid FK → Household (nullable until household accepted)
created_at      timestamp
```

### Household
```
id              uuid PK
name            string
created_at      timestamp
```

### HouseholdInvite
```
id              uuid PK
household_id    uuid FK → Household
invited_email   string
invited_by      uuid FK → User
token           string UNIQUE
status          enum: pending | accepted | expired
expires_at      timestamp (72 hours after creation)
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
category_id     uuid FK → Category (nullable; null = Unclassified)
source          enum: manual | camera | email
status          enum: pending | confirmed
place_name      string (nullable; human-readable name from MapKit)
address         string (nullable)
mapkit_stable_id string (nullable; see Location Enrichment note)
notes           string (nullable)
raw_receipt_url string (nullable; uploaded to R2/S3 before confirm)
created_at      timestamp
```

**Note on `category_id` nullability:** `null` represents "Unclassified." The confirm screen always prompts the user to assign a category before confirming if none is pre-populated. No sentinel category row is needed.

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
hit_count       integer DEFAULT 1
created_at      timestamp
updated_at      timestamp
UNIQUE (household_id, merchant_name)
```

**Confidence display tiers** (derived from `hit_count` at read time):
- `hit_count >= 5` → `from memory ●●●●`
- `hit_count 2–4` → `from memory ●●●○`
- `hit_count = 1` → `suggested ●●○○`
- Claude fallback (no mapping yet) → `suggested ●○○○`

### DuplicateFlag
```
id              uuid PK
expense_id_a    uuid FK → Expense
expense_id_b    uuid FK → Expense
confidence      enum: exact | fuzzy | uncertain
status          enum: pending | kept_both | dismissed | replaced
resolved_by     uuid FK → User (nullable; set on resolution)
created_at      timestamp
```

**Resolution actions:**
- `kept_both` → both expenses remain confirmed; flag closed
- `dismissed` → `expense_id_b` (the newer/incoming expense) is soft-deleted (`status: dismissed` on Expense); `expense_id_a` retained
- `replaced` → `expense_id_a` (the original) is soft-deleted; `expense_id_b` promoted to confirmed

This requires adding `status: dismissed` to the `Expense.status` enum: `pending | confirmed | dismissed`.

### LineItem
```
id              uuid PK
expense_id      uuid FK → Expense
description     string
quantity        decimal (nullable; defaults to 1)
unit_price      decimal(10,2)
total_price     decimal(10,2)
created_at      timestamp
```

`Expense.amount` is always the top-level total. If line items are captured, `amount` should equal the sum of `LineItem.total_price` values — enforced as a server-side validation warning, not a hard constraint (receipt totals can include tax/tip not itemized).

Line items are optional on all expenses. They are captured automatically by Claude Vision (camera) and Claude email parsing where the source provides itemized data. For NL quick entry, line items can be added manually from the expense detail screen after confirming.

**Future use:** `LineItem.description` is the bridge to Popstart price comparison — "find this item cheaper" feature planned for a future personal OS integration.

### RecurringExpense
```
id                       uuid PK
household_id             uuid FK → Household
owned_by                 enum: household | user
user_id                  uuid FK → User (nullable; only set if owned_by = user)
merchant                 string
expected_amount          decimal(10,2)
category_id              uuid FK → Category
frequency                enum: daily | weekly | monthly | yearly
next_expected_date       date
last_matched_expense_id  uuid FK → Expense (nullable; null until first match)
created_at               timestamp
```

**Ownership:** `owned_by = household` means either member can edit or dismiss the template. `owned_by = user` means only the creating user manages it. Defaults to `household` for templates created during onboarding; user can override in Settings.

---

## Capture Paths

### Path A — Natural Language Quick Entry (primary)
1. User opens Add Expense → NL input field
2. Types natural language: `"242.50 trader joes"`, `"lunch chipotle 14.50"`, `"60 gas yesterday"`
3. Claude parses: amount, merchant, date (defaults to today if omitted), contextual notes
4. Apple MapKit (`MKLocalSearch`) queried with merchant name + device GPS → returns top match(es)
5. MerchantMapping checked for category → Claude fallback for unknown merchants
6. Confirm screen shown with all fields pre-filled; every field tappable to edit
7. If `category_id` is null at this point, category field is highlighted and required before confirm
8. User confirms → pipeline runs → lands in ledger

### Path B — Camera Receipt Scan
1. User taps "Scan receipt" → camera opens
2. Photo uploaded to R2/S3 → URL obtained
3. Claude Vision API call with image URL → extracts merchant, amount, date, line items
4. Apple MapKit enrichment on extracted merchant name + device GPS
5. Pre-filled confirm screen (same as Path A confirm) → user reviews and confirms
6. On unreadable receipt: "We couldn't read this clearly" → retry or switch to NL entry
7. If image upload fails: surface error, do not proceed to parsing

### Path C — Gmail Email Import (background)
1. User connects Gmail via OAuth (`gmail.readonly` scope) during onboarding (optional, skippable)
2. Backend cron job runs every 30 minutes, queries Gmail API for emails matching receipt patterns (subject keywords: "order confirmation", "your receipt", "order shipped", "invoice", "payment confirmation")
3. OAuth access token refreshed automatically using stored refresh token before each sync
4. Claude parses email body → extracts merchant, amount, date
5. Category suggested via MerchantMapping → Claude fallback
6. Expense created with `status: pending` → lands in **Pending Queue** — never auto-confirms
7. User reviews from Pending Queue, edits if needed, confirms

**Gmail sync failure:** Silent retry × 3 (exponential backoff), then surface reconnect prompt in Settings banner only. Never blocks the main app or shows a modal.

---

## Shared Processing Pipeline

Every expense (regardless of capture path) passes through on the server at confirm time:

### 1. Deduplication Check
- **Exact match:** same `merchant` + same `amount` + same `date` + same `household_id` → flag as `exact`
- **Fuzzy match:** same `merchant` + `amount` within ±$1 + `date` within ±2 days + same `household_id` → flag as `fuzzy`
- **Location match:** same `mapkit_stable_id` (if present) + same `amount` + same `date` + same `household_id` → flag as `exact`
- Scope: **cross-user within the same household only** (not across different households)
- Flagged duplicates create a `DuplicateFlag` record and appear in Pending Queue with orange indicator
- Email imports (`status: pending`) are checked against confirmed expenses only; two pending expenses are not cross-checked against each other

### 2. Category Assignment
1. Check `MerchantMapping` for `(household_id, merchant_name)` → apply category (no API call)
2. If no mapping: Claude API call with merchant name + MapKit place type + household category list → returns best match
3. Confirmed category upserts `MerchantMapping` (increments `hit_count`)
4. Confidence tier displayed on confirm screen per thresholds defined in MerchantMapping section above

### 3. Recurring Match
- Check new confirmed expense against `RecurringExpense` templates for same `household_id`: merchant match + date within ±5 days of `next_expected_date`
- If matched: set `last_matched_expense_id`, advance `next_expected_date` by one frequency interval
- If `next_expected_date` is more than 3 days in the past with no match: trigger overdue push notification (once per overdue period, not repeated daily)

---

## Offline Handling

- Expenses entered offline are stored locally in AsyncStorage with a `sync_status: queued` flag
- On reconnect, queued expenses are submitted to the server in creation order
- Dedup check runs server-side on sync; a queued expense may be flagged as a duplicate of one entered by the partner while offline — this is expected and surfaces in Pending Queue normally
- Receipt images (Path B) require connectivity; camera path is disabled offline with a banner: "Receipt scanning requires a connection. Use quick entry instead."
- `status` on the local record is set to `pending` until server confirms; UI shows a subtle sync indicator on affected expenses

---

## Location Enrichment (Apple MapKit)

**Implementation note:** `MKLocalSearch` returns `MKMapItem` results. `MKMapItem` does not expose a stable persistent place ID. The `mapkit_stable_id` field stores a composite key of `(name + coordinate rounded to 4 decimal places)` as a best-effort stable identifier for dedup purposes. This is a known limitation vs. Google Places; it is sufficient for same-device dedup but may produce false negatives across different devices or if a business moves. This tradeoff is accepted for v1.

- Triggered after NL parse or receipt scan extracts merchant name
- Query: `MKLocalSearch` with merchant name + device GPS region
- Returns: place name, full address, coordinate, place category
- Place category feeds category suggestion (e.g. `Food` → Dining, `GasStation` → Gas)
- Multiple results (>1) → inline picker on confirm screen showing name + address
- Zero results → address fields left blank, no error shown
- Offline or location permission denied → skip enrichment, proceed with merchant name only

---

## Notifications

| Trigger | Message | Timing |
|---|---|---|
| New email receipt detected | "Amazon · $47.32 detected — tap to review" | On sync completion |
| Duplicate flagged | "Possible duplicate: Trader Joe's · $84.17 — tap to resolve" | On flag creation |
| Recurring expense matched | "Netflix · $15.99 matched and logged" | On confirm |
| Recurring expense overdue | "Rent · $2,400 expected 3 days ago — not yet seen" | Once, when `next_expected_date` + 3 days passes |
| Monthly wrap | "March closed · Household spent $1,842" | Server cron: 8am on the 1st of each month |

Partner expense activity: **not notified in real-time** (too noisy). Visible in Household feed passively.

Monthly wrap cron: runs at 8am on the 1st. Sends to all household members with at least one confirmed expense in the prior month. Users with no app activity that month still receive the notification if their household has expenses.

---

## Onboarding (5 Steps)

1. **Account** — Auth0 sign-in (email/password or Google SSO). Same credentials as Popstart.
2. **Household** — Name the household. Invite partner via email (generates a `HouseholdInvite` token, 72-hour expiry). Partner receives an email with a deep link. On acceptance, partner's `User.household_id` is set and both feeds are linked. Expenses entered by either user before acceptance are **not retroactively linked** — they remain on each user's individual account until the household is joined. Invite can be resent or cancelled from Settings.
3. **Categories** — Start from a default list or type in existing category names from Spending Tracker manually. No CSV import in v1; manual re-entry is intentional (forces the user to actively choose their categories). Household-scoped; shared between all members.
4. **Gmail** — Connect Gmail for automatic receipt import. OAuth scope: `gmail.readonly`. Clearly explained as scoped to receipt/order emails. Skippable; accessible later in Settings.
5. **First expense** — Prompted to add one expense via NL quick entry immediately. Builds the habit and validates the parser for the user's input style.

---

## Error States

| Scenario | Behavior |
|---|---|
| Receipt unreadable by Claude | "We couldn't read this receipt clearly." → retry scan or switch to NL entry |
| Receipt image upload fails | "Couldn't save the image. Try again or use quick entry." → do not proceed to parsing |
| Offline (manual/NL entry) | Queue locally, sync on reconnect, show sync indicator on affected expenses |
| Offline (camera scan) | Camera path disabled with banner; user redirected to NL entry |
| Gmail sync failure | Silent retry × 3 (exponential backoff) → Settings banner reconnect prompt only |
| MapKit zero results | Skip enrichment silently; address fields blank on confirm screen |
| Claude API timeout (NL/email parse) | Surface "Couldn't parse that — enter details manually" on confirm screen with all fields blank |
| Claude API timeout (category) | `category_id` left null; confirm screen highlights category field as required |
| Household invite expired | Resend prompt shown in Settings; original token invalidated |

---

## Security

### Authentication & Authorization
- All API requests authenticated via Auth0 JWT; token validated on every request
- **Household isolation is enforced at the query level** — every database query scopes to the requesting user's `household_id`. A valid token does not grant access to other households. This is the most critical security invariant in the system.
- `RecurringExpense` and `Category` records owned by a household are accessible to all household members; `owned_by: user` records are accessible only to the owning user
- Household invite tokens are cryptographically random (UUID v4 or equivalent); single-use — marked `accepted` or `expired` immediately on use; 72-hour expiry enforced server-side

### Data in Transit & at Rest
- All client-server communication over HTTPS/TLS only
- PostgreSQL encryption at rest handled by hosting provider (Supabase or Neon)
- Receipt images stored in R2/S3 as **private objects** — never publicly accessible URLs. Client accesses images via short-lived signed URLs (15-minute expiry) generated by the backend on demand

### Gmail OAuth
- Scope limited to `gmail.readonly` — minimum necessary permission
- OAuth refresh tokens stored encrypted at rest in the database
- On Gmail disconnect (Settings): refresh token revoked via Gmail API and deleted from database immediately

### Claude API & Prompt Injection
- Claude API key stored as a server-side environment variable only — never sent to the client
- User input passed to Claude (NL entry, email body, receipt text) is always wrapped in a structured system prompt with explicit output format constraints to limit prompt injection surface
- Claude responses are parsed as structured data (JSON); free-form text from Claude is never rendered directly in the UI

### Receipt Image Upload
- File type validated server-side (JPEG/PNG only; reject all other MIME types)
- File size capped at 10MB server-side
- Images uploaded via a server-proxied flow — client requests a signed upload URL from the backend, uploads directly to R2/S3; AWS/Cloudflare credentials are never exposed to the client

### API Rate Limiting
- Rate limiting applied to all endpoints; stricter limits on auth, Claude-dependent, and Gmail sync endpoints
- Protects against abuse and controls Claude API costs

### PII & Logging
- Expense amounts, merchant names, and email content are never written to application logs
- User deletion cascades to all associated data: expenses, line items, merchant mappings, recurring expenses, duplicate flags, household membership. If the deleted user is the last household member, the household record is also deleted.
- App does not collect analytics beyond what is necessary for core functionality

---

## Future Considerations (not v1)

- **Guided entry mode:** step-by-step conversational entry for new users or complex inputs
- **Budget envelopes:** category-level monthly limits with progress tracking
- **CSV import:** from bank statement exports for historical data
- **Spending Tracker data import:** bulk import of historical expenses via CSV export
- **Pattern detection:** query-based recurring pattern identification from expense history (no schema change needed)
- **Android:** React Native cross-platform once iOS is validated
- **Additional household members:** data model already supports multiple members per household
- **Google Places API:** upgrade from MapKit if location coverage proves insufficient
- **Parenting OS module:** next app in the Curious Trio personal OS
- **Popstart price comparison:** tap a line item → "find this cheaper" → Popstart search pre-loaded with that product description
- **Popstart integration:** shared Auth0 login already planned; unified navigation shell as the OS matures
