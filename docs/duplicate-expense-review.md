# Duplicate expense review

## Goal

Catch accidental duplicate expenses without silently hiding legitimate repeat purchases.

## Product behavior

- A likely duplicate is imported or saved normally and marked for review.
- The review queue groups unresolved matches under **Possible duplicates**.
- The comparison screen shows both expenses and the signals that caused the match.
- The user can keep both, keep the existing expense, or keep the new expense.
- When an imported expense matches a user-owned manual expense, the user can merge imported evidence into the manual expense.
- Only an explicit user decision dismisses an expense.
- Private household expenses are never exposed to another household member as a duplicate counterpart.

## Detection

Candidates are limited to the same household, or the same user when no household exists, and a two-day window. Matches are scored from merchant, amount, date, card, and location evidence. The API stores the score and human-readable match reasons with one unresolved flag per canonical expense pair.

## Reliability

- Manual and camera confirmation requests carry a stable idempotency key, so retries return the original expense.
- Gmail message processing is serialized with a database advisory lock in addition to the import-log uniqueness constraint.
- Duplicate decisions are persisted on the flag and are idempotent.

## Resolution semantics

- `merge_existing`: preserve the manual expense as the canonical record, fill only blank enrichment fields from the import, transfer imported items when the manual expense has none, and link the dismissed import to the survivor.
- `keep_both`: keep both expenses and resolve the flag.
- `keep_existing`: dismiss the expense currently being reviewed and keep its counterpart.
- `keep_new`: keep the expense currently being reviewed and dismiss its counterpart when the user owns both expenses.

If a counterpart belongs to another household member, only `keep_both` and `keep_existing` are available. A user cannot dismiss another member's expense.

## Merge precedence

The existing manual expense keeps its identity, merchant, amount, date, source, category when present, notes when present, privacy, and budget treatment. Imported values fill blank description, category, notes, payment/card, and location fields. Imported line items move to the survivor only when the manual expense has no line items. The Gmail import log is relinked to the survivor, the imported expense is dismissed and linked back to it, and `expense_merge_events` records field provenance.
