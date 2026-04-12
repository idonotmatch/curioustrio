# Adlo Expense Tracker — Product & Engineering Review
*Reviewed: April 2026 | Codebase: curious-trio monorepo*

---

## 1. Core Intent

Adlo is a **personal-first, household-aware, AI-augmented expense tracker** designed to reduce the friction of financial awareness for everyday people. The core thesis is that most expense trackers fail because they require too much manual work — Adlo eliminates that by automatically capturing expenses from Gmail receipts, interpreting natural language input, and surfacing proactive intelligence (price spikes, recurring due dates, spending projections) so users don't need to audit their own data. The product is mobile-first (React Native/Expo), treats the individual as the source of truth for review and budgeting decisions, and then rolls those confirmed inputs up into household context when relevant. Claude remains the main intelligence layer across parsing, categorization, and insight generation.

---

## 2. Key Features — Maturity Assessment

| Feature | Today (Current State) | Ideal End State | Maturity |
|---|---|---|---|
| **Manual Expense Entry** | NL input → Claude parses to structured expense; camera/receipt OCR supported | Instant, zero-friction entry; voice input; smart pre-fills from history | 70% |
| **Gmail Auto-Import** | OAuth2 + scheduled sync; queue-first Gmail review flow; per-sender quality tracking; subject/snippet context; dismiss-reason feedback; learned treatment suggestions from similar history | Real-time streaming import; multi-provider (Outlook, Apple Mail); smarter pre-queue filtering and reconciliation across sources | 75% |
| **AI Categorization** | Claude assigns category; merchant_mappings cache for repeat merchants; category suggestor on input | Self-improving per household; learns corrections instantly; handles edge cases (split bills, reimbursable) | 60% |
| **Duplicate Detection** | Proportional threshold `GREATEST(1.00, amount × 2%)` + date ±2 days + merchant; flags uncertain cases for review | Cross-source deduplication (email + manual + bank); confidence scoring; user correction feedback loop | 50% |
| **Budget Tracking** | Monthly limits per category; spending bar; period configurable by start day; `Track only` expenses excluded from budget with structured reasons | Rolling budgets; goal-setting; carryover logic; "on track / at risk" forecasting per category; multiple budget buckets | 65% |
| **Household Sharing** | Multi-user households; private expense flag; shared expense view; invite via email; household context derived from confirmed individual inputs | Roles (owner/member/viewer); split expense tracking; household-level budgets vs individual; approval flow | 40% |
| **Spending Insights** | Price spikes, recurring-due-soon, buy-soon signals; early/developing insight lifecycle; personal-first hierarchy with household rollups; lineage-aware feedback loop; push notifications | Personalized recommendations; anomaly detection; subscription audit; net worth context; proactive alerts | 65% |
| **Recurring Detection** | Pattern detection across expense history; watch list; repurchase due date estimation | Subscription management (cancel alerts, price increases); recurring vs one-time budget separation | 45% |
| **Price Tracking** | Per-product price observation history; best-price signal for recurring items | Price trend graphs; store comparison; price drop notifications; basket optimization | 30% |
| **Trend Analysis** | Rolling 30-day category trends; projection to end of period; deep-dive per category | Year-over-year comparisons; custom date ranges; downloadable reports; anomaly explanation | 50% |
| **Location Tagging** | Apple MapKit place search; location stored on expense | Auto-suggest merchant from GPS at time of entry; map view of spend by location | 25% |
| **Push Notifications** | Insight notifications queued + dispatched via cron; device token registration | Rich notifications with inline actions; notification preferences; smart timing (don't notify at 2am) | 40% |
| **Web Dashboard** | Vercel config present; no frontend code exists | Full web companion for desktop review, reports, household admin | 5% |
| **Export / Reports** | None | CSV/PDF export; accountant-ready summaries; tax category tagging | 0% |

---

## 3. Inefficiencies, Bugs & Immediate Opportunities

### Bugs / Dead Code
- ~~**vercel.json rewrite** for `/submit-form → /api/submitForm` references an endpoint that does not exist anywhere in the codebase.~~ **Fixed: removed with Popstart artifact cleanup.**
- ~~**Backwards-compat query fallbacks** (e.g., `exclude_from_budget`, `budget_exclusion_reason`) silently retry without new columns on error.~~ **Fixed: collapsed to passthrough; `checkSchema.js` now validates required columns at startup.**
- ~~**Merchant normalization is inconsistent** — "Target", "target", "TARGET" can become separate merchants.~~ **Fixed: normalized to trimmed string at write in both POST and PATCH expense routes.**

### Performance Risks
- ~~**No DB connection pool tuning**~~ **Fixed: pool configurable via `DB_POOL_MAX` env var; SSL enforced in production.**
- ~~**Insight generation is unbounded**~~ **Fixed: `LIMIT 2000` added to expense queries in spendProjectionAnalyzer, spendingTrendAnalyzer, and recurringDetector; `LIMIT 10` on duplicate detection.**
- **No server-side caching layer** — every API call hits PostgreSQL. High-read paths (categories, household profile, budgets) are good candidates for in-memory or Redis caching.
- ~~**ingest_attempt_logs / email_import_feedback grow unbounded**~~ **Fixed: `POST /cron/prune-logs` deletes rows older than 90 days; weekly GitHub Actions workflow runs it automatically.**

### Architectural Gaps
- ~~**No API versioning**~~ **Fixed: routes mounted at `/v1/` alongside legacy aliases; mobile `api.js` auto-prepends `/v1`.**
- **Single AI model (Haiku)** — all Claude calls use `claude-haiku-4-5-20251001`. Haiku is fast and cheap but misses nuance in complex receipt parsing and insight generation. No model tiering (cheap for simple tasks, smarter for complex ones).
- **No OpenAPI spec** — routes are well-structured but undocumented. Any new developer or integration has to read source to understand contracts.
- ~~**Mobile test coverage is minimal**~~ **Fixed: Jest configured with jest-expo preset; 9 hook test files added covering all data-fetching hooks.**
- **Cron jobs are fire-and-forget** — `/cron/gmail-sync` and `/cron/insights-push` have no retry logic, no alerting on failure, no visibility into whether they ran.
- ~~**Duplicate detection threshold is brittle** — ±$1 / ±2 days works for obvious duplicates but over-matches daily same-merchant purchases.~~ **Fixed: proportional threshold `GREATEST(1.00, amount × 2%)` replaces flat ±$1.**
- **Review flow still leans on route-level resilience instead of a cleaner dependency boundary** — pending queue and Gmail review now survive missing optional tables and enrichment failures, which is good for uptime, but the number of best-effort fallbacks suggests the review pipeline should eventually be broken into clearer core vs optional layers.

### Remaining Quick Wins
1. ~~Add a startup schema check~~ Done.
2. Add logging/alerting on cron job failures (simple Slack webhook or email on non-200 response).
3. ~~Normalize merchant names at write time~~ Done.
4. ~~Cap insight queries with `LIMIT` clauses~~ Done.
5. ~~Delete the vercel.json dead rewrite~~ Done.
6. ~~Add `DB_POOL_MAX` env var to make DB pool tunable without a deploy~~ Done.

---

## 4. Feature Roadmap

### Phase 1 — Solidify Core Loop (Next 6 Weeks)
*Goal: make the daily expense → review → confirm loop faster and more accurate*

- **Smarter duplicate detection** — cross-source (email vs manual), confidence scoring, user correction feedback fed back to matching thresholds
- **Merchant normalization** — canonical merchant registry; fuzzy match at ingest; household learns corrections
- **NL input improvements** — handle multi-expense input in one message ("$45 at Whole Foods and $12 at Starbucks"); improve split/shared expense parsing; keep building item-level natural language entry beyond the new explicit `items:` and single-item inference paths
- **Confirm flow UX** — continue simplifying Gmail review and expense confirmation; current flow now includes subject/snippet context, similar-expense treatment suggestions, quick confirm, and direct `Private` / `Track only` controls without deep edit
- **Budget forecasting** — "at this rate you'll exceed Dining by $120" card on home screen; per-category risk signal

### Phase 2 — Household Intelligence (Weeks 7–14)
*Goal: make Adlo the source of truth for the whole household, not just the individual*

- **Split expense tracking** — expense created by one member, assigned proportionally to others; settlement tracking
- **Household roles** — owner vs member vs viewer; expense approval flow for shared purchases
- **Shared budget goals** — household-level budget distinct from individual; "family vacation fund" goal type
- **Subscription audit** — detect recurring charges from email + bank, surface as "subscriptions you're still paying" dashboard
- **Household spending digest** — weekly email/push summary across all members

Note: the current product direction is personal-first. Review ownership and budget decisions remain individual; household features should aggregate from confirmed personal inputs rather than introduce a shared pre-confirmation workflow.

### Phase 3 — Intelligence Layer (Weeks 15–22)
*Goal: proactive financial intelligence that makes Adlo feel like a financial advisor*

- **Model tiering** — Haiku for fast parsing tasks; Sonnet for insight generation and anomaly analysis
- **Anomaly detection** — "this charge is 3x your typical amount at this merchant"
- **Price drop alerts** — notify when a tracked product drops below historical best price
- **Tax category tagging** — mark expenses as business/deductible; generate tax-ready export
- **Natural language queries** — "how much did I spend on groceries last month vs the month before?"

### Phase 4 — Platform Expansion (Weeks 23–30)
*Goal: expand capture surface and reporting*

- **Web dashboard** — React/Next.js companion; desktop-optimized expense review, reports, household admin
- **Bank/card integration** — Plaid or open banking for automatic transaction import; reconcile against email receipts
- **Multi-provider email** — Outlook, Apple Mail support alongside Gmail
- **CSV/PDF export** — monthly reports, accountant export, tax summary
- **API documentation** — OpenAPI spec; developer-friendly for future integrations

---

## 5. Infrastructure, Stability & Security Roadmap

### Completed (April 2026 Sprint)
- [x] **Startup validation** — `checkEnv.js` validates all required env vars with format checks; `checkSchema.js` verifies required tables and columns; server refuses to start if either fails
- [x] **DB SSL + pool tuning** — SSL enforced in production (`rejectUnauthorized: true`); pool size configurable via `DB_POOL_MAX`; connection/idle timeouts set
- [x] **Error handler hardening** — production responses use generic labels for all error codes; internal details only exposed when `err.expose === true`
- [x] **PATCH authorization fix** — household members can now edit shared expenses; UUID validation on all `/:id` routes; `days` param clamped to 1–365
- [x] **Gmail OAuth TTL** — state tokens get explicit 10-minute `expires_at` on insert
- [x] **Merchant normalization at write** — POST and PATCH expense routes trim and normalize merchant before DB insert
- [x] **Unbounded query limits** — `LIMIT 2000` on expense history queries in projection/trend/recurring analyzers; `LIMIT 10` on duplicate detection
- [x] **Backwards-compat fallbacks removed** — `queryBudgetRelevant` collapsed to passthrough in all three analyzer services
- [x] **Duplicate detection threshold** — proportional `GREATEST(1.00, amount × 2%)` replaces flat ±$1
- [x] **Log retention** — `POST /cron/prune-logs` deletes rows older than 90 days from `ingest_attempt_log`, `email_import_feedback`, `insight_events`; weekly GitHub Actions workflow
- [x] **API versioning** — all routes mounted at `/v1/` alongside legacy aliases; mobile `api.js` auto-prepends `/v1`
- [x] **Mobile test coverage** — Jest with jest-expo preset; 9 hook test files covering all data-fetching hooks
- [x] **Per-user rate limiting** — `perUser` limiter (150 req/15min, keyed on `userId`) applied after `authenticate` in all 9 authenticated route files; `perUserAi` (15 req/1min) exported for AI-heavy endpoints
- [x] **Focused API stability lane** — `npm run test:stability` covers Gmail import quality, NL parsing, and insight builder core behavior without the full integration DB setup
- [x] **Schema compatibility check** — `npm run check:schema` verifies required Gmail review and budget-impact columns exist, and warns when optional best-effort tables are missing
- [x] **API stability workflow** — GitHub Actions now runs the focused API stability suite on API pushes and PRs
- [x] **Queue-first Gmail review** — Gmail imports always route through the user’s review queue before confirmation; sender quality changes review intensity, not queue entry
- [x] **Review queue hardening** — pending queue and expense detail routes now tolerate optional enrichment failures (`duplicate_flags`, Gmail sender preferences, Gmail hint attachment) instead of dropping pending items on the floor
- [x] **Track-only budget impact model** — expenses can be saved without counting toward budget, with structured exclusion reasons; budget and insight math respect the exclusion
- [x] **Gmail review feedback learning** — structured dismiss reasons, sender-level review trends, and similar-expense treatment suggestions now feed the Gmail review workflow
- [x] **Personal-first insight hierarchy** — insight consolidation, ranking, and lineage metadata now start from personal signals and layer household context on top

### Short-Term (4–8 Weeks)
- [ ] **Cron monitoring** — add webhook alerts (Slack/email) when cron jobs fail or return non-200
- [ ] **Error observability** — structured error logging (Sentry or similar); group AI failures, DB timeouts, auth errors separately
- [ ] **OpenAPI spec** — generate from route definitions; add to CI so drift is caught
- [ ] **Integration tests for confirm/review flows** — hook unit tests are in place; add end-to-end flow tests for the expense confirm and review queue paths

### Medium-Term (2–4 Months)
- [ ] **Caching layer** — Redis or in-memory LRU for categories, household profile, user settings (read-heavy, low-write paths)
- [ ] **Database query auditing** — enable slow query logging; establish baseline latency budgets per endpoint
- [ ] **Model upgrade path** — parameterize AI model selection; A/B test Haiku vs Sonnet on insight quality; add model version to AI response logs
- [ ] **Refresh token rotation hardening** — add token revocation endpoint; detect and alert on duplicate refresh token use
- [ ] **Penetration testing** — formal review of OAuth callback, JWT verification, cron endpoint, and private expense filtering before household sharing goes wide
- [ ] **Data retention compliance** — define and enforce retention policies for email bodies, user PII; add right-to-delete workflow
- [ ] **Staging environment parity** — ensure staging DB mirrors production schema; run migrations on staging before production

### Long-Term (4–6 Months)
- [ ] **Multi-region or read replica** — if user base grows, add a read replica to separate insight generation queries from transactional writes
- [ ] **SOC 2 / privacy audit** — if targeting financial data at scale, formal security audit and compliance posture
- [ ] **Webhook / event system** — internal event bus for decoupling email import → categorization → insight generation; enables retries and fan-out without blocking the request cycle
- [ ] **Blue-green deployments** — zero-downtime deploys on Render; currently any deploy creates a brief gap

---

*This document reflects the state of the codebase as of April 2026 and is intended as a living artifact. Update after each major milestone.*
