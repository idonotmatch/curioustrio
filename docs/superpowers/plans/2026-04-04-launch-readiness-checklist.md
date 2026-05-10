# Launch Readiness Checklist

This checklist is for preparing Adlo for broader live user testing.

The goal is not perfection. The goal is to make sure the product is trustworthy enough that early users can evaluate the real experience without getting derailed by avoidable reliability or confidence issues.

## Must Fix Before Broader User Testing

### 1. Gmail reliability and observability

Required:
- verify scheduled, manual, and app-open Gmail sync behavior end to end
- confirm Gmail import does not silently fail
- surface token/auth failures clearly enough for ops
- add enough run/failure visibility to know whether Gmail sync is healthy in production

Why it matters:
- Gmail is one of the highest-leverage ingestion channels
- if it feels flaky, users will not trust automation

### 2. Data consistency across key surfaces

Required:
- Summary, All Transactions, Queue, and Expense Detail must stay in sync after:
  - approve
  - dismiss
  - edit
  - delete
- remove any remaining hard-close-required refresh issues
- confirm cache invalidation is correct across the main flows
- add true realtime household freshness so one member's changes quietly update other active household members without waiting for app foreground, navigation, or manual refresh

Why it matters:
- users must trust that the app reflects the truth after they make a change
- household users must trust that shared context reflects the household, not just their own device's last fetch

Current status:
- on April 4, 2026, the main mobile confirm and approve flows were updated to invalidate household-expense caches in addition to personal expense and budget caches
- this materially improves consistency between Summary, All Transactions, Pending, and Expense Detail after a user changes data
- on May 10, 2026, an internal freshness coordinator was added on mobile so local mutations and app-foreground events can quietly mark dependent domains stale and refresh mounted surfaces
- this reduces local stale states and foreground lag, but does not yet solve true active cross-household propagation
- next step: feed server-side household mutation events into the mobile freshness coordinator

### 3. Insight correctness gating

Required:
- keep strict minimum-history thresholds for trend insights
- keep duplicate insight suppression working
- keep low-value insight suppression/cooldowns working
- ensure every surfaced insight is explainable through drill-down

Why it matters:
- insights are now a core differentiator
- bad or premature insights will erode trust quickly

### 4. Startup and app-open experience

Required:
- startup should feel stable and reasonably fast
- splash handoff should feel coherent
- Summary should not flash stale or obviously wrong state on load
- app-open Gmail behavior should remain conservative and predictable

Why it matters:
- first impression and daily-open feel disproportionately affect tester confidence

Current status:
- Summary receipt scan now launches directly into camera capture instead of routing users through an extra tap on Add
- splash handoff and summary hierarchy have both been tightened recently, but real-device validation is still needed

### 5. Privacy and household correctness

Required:
- confirm private expenses stay private
- confirm household visibility rules are correct
- confirm delete/edit permissions are intentional
- confirm there is no accidental cross-user/cross-household exposure

Why it matters:
- a financial product cannot be loose about access boundaries

### 6. Legal entity and public trust surface

Required before broader distribution:
- form the LLC or equivalent legal entity that will operate Adlo
- make sure public-facing trust materials are live and accurate:
  - application home page
  - privacy policy
  - terms of service
- make sure the operator identity in those materials matches how the product is actually being distributed

Why it matters:
- TestFlight-only use is one thing; broader distribution raises the importance of liability separation, credibility, and consistent public disclosures
- OAuth review, support, payments, and future subscriptions are all cleaner once the product is attached to a real operating entity

## Should Fix Soon After Beta Starts

### 7. Queue review UX polish

Recommended:
- keep Queue with one clear home
- ensure Summary remains a reminder surface, not a second review workflow
- make review interactions feel crisp and low-confusion

Current status:
- Summary no longer acts like a second queue surface
- queue state now appears as lighter context near `RECENT`
- broader polish and clarity work still remains in the dedicated review experience

### 8. Location reliability

Recommended:
- confirm manual place search returns usable results consistently
- confirm saved location always renders when present
- confirm receipt/email-derived location enrichment behaves predictably

### 9. Capture confidence and provenance clarity

Recommended:
- make it easier to understand what was inferred vs confirmed
- especially for email and receipt-derived expenses

Current status:
- the Summary quick-add receipt path is meaningfully less friction-heavy now
- provenance and confidence communication still need more explicit product treatment

### 10. Notification tuning

Recommended:
- keep push volume conservative
- monitor false positives
- monitor timing quality for recurring-item pushes

### 11. Insight feedback review loop

Recommended:
- actively inspect `/insights/feedback-summary`
- review top negative reasons
- review recent user freeform notes
- review inferred outcome counts and top outcome-producing insight types
- use early tester feedback to tune ranking and suppression quickly

## Acceptable for Beta

These are important, but do not need to block broader testing if the must-fix items are solid.

### 12. External price observation sources

Status:
- foundation exists
- real live source coverage can expand after beta begins

### 13. Advanced ML and personalization

Status:
- current feedback-driven heuristics are sufficient for beta
- model-driven personalization can come after real usage data accumulates

### 14. Household collaboration depth

Status:
- current shared-finance functionality is enough for beta
- deeper collaborative workflows can come later

### 15. Category/taxonomy model rebuild

Status:
- backlogged behind realtime household freshness
- current model mixes user-facing categories, budget groups, merchant memory, cleanup workflows, AI assignment candidates, and provenance signals
- proposed direction: redefine the feature around Spending Groups, Categories, Merchant Rules, and Review Signals before rebuilding the category management UX
- does not need to block the immediate realtime data-consistency work

## Go / No-Go Criteria

### Required
- Gmail sync is reliable enough and operationally visible
- data updates propagate correctly across key surfaces
- no obviously wrong trend or insight cards for sparse-history users
- startup feels stable and reasonably fast
- privacy and household rules are correct
- the operating entity and public trust surface are in place for broader distribution

### Strongly preferred
- queue treatment is clear
- location behavior is dependable
- push notifications are conservative and useful

## Operating Cadence During Beta

Track these continuously:
- Gmail sync health
- import failures
- stale-cache/state bugs
- top negative insight feedback reasons
- top user-reported confusion points

That feedback loop should guide the first post-beta polish wave.
