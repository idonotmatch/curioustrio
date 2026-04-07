# Insights & Price Observation Roadmap

## Updated Context

As of 2026-04-06, the app has moved beyond first-pass recurring and insight delivery into early closed-loop learning:

- recurring item detection
- recurring item price-variance signals
- insights on Summary with detail drill-down
- per-user insight state (`seen`, `dismissed`, richer event logging)
- recurring item history endpoint
- recurring watch-candidate endpoint
- adaptive insight ranking and suppression
- scenario planning with watched/deferred plan lifecycle
- explanatory insight review loops for:
  - unusual one-off spend
  - category shifts
  - recurring cost pressure

This means the app can already tell users:

- an item cost more than usual
- an item was cheaper than usual
- another merchant they already use has historically been cheaper
- whether an unusual purchase should really count as a one-off
- whether a category shift looks temporary, expected, or like a new pattern
- whether recurring cost pressure feels like a temporary spike or real new pressure

It can also identify near-due recurring products that are entering a pre-purchase watch window.

## What Is Still Missing

The system still cannot proactively tell the user:

- this item is cheaper right now
- buy soon because the product you usually need in 5 days is discounted today

That missing capability is still not about recurrence logic anymore. It is about external price observation.

The broader insights gap has shifted. It is now less about “can we generate useful signals?” and more about:

- connecting each insight to the most natural next review/action surface
- continuing to learn from user judgments on explanatory cards
- deciding which insight branches deserve more product depth before price-observation work expands

## Recommended Next Build

Keep price observation on deck, but make insight productization the immediate focus.

### Immediate

- deepen explanatory insight review surfaces
- keep feeding those review judgments back into ranking/suppression
- improve the destination surfaces behind non-planner insight cards

### After That

- build the external price observation foundation
- add `product_price_observations`
- add model for writing and reading observations
- add ingestion route for observed prices

### Then

- map those signals into insights
- later decide whether to render them in Summary or deliver them via a separate alerting surface

## Why This Ordering Is Right

Recent work already made recurrence timing, product identity, insight delivery, and insight learning meaningfully smarter.

The highest-leverage near-term gap is making the insight system feel more interpretable and adaptive in-product.

External price observation is still strategically important, but the app now has enough insight depth that tightening action/review loops will likely create more immediate product value than jumping straight into another backend intelligence layer.

## Lower-Priority Follow-Ups

- dynamic watch timing per item instead of a static lead window
- better comparable-key-only watch support for produce and fuzzy grocery items
- richer recurring-item drill-down UI in mobile
- stronger explanation and provenance on insight cards
