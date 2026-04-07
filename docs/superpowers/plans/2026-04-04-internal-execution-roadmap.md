# Adlo Internal Execution Roadmap

## Objective

Move Adlo from a strong heuristic finance tracker with emerging intelligence into a trusted, proactive, and increasingly adaptive financial companion.

## Current State

### Foundation that is already working

- manual, receipt, and Gmail capture
- household-aware budgets and feed/detail flows
- summary as a meaningful financial home surface
- queue/review system
- category hierarchy and merchant memory
- item metadata preservation and normalization
- recurring purchase detection
- recurring item history and watch candidates
- insights surface with state, event logging, drill-down, explicit feedback, adaptive ranking/suppression, and first-pass push dispatch

### Recent progress on launch-readiness gaps

- trend and recurring insight drill-downs are live
- insight feedback now includes helpful / not helpful, correction reasons, and optional freeform notes
- user feedback now affects both ranking and temporary suppression of low-value insight types
- outcome-aware ranking is now in place for insight families that produce real follow-through
- inferred outcomes now exist for recurring restock / buy-soon opportunities and first-pass headroom usage cases
- explanatory insight review loops now exist for unusual spend, category shifts, and recurring cost pressure
- those review judgments now feed back into ranking so the engine can learn what users consider normal vs signal-worthy
- Summary receipt scan now jumps directly into camera capture
- the main mobile confirm and approve flows now invalidate household-expense caches, improving cross-surface consistency
- public Adlo trust pages now exist on `hellodang.com` for OAuth and broader distribution

### Strategic systems now in flight

- item intelligence
- recurring purchase intelligence
- spending trend intelligence
- insights engine

## Execution Priorities

## Priority 1: Legal Entity and Distribution Readiness

### Why

Adlo is still fine sitting in TestFlight, but broader distribution is a different threshold.

Before pushing out more widely, the product should have:

- an LLC or equivalent legal entity
- clear public trust materials
- a clean operator identity for support, OAuth, payments, and future subscriptions

### Scope

Complete:

- LLC/entity formation
- operator/contact alignment across the app and public pages
- public home page, privacy policy, and terms

### Outcome

Reduces:

- personal liability exposure
- distribution ambiguity
- trust friction during OAuth review and early growth

## Priority 2: Insight Productization and Trust

### Why

The insight engine is now materially smarter than the average surface it lands in.

We can already:

- generate meaningful personal and household insights
- log explicit feedback and downstream actions
- learn from one-off, category-shift, and recurring-pressure review judgments

We still need to make insights feel:

- more obviously useful in the moment
- better connected to the right next surface
- more adaptive in which explanatory cards are shown or down-ranked over time

### Scope

Build:

- stronger review destinations for explanatory cards
- cleaner action mapping from insight cards into review/planning/detail
- more closed-loop feedback paths where user judgment can train ranking

### Outcome

Unlocks:

- higher trust in insights
- better relevance over time
- clearer day-to-day product value for both solo and household users

## Priority 3: External Price Observation Foundation

### Why

This is still the missing piece for the recurring purchase value loop.

We can already:

- detect recurring items
- estimate repurchase timing
- identify price spikes and historical baselines

We still cannot:

- observe current external prices
- compare current market price to user baseline
- trigger proactive "buy soon, it is cheaper now" insights from external data

### Scope

Build:

- `product_price_observations` schema
- ingestion route/service
- comparison layer between watch candidates and observed prices

### Outcome

Unlocks:

- proactive savings opportunities
- pre-purchase price watch
- stronger recurring-item value proposition

## Priority 4: Notification Policy and Ranking

### Why

Push and on-screen insight surfaces now exist, but relevance will quickly become the limiting factor.

### Scope

Short term:

- tighten which insight types are eligible for push
- add throttling / cooldown rules
- tune thresholds and ordering

Medium term:

- keep tuning with event and feedback data (`shown`, `tapped`, `dismissed`, `helpful`, `not_helpful`, correction reasons)

### Outcome

Prevents:

- notification fatigue
- noisy insight surfaces
- erosion of trust

## Priority 5: Item Identity Quality

### Why

The accuracy ceiling for recurring/item intelligence is still constrained by fuzzy product identity, especially for groceries and produce.

### Scope

Improve:

- description-only product matching
- produce and variable-weight normalization
- merchant-aware aliasing
- multi-item recurring selection UX

### Outcome

Enables:

- better recurring detection
- cleaner price comparisons
- stronger recommendation quality

## Priority 6: Trend Intelligence Expansion

### Why

Trend insights are meaningful now, but still early.

### Scope

Expand:

- one-off vs recurring attribution
- projected over-budget insights
- category surge and merchant surge signals
- better budget realism guidance

### Outcome

Strengthens the "finance companion" value beyond recurring purchases.

## Product System Maturity by Area

### Expense Capture

**State**
- Strong foundation and one of the most mature product areas

**Next**
- parser/provenance improvements
- Gmail ops verification
- stronger location resolution

**Ideal**
- fast, low-friction, high-confidence capture from all channels

### Feed / Detail / Queue

**State**
- Strong foundation overall; queue is the less-polished sub-surface, and the highest-risk mobile cache-consistency gaps were tightened in core confirm/approve flows

**Next**
- better drill-down experiences from insights
- queue UX polish
- permission-consistency review and continued detail polish

**Ideal**
- the canonical place to inspect, edit, explain, and act on financial behavior

### Budgets / Household

**State**
- Strong budget foundation; household collaboration is more functional than differentiated

**Next**
- better realism recommendations and monthly guidance
- stronger household surface and collaboration feel

**Ideal**
- adaptive budgeting informed by actual behavior

### Insights

**State**
- Strong and getting meaningfully adaptive; cards, drill-downs, event logging, review loops, ranking, and suppression are all in place

**Next**
- improve the destination surfaces behind explanatory cards
- continue teaching the engine from explicit user judgments
- keep tightening which actions are most natural for each signal

**Ideal**
- a trustworthy, adaptive guidance layer that feels useful every day and clearly gets smarter from how the user responds

### Categories

**State**
- Mature workflow surface, with the main gap now being simplification

**Next**
- UX clarity and cleanup

**Ideal**
- mostly automatic, minimally managed taxonomy

### Item Intelligence

**State**
- Emerging strategic differentiator with strong backend foundations

**Next**
- identity quality
- external price observations

**Ideal**
- product-level financial memory and recommendation engine

### Insights Engine

**State**
- Real v1 intelligence system with first-pass feedback-driven adaptation

**Next**
- ranking and notification tuning
- richer hybrid insights
- feedback review and inspection during live testing
- stronger inferred-outcome coverage beyond the first recurring/headroom opportunity cases

**Ideal**
- adaptive, personalized, explainable financial guidance

## Near-Term Backlog

### Now

1. LLC / legal entity setup before broader distribution
2. Gmail OAuth approval and trust-surface verification
3. External price observation foundation
4. Push policy and insight ranking tuning
5. Expand inferred-outcome coverage and inspection for the insight engine
6. Queue and household UX polish
7. Gmail production ops verification
8. Real-device verification of cross-surface consistency and capture flows

### Next

9. Better grocery / produce identity
10. Stronger one-off vs recurring attribution
11. Category UX simplification
12. Transaction/detail polish

### Later

10. Learned ranking / personalization
11. Dynamic watch timing
12. Seasonal / longer-horizon trend intelligence
13. Broader proactive recommendation system

## Key Risks / Watchouts

1. Push and insight noise can erode trust quickly if thresholds are too eager.
2. Item-level intelligence quality is still bounded by identity quality for messy consumer data.
3. Household collaboration is real but still thinner than the rest of the product experience.
4. Gmail cron reliability still needs full production verification.
5. Trend thresholds will need continued tuning as real usage broadens.
6. Test-suite open-handle noise remains tooling debt.

## Operating Principle

The product should progress in this order:

1. improve data quality
2. improve interpretability
3. improve proactive usefulness
4. improve personalization

That keeps Adlo trustworthy while it grows into the broader adaptive finance companion vision.
