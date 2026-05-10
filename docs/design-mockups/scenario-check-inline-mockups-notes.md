# Scenario Check UX Rework

## Why the first version felt off

The first launcher treatment was too large and too promotional for Summary.

Problems:

- it broke the visual rhythm of the tab
- it competed with insights instead of supporting them
- it felt like a separate feature area rather than a quick planning tool
- it did not borrow enough from the existing natural-language expense entry behavior

## Revised direction

Make scenario check feel like a sibling of Quick Add, not a standalone card.

## Preferred option: inline NL scenario row

Place a compact planning row directly under Quick Add:

- label: `Quick check`
- input placeholder: `180 running shoes · can I afford 240 air fryer?`
- CTA: `Check`

This keeps the feature:

- compact
- language-first
- consistent with Summary
- easy to discover without taking over the page

## Parsing direction

Use lightweight natural-language parsing, not a formal form-first experience.

Examples:

- `180 running shoes`
- `can i afford 350 tires`
- `check 90 groceries`
- `household 240 costco run`
- `mine 75 dinner out`

Output shape:

- `amount`
- `label`
- optional `scope`

## Secondary option: mode switch on Quick Add

Longer-term, Summary could unify both entry paths:

- `Add`
- `Check`

Same text field, different submit behavior.

This is elegant, but the inline secondary row is the safer MVP because it introduces less behavioral ambiguity.

## Recommended MVP

### Summary

- keep existing Quick Add exactly as the main action
- add a smaller `Quick check` row underneath
- use reduced height styling and subtle contrast

### Result screen

- keep the result screen
- keep the explanation-heavy detail view
- treat Summary as launcher, not destination

## Copy direction

### Input label
- `Quick check`

### Placeholder
- `180 running shoes · can I afford 240 air fryer?`

### Helper copy
- `Pressure-test a purchase against this period's projected room.`

## Why this is better

- matches the current Summary feel
- feels more like a tool than a card
- gives Adlo a more distinctive language-first interaction pattern
- creates a clean bridge to future assistant-style planning
