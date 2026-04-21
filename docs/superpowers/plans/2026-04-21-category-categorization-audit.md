# Category + Categorization Audit

**Date:** 2026-04-21  
**Status:** Proposed follow-up workstream

---

## Why revisit this area

Categories look more mature in the product docs than they feel in the core expense loop.

What exists today is strong on:
- taxonomy administration
- hierarchy management
- rename / hide / merge / move workflows
- default category overrides

What still feels under-developed is:
- categorization quality
- learning from user corrections
- clear mental models around category budgets
- a personal-first category strategy

In practice, the admin layer has grown faster than the intelligence layer.

---

## Source-of-truth review

### Roadmap / product positioning

The recent docs consistently frame categories as mostly complete:

- `docs/superpowers/specs/2026-03-21-category-hierarchy-design.md`
- `docs/superpowers/plans/2026-03-21-category-hierarchy-plan.md`
- `docs/superpowers/plans/2026-04-04-product-one-pager.md`
- `docs/superpowers/plans/2026-04-04-launch-readiness-checklist.md`

That framing emphasizes:
- one-level parent/child hierarchy
- AI grouping suggestions
- parent rollups in feed and budgets
- hidden / renamed default categories
- move / merge / restore workflows

The broader product review is more honest about the current gap:

- `docs/product-review.md`

That review rates AI categorization at 60% and says the ideal is:
- self-improving per household
- learns corrections instantly
- handles edge cases such as reimbursable or split-bill-like behavior

### Current implementation reality

The current codebase supports a rich category admin system:
- `api/src/routes/categories.js`
- `api/src/models/category.js`
- `api/src/models/categorySuggestion.js`
- `api/src/services/categorySuggester.js`
- `mobile/app/categories.js`

But the actual categorization loop is still relatively shallow:
- `api/src/services/categoryAssigner.js`
- `api/src/services/expenseConfirmService.js`
- `api/src/models/merchantMapping.js`

---

## What is working well today

### 1. Taxonomy / admin workflows are real

The category system already supports:
- parent / child hierarchy
- hidden default categories
- household-level rename overrides for defaults
- merge flows
- move flows
- AI parent suggestions for new grouping structures
- inline quick-create with parent suggestion

This is not fake maturity. It is real capability.

### 2. Merchant memory exists

Merchant-based category memory is implemented and used before heuristics or model fallback:
- `api/src/models/merchantMapping.js`
- `api/src/services/categoryAssigner.js`

That creates basic “learn once, reuse many times” behavior for stable merchants.

### 3. Categories already shape downstream product surfaces

Categories are not just metadata. They directly affect:
- budget rollups
- trend analysis
- insight generation
- feed labels
- confirmation flow

So investing here has leverage across the app.

---

## Main debt / under-developed areas

### 1. Learning loop is too narrow

Today the primary persistent feedback loop is:

1. expense is confirmed
2. confirmed category is saved
3. merchant mapping is upserted

That happens in:
- `api/src/services/expenseConfirmService.js`

This means the app learns only from:
- merchant name
- final category id

It does **not** reliably learn from:
- category correction after initial parse
- merchant + description combinations
- recurring text patterns
- person-to-person payment language
- item-level information
- category corrections on already-stored expenses
- negative evidence such as “this merchant should not usually map here”

Result:
- corrections do not compound as strongly as they should
- the system feels less personalized than the roadmap implies

### 2. Heuristic categorization is brittle and name-dependent

`api/src/services/categoryAssigner.js` relies on:
- literal category-name matching
- a small hardcoded keyword table
- a Claude fallback

This has a few issues:
- it depends on visible category names being semantically stable
- it weakens when users rename categories
- it weakens when taxonomy becomes more custom
- it does not operate on a canonical semantic layer

If a household renames a default category, the classifier becomes harder to reason about.

### 3. Category intelligence is still household-coupled

Several important category flows require household membership:
- quick parent suggestion
- quick category creation
- category admin actions

That made sense earlier, but the product direction is now explicitly personal-first.

Current mismatch:
- product philosophy says the individual is the primary operating unit
- category creation / suggestion still assumes household ownership

This creates awkwardness for:
- solo users
- future personal-only onboarding
- eventual user-specific category learning

### 4. Budget semantics are useful but conceptually muddy

The hierarchy design originally positioned parent categories primarily as display grouping.

The live budget route now returns:
- leaf/category budget summaries
- parent rollups via `by_parent`

That is useful, but there is still no crisp product contract on:
- whether budgets “really” belong to leaves or parents
- how parent and child budget semantics should coexist
- what happens when categories are regrouped

This is less a bug than a conceptual debt item.

### 5. Category suggestions optimize structure, not categorization quality

The AI suggestion pipeline in:
- `api/src/services/categorySuggester.js`
- `api/src/models/categorySuggestion.js`

helps organize the taxonomy after categories exist.

That is valuable, but it solves:
- “how should these categories be grouped?”

more than:
- “will future expenses get categorized correctly with less cleanup?”

It improves admin order, not core capture accuracy.

### 6. Category data is cached and consumed a bit too shallowly on mobile

The main mobile category hook:
- `mobile/hooks/useCategories.js`

only exposes the category array and ignores:
- `pending_suggestions_count`
- any household/user scope nuance in the cache key

That is not catastrophic, but it is a sign the category model and the mobile consumption contract are slightly out of sync.

### 7. The category surface is stronger than the category story

Right now the system can do more than the user can easily understand:
- custom vs default
- renamed defaults
- hidden defaults
- parents vs leaves
- move vs merge
- quick create parent inference
- suggestion accept / reject

That is a lot of taxonomy power.

The missing layer is a simpler user-facing story:
- how categorization works
- how it learns
- when it is confident
- what will happen if the user corrects it

This is why the area can feel both advanced and under-developed at the same time.

---

## Product risks if we leave it as-is

### 1. Budget trust degrades

If categorization is merely okay, users stop trusting:
- category budgets
- category trend cards
- category projections

Once that trust goes, the intelligence layer becomes noisier everywhere else.

### 2. Insight quality ceiling stays lower than it should

Many insight families depend on category quality:
- top category driver
- projected category surge
- projected category under baseline
- early category shifts

Weak categorization becomes an upstream cap on insight quality.

### 3. We keep investing in admin complexity instead of reducing cleanup

Without a stronger learning loop, users still have to babysit categorization, even though the app has increasingly advanced category tools.

That is the wrong long-term balance.

---

## Recommended cleanup / build sequence

## Phase 1: Strengthen the learning loop

**Priority:** Highest  
**Goal:** make categorization improve materially from user behavior

### Proposed changes

- Add explicit category-feedback capture:
  - suggested category id
  - final chosen category id
  - source of original suggestion
  - whether user changed it before save
  - whether user changed it after save

- Introduce richer memory keys beyond merchant-only:
  - merchant
  - merchant + normalized description
  - normalized description only
  - item/comparable key when available
  - person/payee for transfer-like expenses

- Add negative learning signals:
  - “merchant X should not map to category Y in this context”

- Define precedence order for assignment:
  1. explicit user override memory
  2. high-confidence merchant+description memory
  3. item/comparable key memory
  4. merchant memory
  5. heuristic
  6. model fallback

### Why first

This is the biggest trust multiplier for:
- capture
- budgets
- insights
- review burden

---

## Phase 2: Separate taxonomy from categorization intelligence

**Priority:** High  
**Goal:** reduce conceptual coupling and make future work clearer

### Proposed refactor

Split current category concerns into:

1. **Taxonomy domain**
   - category hierarchy
   - defaults / overrides
   - merge / move / hide / restore
   - parent suggestions

2. **Categorization domain**
   - assign category
   - confidence
   - learning / memory
   - correction capture
   - inference logs

### Why this matters

Right now route-level and service-level logic mixes:
- category administration
- quick-create parent inference
- merchant memory behavior

That increases accidental complexity and makes debugging categorization quality harder.

---

## Phase 3: Decide and formalize personal-first category scope

**Priority:** High  
**Goal:** align category architecture with the product direction

### Decision needed

Choose one of these models:

1. **Household taxonomy, personal usage**
   - household owns category tree
   - users categorize into shared taxonomy
   - personal behavior rolls into household views

2. **Personal taxonomy with household rollup**
   - users own primary category mappings
   - household layer aggregates and reconciles

3. **Hybrid**
   - shared default taxonomy
   - user-level memory and overrides
   - household-level admin only for shared display structure

### Recommendation

The hybrid model is probably the best fit for current product direction.

Reason:
- personal-first behavior stays true
- household can still share common labels
- categorization can become more personalized without fragmenting every surface

---

## Phase 4: Clarify budget semantics for hierarchical categories

**Priority:** Medium  
**Goal:** make category budgets legible and stable

### Questions to resolve

- Are parent categories budget containers, display groups, or both?
- Can leaves have budgets if they sit under a budgeted parent?
- If both exist, which one wins in UI and logic?
- What happens when a leaf moves under a new parent?

### Recommendation

Short-term:
- treat parent budgets as the main planning unit
- treat leaves as attribution units
- avoid simultaneous parent-and-leaf budget semantics unless clearly defined

This keeps the hierarchy useful without making budgeting ambiguous.

---

## Phase 5: Simplify the user-facing category story

**Priority:** Medium  
**Goal:** reduce taxonomy intimidation

### User experience principles

- category correction should feel like teaching, not editing database rows
- defaults vs custom vs renamed default should be clearer
- category admin should be secondary to correct categorization
- confidence and “why this was picked” should be visible where it matters

### Concrete opportunities

- show “learned from merchant history” / “picked from description” / “needs review”
- show a lightweight explanation on confirm, not just a picker
- make suggestions about cleanup more outcome-oriented
- reduce how often users need to visit the dedicated category admin screen

---

## Immediate engineering opportunities

These are the highest-signal concrete debt items visible now:

1. **Capture category correction feedback on confirm and post-confirm edits**
2. **Replace merchant-only memory with layered categorization memory**
3. **Introduce canonical category family semantics so inference is not tied to display names**
4. **Refactor category assignment into a more explicit precedence pipeline**
5. **Make category creation / suggestion work cleanly for personal-only users**
6. **Tighten mobile category data contract and cache scoping**
7. **Define one clear hierarchical budget contract**

---

## Suggested next implementation slice

If we start immediately, the best first slice is:

### “Category Learning v1”

Build:
- category decision log table
- correction capture on confirm
- correction capture on expense category edit
- richer categorization memory table or extension of merchant memory
- assignment precedence update

That slice would improve:
- categorization accuracy
- trust in budgets
- trust in category-based insights
- future ML/personalization data quality

without requiring a large UI rewrite first.

---

## Bottom line

Category **administration** is ahead of category **intelligence**.

That means this area is not blocked by missing screens. It is blocked by:
- weak feedback capture
- narrow memory
- fuzzy scope ownership
- muddy budget semantics

This is a high-leverage cleanup area because better categorization improves the entire app, not just the category settings screen.
