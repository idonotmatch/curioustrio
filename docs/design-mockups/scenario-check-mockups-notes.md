# Scenario Check UX Mockups

## Goal

Turn the existing `/trends/scenario-check` backend into a clear in-app flow for:

- "Can I afford this?"
- "How tight would this make the rest of the month?"
- "What is driving the answer?"

This is intentionally framed as a lightweight planning tool, not a budgeting wizard.

## Product assumptions

These mockups are based on the current backend response shape in:

- [/Users/dangnguyen/curious-trio/api/src/routes/trends.js](/Users/dangnguyen/curious-trio/api/src/routes/trends.js)
- [/Users/dangnguyen/curious-trio/api/src/services/spendProjectionAnalyzer.js](/Users/dangnguyen/curious-trio/api/src/services/spendProjectionAnalyzer.js)

Available states:

- `comfortable`
- `absorbable`
- `tight`
- `risky`
- `not_absorbable`
- `unknown`

Available explanation data:

- `projected_headroom_amount`
- `post_purchase_projected_delta`
- `risk_adjusted_headroom_amount`
- `recurring_pressure_amount`
- `recurring_candidates`

## Proposed flow

### 1. Entry point from Summary

Use a lightweight launcher card near the top of Summary:

- title: `Can I afford something?`
- body: `Pressure-test a purchase against this month's projected headroom.`
- CTA: `Run a scenario`

Why Summary:

- it is already the projection/insight surface
- it is the most natural place to ask a planning question
- it keeps the feature near ongoing month context

### 2. Scenario composer

First version should stay intentionally small:

- amount
- optional label
- scope toggle:
  - `Mine`
  - `Household` when available
- month prefilled to current period
- primary CTA: `Check this purchase`

Do not add watchlists, installments, or category selection yet.

## Result screen structure

### Top block

- status pill
- result headline
- short plain-English explanation

### Impact row

- current headroom
- after-purchase headroom
- recurring pressure still ahead

### Why this answer

- explanation cards derived from API fields
- recurring candidates shown only when present

### Future-facing CTA

Not for MVP implementation yet, but reserve space for:

- `Watch this scenario`

## Status copy direction

### `comfortable`
- `Yes, this looks comfortably absorbable.`
- Tone: calm, confident, not celebratory

### `absorbable`
- `Yes, but this would use a meaningful share of your remaining room.`
- Tone: supportive but measured

### `tight`
- `Maybe, but the rest of the month would get tight.`
- Tone: caution with agency

### `risky`
- `This would likely push the month into a riskier range.`
- Tone: clear warning

### `not_absorbable`
- `This does not look absorbable in the current month.`
- Tone: direct, still non-judgmental

### `unknown`
- `There is not enough history yet to answer this confidently.`
- Tone: transparent and factual

## UX principles

- lead with answer first
- keep the math visible but secondary
- use projection language already familiar from trend detail
- do not turn this into a spreadsheet interface
- let the user pressure-test quickly and leave

## Suggested MVP implementation order

1. add Summary launcher card
2. add `/scenario-check` screen with form
3. add result state screen using live API
4. reserve but do not wire a `Watch this scenario` affordance
