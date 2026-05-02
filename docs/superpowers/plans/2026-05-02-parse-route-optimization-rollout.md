# Parse Route Optimization Rollout

This document is the implementation and rollout checklist for speeding up and lowering the cost of Adlo's parsing routes without sacrificing trust.

The goal is not to make the parser clever in the abstract. The goal is to make the core capture flows feel fast, stay accurate enough to trust, and avoid paying for unnecessary model work on the hot paths.

This plan covers two route families:
- `POST /expenses/parse`
- `POST /expenses/scan`

It also covers the supporting systems that shape their cost and latency:
- category fallback
- place lookup
- ingest diagnostics
- retry behavior
- future enrichment architecture

## Current Cost and Latency Hotspots

These are the code paths this plan is trying to improve first:

- `api/src/services/nlParser.js`
  - currently every NL parse request pays for a model call, even when the input is simple enough for a deterministic fast path
- `api/src/services/expenseIngestService.js`
  - currently the scan path waits on category assignment and place lookup before returning
- `api/src/services/receiptParser.js`
  - currently one receipt can fan out into multiple image-model attempts across primary, fallback, and contextual retry paths
- `api/src/services/categoryAssigner.js`
  - currently a successful parse can still trigger a second model call just to obtain a category
- `api/src/services/mapkitService.js`
  - currently place lookup is treated like an in-request requirement rather than optional enrichment
- `api/src/models/ingestAttemptLog.js`
  - currently successful parses can still store verbose diagnostics that are more useful for failures than for routine traffic
- `api/src/services/ai.js`
  - currently vendor calls rely too heavily on default timeout behavior

## Success Criteria

### Product targets

- NL parse feels instant for common entries
- receipt scan reaches confirm noticeably faster
- confirm quality does not visibly regress
- users do not see more ambiguous or obviously wrong drafts

### Performance targets

- `POST /expenses/parse`
  - p50 under 500ms
  - p95 under 1500ms
- `POST /expenses/scan`
  - p50 under 4s
  - p95 under 8s

### Cost targets

- average model calls per NL parse request at or below 1.1
- average image-model calls per receipt scan request at or below 1.6
- category AI fallback materially reduced
- ingest log storage per successful parse materially reduced

### Quality guardrails

- amount accuracy does not materially regress
- merchant accuracy does not materially regress
- partial-parse rate does not spike
- uncategorized rate does not spike unexpectedly

## Shared Prerequisites

These must exist before any behavior-changing optimization ships.

### 1. Regression corpus

Build and maintain:
- 50-100 representative NL inputs
- 50-100 representative receipt images
- include known bad cases
- include both easy and adversarial examples

Track for each:
- expected amount
- expected merchant
- expected date
- expected category usefulness
- expected item usefulness

### 2. Observability

Before rollout, add or confirm metrics for:
- route duration
- model call count per request
- fallback attempted
- fallback succeeded
- context retry attempted
- context retry used
- category AI fallback used
- place lookup duration
- success / partial / failed by reason

### 3. Feature flags

Every behavior-changing optimization should ship behind a flag:
- `PARSING_NL_FAST_PATH`
- `PARSING_RECEIPT_SINGLE_RETRY_POLICY`
- `PARSING_ASYNC_PLACE_ENRICHMENT`
- `PARSING_CATEGORY_AI_FALLBACK_STRICT`
- `PARSING_SUCCESS_LOG_SLIM`
- `PARSING_VENDOR_TIMEOUTS`
- `PARSING_RECEIPT_FAMILY_STRATEGIES`
- `PARSING_ENRICHMENT_CACHE`
- `PARSING_CORRECTION_LEARNING`

### 4. Rollout sequence

Unless otherwise stated, use this sequence:
1. local/dev
2. your account only
3. tiny beta slice
4. broad beta
5. default-on

Do not merge more than one behavior-changing optimization slice in the same PR unless the second change is strictly instrumentation for the first. These routes are too core to bundle changes casually.

### 5. Minimum de-risk bar for every parser change

No optimization is considered ready to ship unless it includes all of the following:

- a tightly scoped behavior change
- a before/after comparison against the regression corpus
- metrics that show what changed in live traffic or controlled internal testing
- a flag or env switch that can disable the new behavior quickly
- an explicit ship gate and rollback note in this document
- a clear answer to whether the change is expected to help:
  - speed
  - cost
  - both

If any of those are missing, the slice is not ready for rollout.

### 6. Required rollout artifact package

Each behavior-changing slice should produce a small release package before it is enabled outside local/dev:

- one focused PR
- one short implementation note describing the scope and user-visible effect
- one corpus diff summary:
  - what improved
  - what regressed
  - what stayed flat
- one metrics snapshot covering:
  - latency
  - model calls
  - fallback usage
  - partial/failure rate
- one rollback path that can be executed without a code change if the issue is purely behavioral

This is the minimum package that lets us move quickly without guessing.

## Phase 0: Instrumentation and Baseline

### Scope

- add missing metrics
- run the existing routes unchanged
- collect baseline latency, fallback, and cost proxies

### Tasks

- [ ] instrument NL parse route duration and model-call count
- [ ] instrument receipt scan route duration and model-call count
- [ ] instrument category fallback usage rate
- [ ] instrument place lookup duration and failure rate
- [ ] add success-path payload-size estimate for ingest logs
- [ ] build simple internal summary for recent parsing health

### Ship gate

Do not begin Phase 1 until we have at least:
- one week of internal baseline traffic, or
- a manually exercised baseline corpus with recorded outputs

### Rollback

- metrics-only changes should be removable independently

## Phase 1A: Vendor Timeouts

This is the safest early win.

### Scope

Add explicit timeout budgets for:
- text model calls
- image model calls
- place lookup

### De-risk plan

- choose timeout values from measured baseline, not instinct
- define fallback behavior per service before enabling
- log timeout-specific reason codes
- start with conservative timeouts

### Tasks

- [ ] add timeout support in `api/src/services/ai.js`
- [ ] add timeout support in `api/src/services/mapkitService.js`
- [ ] return graceful parse failures, not hung requests
- [ ] log timeout reason separately from generic failure

### Ship gate

- p95 and p99 latency improve or stay flat
- timeout-induced failure rate stays acceptable
- no increase in “blank confirm” or obviously broken parse reports

### Rollback

- [ ] all timeout budgets configurable by env
- [ ] one env change restores old behavior

## Phase 1B: Slim Success-Path Ingest Logs

This is mostly operational and privacy hygiene.

### Scope

Reduce verbose metadata on successful parses while preserving debugging quality for failures and partials.

### De-risk plan

- keep rich diagnostics for:
  - failures
  - partial parses
  - sampled successful parses
- preserve structured summaries on every attempt
- validate that current debugging workflows still work

### Tasks

- [ ] inventory which ingest metadata is used operationally today
- [ ] keep raw previews only for failure / partial / sampled success
- [ ] store metrics, reason codes, parser mode, and durations on all attempts
- [ ] add sampling control for verbose success-path logs

### Ship gate

- debugging recent failures is still practical
- storage footprint drops on success-heavy traffic

### Rollback

- [ ] raise success sampling or restore full logging via flag

## Phase 1C: Remove Blocking Place Lookup from `/scan`

This should improve scan-to-confirm time with relatively low product risk if handled cleanly.

### Scope

Stop waiting on place lookup before returning the parsed draft from `/expenses/scan`.

### De-risk plan

- define explicit location state:
  - `missing`
  - `derived`
  - `enriched`
- audit all client surfaces that currently assume location may already exist
- ensure no async enrichment can overwrite user-edited location

### Tasks

- [ ] inventory location assumptions across confirm, expense detail, and manual add
- [ ] remove `searchPlace(...)` from the blocking scan response path
- [ ] return parse immediately with current merchant/address/store fields
- [ ] decide whether place enrichment happens:
  - on confirm
  - after confirm
  - lazily on client
- [ ] add location ownership rules if enrichment can happen later

### Ship gate

- confirm screen remains fully usable when location is absent
- scan-to-confirm latency improves materially
- no user-visible location churn after manual edits

### Rollback

- [ ] flag to restore synchronous place lookup

## Phase 1D: Tighten Category AI Fallback

This is a cost optimization that can hurt downstream usefulness if done carelessly.

### Scope

Reduce AI category fallback usage where its real value is low.

### De-risk plan

- measure current fallback frequency first
- measure current fallback value before changing policy
- start with shadow evaluation before behavior cutover

### Tasks

- [ ] measure fallback rate for NL parse and receipt scan separately
- [ ] measure how often fallback categories survive confirm unchanged
- [ ] measure how often fallback categories are corrected by users
- [ ] define explicit eligibility for AI fallback
- [ ] skip AI fallback for low-value generic cases

### Ship gate

- uncategorized rate does not jump unexpectedly
- corrected-category rate does not materially worsen
- cost per parse request decreases

### Rollback

- [ ] flag restores current AI fallback policy

## Phase 2A: NL Deterministic Fast Path

This is a high-leverage change, but it needs shadow mode first.

### Scope

Handle common NL patterns locally before calling the model.

### De-risk plan

- start in shadow mode only
- compare deterministic result to current AI result
- only promote patterns with high agreement
- fall through to AI aggressively when anything is ambiguous

### Candidate fast-path patterns

- merchant + amount
- description + amount
- merchant + amount + relative date
- merchant + amount + payment hint
- refund from merchant + amount

### Tasks

- [ ] build deterministic parser for a small set of high-confidence patterns
- [ ] run deterministic parse in shadow mode while still returning AI output
- [ ] log agreement / disagreement by field
- [ ] add explicit ambiguity escape hatch
- [ ] enable only for patterns that clear quality thresholds

### Ship gate

- amount agreement >= 98%
- merchant/description agreement >= 95%
- no meaningful regression on tricky corpus entries
- route latency improves on fast-path hits

### Rollback

- [ ] flag fully disables deterministic fast path

## Phase 2B: Cap Receipt Retry Fanout

This is the largest immediate cost lever on scans.

### Scope

Reduce receipt parse fanout so one request can use:
- one primary parse
- at most one retry strategy

Not:
- primary + fallback
- then contextual primary + contextual fallback

### De-risk plan

- use labeled receipt corpus to simulate old vs new strategy
- compare first-pass success, retry benefit, and regression rate
- only cut fanout if quality stays within tolerance

### Proposed policy

- primary generic parse always runs
- if priors exist and the case is eligible, run one contextual retry
- otherwise run one fallback prompt
- never run both retry strategies on the same request

### Tasks

- [ ] label corpus with first-pass vs retry-only success
- [ ] simulate capped retry strategy offline
- [ ] log retry-improved vs retry-unnecessary rates
- [ ] implement single-retry policy behind flag

### Ship gate

- receipt latency drops materially
- image-model call count drops materially
- amount and merchant accuracy do not materially regress
- partial rate does not spike

### Rollback

- [ ] flag restores current fanout strategy

## Phase 2C: Family-Specific Receipt Strategies

This is an accuracy and cost lever, but only after we trust family detection.

### Scope

Use different parse strategies for a small number of high-volume receipt families.

### Initial candidate families

- grocery
- big-box retail
- restaurant
- pharmacy
- gas

### De-risk plan

- begin with passive classification only
- do not change parsing behavior until classification quality is known
- enable family logic per family, not globally
- always retain generic fallback

### Tasks

- [ ] build passive family labeling
- [ ] measure classification quality on the corpus
- [ ] implement one or two family-specific strategies first
- [ ] compare each family-specific strategy against generic baseline

### Ship gate

- targeted family improves without harming generic fallback behavior
- misclassification does not create worse outcomes than today

### Rollback

- [ ] toggle family strategies per family

## Phase 3A: Enrichment Cache

This can save cost later, but it should follow correctness signals, not lead them.

### Scope

Cache normalized enrichment outputs for repeated merchant/location cases.

### De-risk plan

- do not cache raw sensitive content
- use conservative keys
- never let cache overwrite user-owned fields
- measure cache-hit correction rate

### Tasks

- [ ] define cache key strategy
- [ ] cache only normalized outputs
- [ ] add short TTLs
- [ ] track accepted vs corrected cache hits

### Ship gate

- hit rate is meaningful
- correction rate on cache hits stays acceptably low

### Rollback

- [ ] disable cache reads independently of writes

## Phase 3B: Learning From User Corrections

This is valuable, but easiest to get wrong.

### Scope

Use repeated correction patterns to improve future suggestions.

### De-risk plan

- begin in observation-only mode
- require repeated evidence before learning
- keep learned values as suggestions, not silent truth
- separate user, household, and template scopes

### Tasks

- [ ] log correction events without changing behavior
- [ ] define promotion thresholds for learned rules
- [ ] attach provenance to learned outputs
- [ ] expose learned outputs as suggestions first

### Ship gate

- accepted learned suggestions rise over time
- corrected learned suggestions stay low
- no obvious feedback loops appear

### Rollback

- [ ] freeze new learning without deleting existing learned memory

## Phase 3C: Split Synchronous Parse From Async Enrichment

This is the highest coordination risk and should be phased last.

### Scope

Return a usable draft quickly, then enrich non-essential fields after.

### De-risk plan

- do not ship as one large refactor
- start with a single enrichment candidate, preferably place lookup
- define field ownership before any async updates ship
- require idempotent updates and explicit enrichment state

### Tasks

- [ ] define field ownership rules
- [ ] add enrichment status to payloads and persisted records
- [ ] choose one enrichment to move async first
- [ ] verify confirm/edit screens remain stable if enrichment arrives later

### Ship gate

- no surprise field overwrites
- no duplicate or conflicting updates
- no user-visible state churn

### Rollback

- [ ] disable async enrichment worker and return to synchronous flow

## Recommended Execution Order

1. Phase 0 instrumentation and baseline
2. Phase 1A vendor timeouts
3. Phase 1B slim success-path logs
4. Phase 1C remove blocking place lookup
5. Phase 1D tighten category AI fallback after baseline review
6. Phase 2A NL fast path in shadow mode
7. Phase 2B receipt retry fanout cap using corpus comparison
8. Phase 2C family-specific strategies
9. Phase 3A enrichment cache
10. Phase 3B correction learning
11. Phase 3C async enrichment split

## Go / No-Go Criteria

### Go for Phase 1

- baseline metrics exist
- flags exist
- regression corpus exists

### Go for Phase 2

- Phase 1 shipped cleanly
- no unexplained parse-quality regressions
- corpus comparisons prove the optimization is worth it

### Go for Phase 3

- enrichment ownership rules are explicit
- parse correctness is stable
- we are optimizing a mature flow, not a moving target

## Immediate Recommendation

If we start now, the first build slice should be:
- instrumentation
- vendor timeouts
- success-path log slimming
- removing blocking place lookup from `/scan`

Those are the best early wins with the lowest risk of eroding trust.
