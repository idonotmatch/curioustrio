# Next Ingestion Surface Roadmap

This phase is intentionally a scope-and-pilot decision, not a full build.

## Candidate 1: richer natural-language item entry

### Why it is attractive
- Lowest security and compliance risk
- Builds on existing NL parsing behavior
- Directly improves item-level insights, planning, and categorization
- Works for users who never connect Gmail or external accounts

### Risks
- More ambiguity than structured imports
- Needs stronger disambiguation around quantities, brands, and bundled totals
- Can become a frustrating UX if review/edit is too heavy

### Narrow pilot
- Parse freeform entries like:
  - `nike running shoes from dicks sporting goods 122.24`
  - `whole foods chicken, berries, yogurt 48.12`
- Extract:
  - merchant
  - amount
  - likely line items
  - item confidence
- Route low-confidence item extraction into lightweight item confirmation

### What success looks like
- Users can create item-aware expenses without special syntax
- Item history coverage grows faster than Gmail-only capture allows

## Candidate 2: direct card transaction ingest

### Why it is attractive
- Highest capture coverage
- Removes dependence on email formatting
- Improves freshness for budget, planning, and insight generation

### Risks
- Highest security, privacy, and support burden
- External account-linking UX and failure modes
- Harder to keep review philosophy personal-first and explainable

### Narrow pilot
- Do not build direct banking/card auth yet
- First evaluate low-risk intermediaries or statement-like feeds
- Keep all imported card transactions personal by default

### What success looks like
- Better freshness and fewer missing expenses without a major trust hit

## Candidate 3: low-risk intermediary transaction feeds

### Why it is attractive
- Could provide some transaction freshness without full bank-linking complexity
- May offer a better security/trust profile than direct credential collection

### Risks
- Coverage may be inconsistent
- Data normalization can still be messy
- Might create a half-solution that still needs Gmail/manual cleanup

### Narrow pilot
- Evaluate providers that expose transaction data with minimal credential handling
- Compare:
  - security posture
  - integration lift
  - review burden
  - merchant/category quality

### What success looks like
- A materially better capture path than Gmail for a subset of users without large trust costs

## Recommendation for this phase

1. **Primary pilot:** richer natural-language item entry
2. **Research track:** low-risk intermediary transaction feeds
3. **Backlog only:** direct card transaction ingest

## Why this order

- NL item entry compounds existing strengths immediately
- It improves the same item-level intelligence we are already investing in
- It avoids opening a large security and support surface too early
- It keeps the app valuable for personal-only users who never join a household or connect external accounts

## Exit criteria for this roadmap item

- We choose one pilot to build next
- We explicitly defer the others
- We define:
  - data model impact
  - review flow impact
  - privacy/security impact
  - insight/planning impact
