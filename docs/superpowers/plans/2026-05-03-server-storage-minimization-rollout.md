# Server Storage Minimization Rollout

**Goal:** Reduce server-side retention to the minimum needed for a user-ready launch, while preserving canonical expense data, Gmail connectivity, and the product behaviors that matter at go-live.

**Primary principle:** If data is not required for:
- account access
- canonical expense history
- budgets/categories
- Gmail re-import / dedupe
- push delivery
- or a clearly shipped cross-device feature

then it should either:
- be deleted,
- be retained only briefly,
- be aggregated,
- or be pushed to client-owned state.

---

## Scope

This plan focuses on these server-side storage families:

1. Gmail import data
2. Parse / ingest observability
3. Learning / memory tables
4. Insight / planning lifecycle state
5. Product-price intelligence
6. Retention / cleanup enforcement

---

## Keep vs Reduce

### Keep server-side

- `users`
- `households`
- `categories`
- `budget_settings`
- `expenses`
- `expense_items`
- encrypted `oauth_tokens.refresh_token`
- `push_tokens`
- minimal Gmail import dedupe ledger

### Reduce / redesign

- `email_import_log`
- `email_import_feedback`
- `ingest_attempt_log`
- `category_decision_events`
- `receipt_line_corrections`
- `insight_events`
- `insight_state`
- `insight_notifications`
- `scenario_memory`
- `product_price_observations`
- `recurring_preferences`

---

## Rollout rules

Use these rules across every phase:

- Ship schema additions before destructive cleanup.
- Prefer additive migrations plus backfill, then cut reads, then drop columns/tables later.
- Put every behavioral change behind a narrow config flag when it changes routing or feature behavior.
- Add retention jobs before relying on “soft expiry” semantics.
- For anything moved client-side, do not move raw sensitive content into plain AsyncStorage.

---

## Phase 0 - Safety rails

### Task 0.1: Add storage-minimization flags

**Goal:** Make the data-reduction path controllable without emergency code reverts.

**Add env/config flags**
- `GMAIL_MINIMAL_LOG_MODE`
- `INGEST_LOG_FAILURE_ONLY`
- `SERVER_SCENARIO_MEMORY_ENABLED`
- `INSIGHT_SERVER_EVENTS_ENABLED`
- `PRODUCT_PRICE_OBSERVATIONS_ENABLED`

**Files**
- `api/src/index.js`
- `api/src/services/internalTools.js` if a central helper is preferred
- optionally a new `api/src/services/storageMinimizationConfig.js`

**Ship gate**
- all flags default to current behavior first
- toggles can be read in runtime without boot failure

---

## Phase 1 - Gmail import minimization

### Task 1.1: Convert Gmail import rows to a minimal ledger

**Current sources**
- `api/src/db/migrations/002_gmail.sql`
- `api/src/db/migrations/020_email_import_log_detail.sql`
- `api/src/db/migrations/054_email_import_snippet.sql`
- `api/src/db/migrations/055_email_import_item_structure.sql`
- `api/src/models/emailImportLog.js`
- `api/src/services/gmailImporter.js`
- `api/src/services/expenseReviewContext.js`
- `api/src/services/emailReviewHint.js`
- `api/src/services/gmailImportQualityService.js`

**Target shape**

Keep:
- `user_id`
- `message_id` or `message_id_hash`
- `expense_id`
- `status`
- `skip_reason`
- `imported_at`
- `sender_domain`
- `subject_pattern`

Remove from long-lived storage:
- raw `from_address`
- full `subject`
- `snippet`
- `structured_item_block_level`
- `deterministic_item_count`

**Implementation steps**

- [ ] Add `sender_domain` and `subject_pattern` columns to `email_import_log`
- [ ] Backfill them from existing rows
- [ ] Update `gmailImporter` and `emailImportLog` writes to persist only minimal fields when `GMAIL_MINIMAL_LOG_MODE=1`
- [ ] Update `gmailImportQualityService` to read aggregate keys instead of raw subject/from rows
- [ ] Update review surfaces so they do not depend on long-lived persisted snippet/subject for resolved imports
- [ ] Stop returning raw message metadata once review is completed

**Migration approach**

1. Add new columns
2. Backfill domain/pattern
3. Cut reads to prefer minimal columns
4. Gate new writes to omit snippet/from/subject
5. After one release cycle, drop old columns

**Tests**
- `api/tests/models/emailImportLog.test.js`
- `api/tests/routes/gmail.test.js`
- targeted tests for `gmailImportQualityService`

**Risks**
- review queue UI may rely on old message context
- sender-quality summaries may regress until aggregate path is complete

**De-risk**
- preserve legacy reads during transition
- test resolved-import and pending-review cases separately

---

### Task 1.2: Add actual Gmail import retention enforcement

**Current gap**
- `expire_email_import_log()` exists in `002_gmail.sql`, but no runtime job currently calls it.

**Implementation steps**

- [ ] add a cron route or internal cleanup function that calls:
  - `expire_email_import_log()`
- [ ] choose a shorter launch retention window if acceptable:
  - 30 or 45 days instead of 90
- [ ] add visibility in logs for rows removed

**Files**
- `api/src/routes/cron.js`
- optionally a new cleanup service

**Ship gate**
- cleanup can run safely with no import breakage
- no pending-review rows are removed too early

---

## Phase 2 - Parse / ingest log minimization

### Task 2.1: Make ingest logs failure-first

**Current sources**
- `api/src/db/migrations/048_ingest_attempt_log.sql`
- `api/src/models/ingestAttemptLog.js`
- `api/src/services/parseIngestMetadata.js`
- `api/src/services/expenseIngestService.js`

**Target shape**

Keep for all rows:
- `source`
- `status`
- `failure_reason`
- compact metrics

Keep richly only for:
- failures
- partial parses
- tiny sampled successes

Remove from routine success rows:
- `input_preview`
- rich `parsed_snapshot`
- appended payment correction payloads
- verbose parser detail

**Implementation steps**

- [ ] add `detail_level` semantics explicitly to stored metadata if needed
- [ ] stop writing `input_preview` for successful NL parses
- [ ] stop writing success-path parsed snapshots unless sampled
- [ ] stop appending payment feedback onto successful ingest rows
- [ ] add a retention cleanup route/job for old ingest rows

**Recommended retention**
- failures / partials: 30 days
- success samples: 7 to 14 days

**Tests**
- `api/tests/services/expenseIngestService.test.js`
- `api/tests/services/expenseConfirmService.test.js`

**Migration approach**

This can start as a write-path change first, then add cleanup. No schema change is required unless we want a dedicated `expires_at` column.

---

## Phase 3 - Replace event-level learning with aggregate memory

### Task 3.1: Replace `category_decision_events` with aggregate learned mappings

**Current sources**
- `api/src/db/migrations/057_category_decision_events.sql`
- `api/src/models/categoryDecisionEvent.js`
- `api/src/services/categoryAssigner.js`

**Target shape**

Replace event-level storage with a new aggregate table, for example:
- `household_id`
- `match_scope` (`merchant_description`, `description`)
- `normalized_key`
- `final_category_id`
- `decision_count`
- `last_used_at`

Do not keep raw per-event merchant/description text longer than needed for migration.

**Implementation steps**

- [ ] add a new aggregate category learning table
- [ ] backfill aggregates from `category_decision_events`
- [ ] update `categoryAssigner` to read from aggregate table
- [ ] stop writing new raw decision-event rows
- [ ] optionally retain the old table briefly for rollback, then drop it

**Tests**
- `api/tests/services/categoryAssigner.test.js`
- any tests covering learned category reuse

---

### Task 3.2: Replace `receipt_line_corrections` with normalized aggregate aliases

**Current sources**
- `api/src/db/migrations/050_receipt_line_corrections.sql`
- `api/src/models/receiptLineCorrection.js`
- `api/src/services/receiptContextService.js`

**Target shape**

Keep:
- `household_id`
- `merchant`
- normalized raw key
- canonical label
- count
- `last_used_at`

Avoid storing raw OCR-like text variants indefinitely when normalization can carry the behavior.

**Implementation steps**

- [ ] add normalized alias key to the table or replace the table
- [ ] update writes to normalize before persist
- [ ] update `receiptContextService` to query normalized aliases
- [ ] add retention if stale corrections have not been used in a long time

---

### Task 3.3: Replace Gmail sender/template learning with aggregate counters

**Current sources**
- `api/src/services/gmailImportQualityService.js`
- `api/src/models/emailImportLog.js`
- `api/src/models/gmailSenderPreference.js`

**Target shape**

New aggregate table keyed by:
- `user_id`
- `sender_domain`
- `subject_pattern`

Keep counters only:
- imported
- dismissed
- edited
- approved clean
- review-needed
- top changed fields counts

**Implementation steps**

- [ ] add aggregate Gmail quality table
- [ ] backfill from historic review data
- [ ] update `gmailImportQualityService` to use aggregate table
- [ ] reduce dependence on `email_import_log` as an analytics store

---

## Phase 4 - Move non-canonical UX state off the server

### Task 4.1: Move insight seen/dismissed state client-side where possible

**Current sources**
- `api/src/db/migrations/030_insight_state.sql`
- `api/src/db/migrations/032_insight_events.sql`
- `api/src/db/migrations/033_insight_notifications.sql`
- `api/src/models/insightState.js`
- `api/src/models/insightEvent.js`
- `mobile/services/insightLocalStore.js`

**Recommendation**

Keep server-side:
- push-notification dedupe only if still needed
- minimal aggregate analytics if product wants them

Move client-side:
- `seen`
- local dismiss continuity
- detail-open continuity

**Important constraint**

Do not move raw sensitive evidence or rich insight data into plain AsyncStorage as a privacy “win.” Only derived UX state should move.

**Implementation steps**

- [ ] introduce a client-owned insight lifecycle store
- [ ] make server event writes optional via flag
- [ ] keep only minimal push dedupe server-side if necessary
- [ ] add TTL cleanup for any remaining raw event rows

---

### Task 4.2: Move non-watched `scenario_memory` client-side or hard-prune it

**Current sources**
- `api/src/db/migrations/038_scenario_memory.sql`
- `api/src/models/scenarioMemory.js`
- `api/src/routes/trends.js`

**Recommendation**

Keep server-side only if:
- the user explicitly watches a scenario
- cross-device revisit is part of the launch promise

Otherwise:
- keep drafts on-device
- prune expired rows nightly

**Implementation steps**

- [ ] classify scenario memory into:
  - watched
  - deferred
  - ephemeral draft
- [ ] keep only watched/deferred on server
- [ ] move ephemeral drafts to client
- [ ] add cleanup for expired rows

**Ship gate**
- watched-plans UX still works across devices
- scenario-check remains useful offline / locally

---

## Phase 5 - Product-price intelligence decision

### Task 5.1: Decide if product-price observation ships at launch

**Current sources**
- `api/src/db/migrations/034_product_price_observations.sql`
- `api/src/models/product.js`
- `api/src/models/productPriceObservation.js`
- `api/src/db/migrations/031_recurring_preferences.sql`

**Choice A - keep**
- if product-level price intelligence is a launch differentiator

**Choice B - slim**
- disable new `product_price_observations` writes
- keep product identity only where tied directly to confirmed expense items
- drop `url` and freeform `metadata` from observation storage if not critical

**Implementation steps**

- [ ] gate observation writes
- [ ] inventory every user-facing feature depending on `product_price_observations`
- [ ] if not launch-critical, stop collecting new rows before public launch

---

## Retention jobs

Add a real cleanup pass for:

- [ ] `email_import_log`
- [ ] `email_import_feedback`
- [ ] `ingest_attempt_log`
- [ ] `insight_events`
- [ ] `scenario_memory`
- [ ] stale learning aggregates if unused for a long time

Recommended home:
- `api/src/routes/cron.js`
- or a dedicated cleanup service called from cron

---

## Suggested execution order

1. Add config flags and cleanup framework
2. Minimize Gmail import rows
3. Minimize ingest logs
4. Aggregate category and receipt learning
5. Aggregate Gmail template quality
6. Move scenario drafts and insight lifecycle state client-side
7. Decide whether product-price observation remains enabled for launch

---

## Launch bar

### Must complete before public launch

- Gmail import row minimization
- ingest log minimization
- real cleanup jobs
- scenario memory cleanup or client move

### Strongly recommended before public launch

- aggregate learning instead of raw learning events
- slim or disable product-price observation writes
- insight event TTL or client shift

### Can wait until shortly after launch

- full removal of legacy columns/tables after migration period
- deeper local-storage hardening for non-sensitive UX caches

---

## Success criteria

We are done when:

- server retains only canonical expense/account data plus minimal operational state
- Gmail-derived review context is no longer stored long-term in human-readable form
- parse logs are failure-first instead of history-rich
- learning uses normalized aggregates instead of raw event histories
- expired soft-state rows are actually deleted, not just filtered out of reads

