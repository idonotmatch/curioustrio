# NL Item Parsing V1

## Goal

Extend the existing natural-language expense input so users can intentionally enter item-level purchases in one step, then confirm or edit those items in the existing confirm flow.

This should improve:

- manual expense capture quality
- item-backed recurring and price insights
- early signal quality for personal spending patterns

without introducing a separate input mode or a new confirmation surface.

## User value

Users already type expenses in a compact sentence. Some of those users also want to preserve line-item structure when it matters, for example:

- groceries they want to track over time
- split purchases with distinct products
- stock-up trips where item-level price movement matters

They do not want to switch to receipt scan or manually build items one row at a time unless needed.

## Product position

V1 is an extension of the current NL parser, not a new parser product.

The output should still be:

- merchant
- description
- amount
- date
- notes
- payment metadata
- optional `items[]`

and should continue flowing through the existing [confirm.js](/Users/dangnguyen/curious-trio/mobile/app/confirm.js) experience.

## V1 input model

V1 should support **explicit item syntax first**.

Examples:

- `target 42.18 items: bananas 3.20, yogurt 6.99, paper towels 12.49`
- `costco 78 yesterday items: chicken 18, berries 9, diapers 42`
- `whole foods 31.40 items: salmon 18.50, asparagus 6.20, lemon 1.50`

Optional variant if easy:

- `target 42.18: bananas 3.20, yogurt 6.99, paper towels 12.49`

V1 should **not** try to solve free-form conversational item extraction broadly.

Examples explicitly out of scope for V1:

- `spent 52 at target on a few groceries and paper towels`
- `bought yogurt bananas and chicken for 34 at trader joes`

Those can remain description-level until a later phase.

## Parsing rules

### Required

1. Detect an item segment after an explicit marker such as `items:`
2. Split items on commas
3. For each item, extract:
   - `description`
   - `amount` when present
4. Preserve the normal top-level parse:
   - merchant
   - total amount
   - date
   - payment metadata

### Validation

1. If parsed items exist but every item is invalid, drop `items`
2. If some items are valid, keep only valid items
3. If item amounts sum close to the top-level amount, treat that as higher confidence
4. If item amounts materially differ from the total, keep the parse but add review guidance

### Confidence / review behavior

If item parsing succeeds:

- set `items` with `description` and `amount`
- mark item confidence at least `medium`

If the item total does not roughly match the expense total:

- keep `parse_status` as `partial`
- include `items` in `review_fields`
- add a specific item-total mismatch signal in diagnostics or review metadata

## V1 data shape

No new item schema is needed.

Continue using:

```json
{
  "items": [
    { "description": "bananas", "amount": 3.2 },
    { "description": "yogurt", "amount": 6.99 }
  ]
}
```

V1 should not attempt to infer:

- UPC
- SKU
- brand
- size
- pack count
- unit

Those remain follow-on phases.

## UX behavior

### Add flow

The add screen stays unchanged.

Users type into [NLInput.js](/Users/dangnguyen/curious-trio/mobile/components/NLInput.js) as they do today.

### Confirm flow

[confirm.js](/Users/dangnguyen/curious-trio/mobile/app/confirm.js) already supports editable items.

For V1:

- if NL parsing returns `items`, show them automatically
- if item sum mismatches the total, keep the existing review treatment lightweight but visible
- do not require item editing before save

### Copy

No new explanatory UI is needed on day one.

If we add helper copy later, it should stay short, for example:

- `Add items with "items:"`

but this is optional for V1.

## API / backend changes

### NL parser

Likely implementation path:

1. Add a lightweight pre-parser for explicit item syntax before the model result is finalized
2. Merge extracted `items` into the cleaned parsed expense
3. Keep the model prompt examples aligned with the new syntax

This should live in or near [nlParser.js](/Users/dangnguyen/curious-trio/api/src/services/nlParser.js).

### Confirm route

No meaningful route change should be required because [expenses.js](/Users/dangnguyen/curious-trio/api/src/routes/expenses.js) already accepts `items` on confirm.

## Suggested implementation slices

### Slice 1

Add explicit item-syntax parsing helper:

- detect `items:`
- parse comma-separated `description amount` pairs
- merge into existing parser output

### Slice 2

Add validation and review hints:

- item sum check against top-level amount
- item-specific review field when mismatch exists

### Slice 3

Add tests:

- successful explicit item parsing
- partial item parsing with one invalid item
- item total mismatch
- ordinary non-item NL input unchanged

## Test cases

### Happy path

`target 42.18 items: bananas 3.20, yogurt 6.99, paper towels 12.49`

Expected:

- merchant present
- amount `42.18`
- items length `3`

### Mixed validity

`costco 78 items: chicken 18, berries, diapers 42`

Expected:

- keep valid items
- unresolved item may remain with `amount: null` only if parser intentionally supports that
- otherwise drop invalid fragment and keep parse usable

### Total mismatch

`whole foods 31.40 items: salmon 18.50, asparagus 6.20`

Expected:

- items retained
- parse marked for review

### No item syntax

`trader joes 48 groceries`

Expected:

- current behavior unchanged
- `items: null`

## Non-goals

V1 does not include:

- fully free-form item extraction
- quantity parsing
- unit parsing
- bundle parsing
- tax / fee / discount row inference
- price reconciliation beyond basic mismatch detection
- new analytics UI

## Recommendation

Build V1 as a constrained parser enhancement with explicit syntax only.

That gives us a high-confidence, low-drift path to itemized manual entry while reusing the parser, confirm screen, and item-backed insight stack we already have.
