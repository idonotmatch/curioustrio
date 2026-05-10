# Recurring Item Price Watch

## Current Implementation Status

Implemented as of 2026-04-03:

- recurring item detection based on normalized item history
- recurring item price-variance signals:
  - `price_spike`
  - `better_than_usual`
  - `cheaper_elsewhere`
- insights v1 surface on Summary
- insight state:
  - `seen`
  - `dismissed`
- recurring item history endpoint:
  - `GET /recurring/item-history?group_key=...`
- recurring watch candidates endpoint:
  - `GET /recurring/watch-candidates`

Important current limitation:

- pre-purchase watch candidates exist, but there is not yet an external price observation layer
- monitoring lead time is still a static window input today, even though repurchase timing itself is learned dynamically from user history
- first-pass watch candidates only include product-backed recurring items, not weaker comparable-key-only grocery matches

## Goal

Help users save on products they predictably repurchase by monitoring for better prices shortly before expected reorder time.

## Core User Story

A user repeatedly buys `Pampers Pure, Size 6, 82 pack` about every 18 days at a usual price of `$39.23`.

Five days before the next expected purchase, the system begins monitoring that exact product.

If it finds the item at more than 5% below the user's usual price, it surfaces an opportunity.

## Inputs

- recurring item candidate
- high-confidence product identity
- purchase cadence
- historical price baseline
- normalized size/pack info
- observed current prices from monitored sources

## Eligibility Rules

An item qualifies when:

- a recurring pattern is established
- product match confidence is high
- pack/size identity is exact or safely comparable
- there is enough purchase history to compute a stable baseline

Recommended minimums:

- 3+ purchases
- consistent cadence
- stable product identity
- stable comparable size/pack

## Monitoring Trigger

Start monitoring at:

- `expected_repurchase_date - 5 days`

Monitoring window:

- from `T - 5` through purchase detection or expected date expiry
- optionally continue through a short grace window after expected date

## Baseline Logic

Preferred baseline:

- median historical unit price for that exact recurring product

Fallback:

- median historical raw price when exact product identity makes unit comparison unnecessary

Example:

- baseline raw price: `$39.23`
- threshold price at 5% discount: `$37.27`

## Opportunity Rule

Surface an opportunity when:

- current observed price is more than 5% below baseline
- and savings clear a minimum absolute-dollar threshold to prevent noise

Recommended thresholds:

- `discount_percent > 5%`
- `savings >= $1.50`

## Output Shape

Each opportunity should include:

- product identity
- baseline price
- observed price
- discount percent
- savings dollars
- merchant/source
- timestamp observed
- expected repurchase date

Example:

```json
{
  "product_name": "Pampers Pure Size 6",
  "pack_size": "82 pack",
  "baseline_price": 39.23,
  "observed_price": 36.99,
  "discount_percent": 5.7,
  "savings_amount": 2.24,
  "merchant": "Target",
  "expected_repurchase_date": "2026-04-18"
}
```

## User-Facing Copy

Examples:

- `Pampers Pure Size 6 (82 pack) is 6% below your usual price.`
- `You usually buy this every 18 days. It's cheaper right now at Target.`
- `Likely next need in 5 days. Current price is $36.99 vs your usual $39.23.`

## Lifecycle

1. detect recurring item
2. compute baseline and cadence
3. open monitoring window at `T - 5`
4. watch eligible price sources
5. emit opportunity when threshold is met
6. suppress repeat alerts for the same offer/product window
7. close monitoring after purchase or window expiration

## Purchase Detection

Stop or suppress monitoring when:

- same product is purchased
- same recurring cycle is satisfied
- alert was already accepted or dismissed recently

## Edge Cases

- pack size changed:
  only compare when normalized unit comparison is valid
- weak product match:
  do not monitor
- volatile pricing:
  require stronger discount thresholds
- multiple merchants:
  prefer surfacing the cheapest trusted option
- promotions that are not actually purchasable:
  ignore unless a current sellable price is confirmed

## Dependencies

- recurring item detection
- high-confidence product matching
- normalized size/pack/unit data
- price observation source(s)
- alert suppression state

## Current Backend Prerequisites Already Landed

- rich item metadata preservation on `expense_items`
- normalized comparable item keys
- normalized quantity and total-size fields
- first-pass estimated unit pricing
- product match confidence tiers
- recurring item history and merchant pricing context
- watch-candidate generation for near-due recurring products

## Recommended MVP Scope

- only high-confidence products
- only exact or safely normalized size matches
- one baseline rule
- one trigger window: `T - 5 days`
- one alert type: `better than usual by >5%`

## Later Extensions

- inverse alerts:
  `price_spike`
- merchant switching recommendations
- household-specific priorities:
  baby items, groceries, subscriptions
- bundle recommendations:
  buy now because several recurring items are discounted together

## Next Recommended Technical Step

Build the external price observation foundation:

1. add `product_price_observations`
2. add ingestion route/model
3. compare fresh observations against watch candidates
4. emit proactive `better price before repurchase` insights
