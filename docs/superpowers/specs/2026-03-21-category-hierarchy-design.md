# Category Hierarchy Design

**Date:** 2026-03-21
**Status:** Approved

---

## Goal

Add one-level parent/child hierarchy to categories. Expenses are always tagged at the leaf level. Display rolls up to the parent level on the feed card, the summary budget card, and the categories management page. Leaves with no parent act as their own group. Mappings are user-driven; the app automatically suggests leaf-to-parent mappings via Claude when parents are created.

---

## Data Model

### `categories` table — new column

```sql
ALTER TABLE categories ADD COLUMN parent_id UUID REFERENCES categories(id) ON DELETE SET NULL;
```

- **Parent category:** `parent_id IS NULL`, used as a grouping label.
- **Leaf category:** `parent_id` points to a parent.
- **Standalone leaf:** `parent_id IS NULL`, no parent assigned — treated as its own group for display.
- Existing categories are unaffected (all start with `parent_id = NULL`).

### `category_suggestions` table — new

```sql
CREATE TABLE category_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  leaf_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  suggested_parent_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX category_suggestions_household_idx ON category_suggestions(household_id);
```

Stores Claude's pending suggestions. One row per leaf/parent pair. Old suggestions for a leaf are replaced when new ones are generated.

---

## API

### Modified endpoints

**`GET /categories`**
Returns flat list with `parent_id` and `parent_name` (joined). Includes `pending_suggestions_count` (count of `status = 'pending'` for the household) in a top-level field alongside the array:

```json
{
  "categories": [...],
  "pending_suggestions_count": 3
}
```

Each category object:
```json
{
  "id": "...",
  "name": "Groceries",
  "icon": "🛒",
  "color": "#22c55e",
  "household_id": "...",
  "parent_id": "...",
  "parent_name": "Food"
}
```

**`POST /categories`**
Accepts optional `parent_id`. If `parent_id` is absent (creating a parent), and unassigned leaf categories exist in the household, fires a background (non-blocking) Claude suggestion call and stores results in `category_suggestions`.

**`PATCH /categories/:id`**
Accepts `parent_id` to assign or reassign a leaf to a parent (or `null` to unassign).

### New endpoints

**`GET /categories/suggestions`**
Returns pending suggestions:
```json
[
  {
    "id": "...",
    "leaf": { "id": "...", "name": "Groceries" },
    "suggested_parent": { "id": "...", "name": "Food" }
  }
]
```

**`POST /categories/suggestions/:id/accept`**
Sets `status = 'accepted'`, updates `categories.parent_id = suggested_parent_id` for the leaf.

**`POST /categories/suggestions/:id/reject`**
Sets `status = 'rejected'`. No category update.

### Claude suggestion logic

Called after a new parent category is created. Input: list of leaf category names + parent category names for the household. Prompt returns `[{ leaf_id, parent_id }]`. Results upsert into `category_suggestions` (replacing any existing pending suggestion for the same leaf). Non-fatal — failure to generate suggestions does not block the category creation response.

---

## Mobile

### Categories page (`mobile/app/categories.js`)

**Suggestions card** (shown when `pending_suggestions_count > 0`): Dismissible section at the top. "Dismiss" hides the card for the current session only (it reappears on next load if pending suggestions remain); it does not accept or reject any suggestion. Individual Accept/Reject buttons handle those actions. Lists each pending suggestion as `"Groceries → Food"` with Accept and Reject buttons. Accepting calls `POST /categories/suggestions/:id/accept` and refreshes.

**Custom categories list**: Grouped by parent. Each parent is a section header. Leaves are indented below their parent. Leaves with no parent appear under an "Ungrouped" section. When creating a new category, an optional "Parent" chip row lets the user assign it to an existing parent.

**Settings badge**: The Categories nav row in `settings.js` shows a red dot badge when `pending_suggestions_count > 0`.

### Feed card (`mobile/components/ExpenseItem.js`)

Meta row shows parent category name instead of leaf name. If the leaf has no parent, shows the leaf name (current behavior unchanged). Requires `parent_name` to be included in expense list queries.

### Summary tab (`mobile/app/(tabs)/summary.js`)

Budget card shows a per-parent breakdown below the total bar. Each parent line: `Parent name · $spent / $limit` with a mini progress bar (only if a budget is set for that parent). "A budget is set for a parent" means there is an existing budget row in the `budgets` table where `category_id = parent_id`. Budgets remain set at the category level — parents are just categories with `parent_id IS NULL`. Leaves with no parent appear as their own line (spending shown, limit shown only if that leaf has its own budget row). Uses the existing `/budgets` response, extended to include per-parent spending grouped by `parent_id`.

---

## Expense queries — `parent_name`

`findByUser` and `findByHousehold` in `api/src/models/expense.js` need a join to surface `parent_name`:

```sql
LEFT JOIN categories parent_cat ON c.parent_id = parent_cat.id
```

Add to SELECT:
```sql
parent_cat.name AS category_parent_name
```

---

## Budget rollup

The existing `/budgets` endpoint aggregates spending by `category_id`. With hierarchy, it needs to also aggregate by parent:

```sql
SELECT
  COALESCE(c.parent_id, e.category_id) AS group_id,
  SUM(e.amount) AS spent
FROM expenses e
LEFT JOIN categories c ON e.category_id = c.id
WHERE e.household_id = $1 AND e.status = 'confirmed' AND to_char(e.date, 'YYYY-MM') = $2
GROUP BY group_id
```

This groups leaf-level expenses under their parent. Leaves with no parent group under their own ID. The budget response adds a `by_parent` array alongside the existing `categories` array.

---

## Out of Scope

- Multi-level hierarchy (grandparent/parent/leaf) — not needed
- Per-leaf budgets — budgets remain at the parent/total level
- Default parent categories shipped by the app — hierarchy is entirely user-defined
- Automatic re-suggestion when a leaf's parent changes

---

## Testing

- Unit: `category.js` model returns `parent_id` and `parent_name`
- Unit: `categorySuggester` service calls Claude and stores results
- Route: `GET /categories` returns `pending_suggestions_count`
- Route: `POST /categories` (parent) triggers suggestions for unassigned leaves
- Route: `POST /categories/suggestions/:id/accept` updates `parent_id` on leaf
- Route: `POST /categories/suggestions/:id/reject` marks rejected, no category change
- Mobile: brace-balance checks on all modified files
