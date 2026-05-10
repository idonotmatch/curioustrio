# Adlo Product One-Pager

## Overview

Adlo is a mobile-first personal and household finance companion focused on fast capture, intelligent categorization, recurring purchase understanding, and proactive insights. The app already supports manual, receipt, and Gmail-based expense capture; household-aware budgets and categories; a review queue for uncertain imports; and a live v1 insights engine that interprets user behavior instead of only recording transactions.

The product direction is moving from:

- expense tracker
- to financial memory + recurring purchase intelligence
- to a broader adaptive "finance companion OS"

The current architecture is already trending that way:

- mobile app with summary, feed, settings, queue, and detail screens
- backend analyzers for spending trends, recurring item behavior, Gmail import quality, and insight generation
- event/state tracking plus explicit user feedback for insights
- first-pass push notification dispatch for actionable insights

## Current Distribution Posture

Adlo is currently in a reasonable posture for private TestFlight use and OAuth setup work, but broader public distribution should be treated as a separate threshold.

Before pushing beyond limited testing, the product should have:

- an LLC or equivalent legal entity
- live public trust pages
- aligned support/contact identity
- stronger operational confidence around Gmail, privacy, and household correctness

That is less about product polish and more about responsible distribution readiness.

## Core Features

### 1. Expense Capture

**What it is**

- Manual natural-language entry
- Receipt scan parsing
- Gmail receipt/order import
- Confirm/review flow before saving uncertain inputs

**Current maturity**

- `Strong foundation`
- This is one of the most mature parts of the product today
- The capture system is already multi-channel, metadata-aware, and tightly connected to confirm/review rather than feeling like separate experiments

**What works today**

- NL parse -> confirm -> save
- receipt OCR parse -> confirm -> save
- Gmail sync and pending review queue
- duplicate protection has improved for Gmail imports
- contextual notes and date clamping in Gmail import
- receipt and Gmail flows can now preserve more location context
- confirm supports confidence hints, item editing, location editing, payment/card fields, privacy, and quick category creation
- Summary quick add can now jump straight into camera capture for receipt scanning instead of forcing a second tap through Add

**What’s next**

- stronger Gmail operations verification in prod
- better receipt/email provenance surfaced in confirm
- more robust automatic receipt-derived place resolution
- continued parser quality improvements for ambiguous merchant/date/location cases

**Ideal end state**

- capture feels near-effortless
- the app ingests expenses from text, receipts, and email with minimal cleanup
- uncertain fields are explicit and easy to correct
- sources are auditable and richly contextual

### 2. Transaction Feed + Expense Detail

**What it is**

- All Transactions feed
- review queue
- expense detail screen
- owner-aware editing, approval, dismissal, deletion, and recurring management

**Current maturity**

- `Strong foundation`
- This is one of the most mature product surfaces in the app
- The feed is already a real daily-use surface, and detail is already a central control screen rather than a thin CRUD page

**What works today**

- household vs mine feed
- pending queue with approve/dismiss
- item-level detail
- editable location, category, date, notes, items
- owner-only edit restrictions
- feed and summary refresh behavior improved after queue actions
- inline category editing and swipe actions in the feed
- duplicate visibility and pending review on detail
- recurring flag management from expense detail
- owner/privacy metadata and location display in transaction cards
- main confirm and approve flows now invalidate household-expense caches too, which improves consistency between Summary, feed, pending, and detail after changes are made

**What’s next**

- more refined drill-downs from insights into feed/detail
- queue review UX polish so it matches the maturity of feed/detail
- continued metadata/card polish and permission-consistency review

**Ideal end state**

- feed is the user’s living financial log
- detail screens are clean, explainable, and actionable
- every smart system in the app can route back to understandable underlying transactions

### 3. Budgets + Household Model

**What it is**

- personal and household budgets
- custom budget periods
- household membership and shared views

**Current maturity**

- `Strong foundation`
- Budgeting is already more than a simple progress-bar layer
- Personal and household budget periods, rollups, and shared views are real, while adaptive guidance on top is still early

**What works today**

- personal and household budget bars
- household-specific budget periods
- settings and household membership flows
- budget fit analysis in the insight engine
- summary already acts as a meaningful financial home surface
- household and personal scopes coexist in the same product model

**What’s next**

- better budget realism / recommendation logic
- deeper monthly trend explanations
- clearer budget adjustment suggestions backed by history
- stronger household surface and collaboration feel beyond the infrastructure layer

**Ideal end state**

- budgets are adaptive rather than static
- the app tells users whether budgets are realistic and why
- household and individual financial behavior coexist cleanly

### 4. Categories + Taxonomy

**What it is**

- hierarchical categories
- merchant/category memory
- AI-assisted suggestions
- default category overrides per household

**Current maturity**

- `Mature workflow surface`
- This is already a surprisingly complete taxonomy/admin system
- The gap here is more UX simplification than missing capability

**What works today**

- parent/child category model
- merchant mapping
- quick create with parent suggestion
- hidden/renamed household default categories
- suggestion triage and merge/move flows
- swipe actions, restore flows, and household-aware overrides

**What’s next**

- better hidden-default restore UX
- clearer distinction between overridden defaults vs true custom categories
- continued simplification of taxonomy-heavy workflows

**Ideal end state**

- categorization feels mostly automatic
- taxonomy stays tidy with minimal admin work
- users understand category behavior without learning internal concepts

### 5. Item Intelligence + Recurring Purchases

**What it is**

- item extraction from receipts/email
- product matching
- recurring item detection
- recurring watch candidates
- manual recurring flags

**Current maturity**

- `Emerging strategic differentiator`
- The backend foundation is already substantial
- The main gap is not missing primitives, but turning that foundation into broader user-facing leverage

**What works today**

- rich item metadata is preserved on save
- normalized comparable keys and size/pack fields exist
- first-pass unit-price-ready fields exist
- product matching goes beyond UPC/SKU
- recurring item detection works
- recurring price signals work
- recurring item history exists
- watch candidates exist
- user can manually mark a purchase as recurring
- recurring item push-eligible insight types exist

**What’s next**

- stronger fuzzy matching for groceries and produce
- more explicit item selection when flagging recurring inside multi-item expenses
- external price observation ingestion
- smarter watch timing and personalization over time

**Ideal end state**

- Adlo understands what the user actually buys, not just where they spent money
- recurring essentials, repurchase timing, and price patterns are first-class product concepts
- item-level intelligence becomes the foundation for savings and planning recommendations

### 6. Insights Engine

**What it is**

- backend-generated financial intelligence mapped into user-facing cards
- combines expense-level, item-level, and hybrid signals

**Current maturity**

- `Real v1 intelligence system`
- This has crossed the line from concept to operating subsystem
- It is still heuristic and early in personalization, but it is already producing, storing, ranking, logging, and dispatching real insight experiences

**What works today**

- Summary insights rail
- insight state (`seen`, `dismissed`)
- insight events (`shown`, `tapped`, `dismissed`, `helpful`, `not_helpful`, `acted`)
- recurring item price insights
- recurring repurchase due
- spending pace and budget fit insights
- top category driver
- one-offs driving variance
- recurring cost pressure
- projected month-end over/under budget insights
- category projection surge and category headroom insights
- recurring restock-window opportunity insights
- recurring item drill-down screen
- trend and budget drill-down screen
- correction reasons and optional freeform notes on not-helpful insights
- feedback-driven ranking and temporary suppression of low-value insight types
- first-pass automatic outcome inference for recurring opportunities and some projection/headroom behaviors
- insight push notification dispatch for selected actionable insight types

**What’s next**

- better ranking/personalization
- richer hybrid explanations
- stronger interaction feedback loops
- broader and more reliable inferred outcome coverage
- eventually learned ranking and adaptive thresholds

**Ideal end state**

- the app surfaces the right insight at the right time for the right user
- insights are proactive, explainable, and action-oriented
- the engine evolves from heuristics into a personalized adaptive layer

### 7. Notifications

**What it is**

- Expo push tokens
- backend push dispatch
- now includes first-pass insight push notifications

**Current maturity**

- `Early foundation`
- The infrastructure is real and already connected to insights, but notification strategy is intentionally narrow and still needs policy tuning

**What works today**

- push token registration
- push service wiring
- Gmail import notifications
- insight push dispatch for:
  - `recurring_repurchase_due`
  - `recurring_price_spike`

**What’s next**

- tighter push eligibility and cooldown rules
- stronger action/value thresholds
- ranking informed by real user interaction data

**Ideal end state**

- notifications are sparse, timely, trusted, and personalized
- the system interrupts only when it can genuinely help

## Highest-Leverage Next Work

1. external price observation foundation
2. deeper insight drill-downs and explanation surfaces
3. stronger ranking/personalization instrumentation
4. queue and household UX polish to match the maturity of feed/detail
5. continued Gmail reliability and observability work
