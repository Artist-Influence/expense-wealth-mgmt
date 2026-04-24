# Inline Editing in Expenses Table

## Goal

Let me edit transaction fields directly in the Expenses table without opening the side drawer. Today the Expenses table is read-only — every change requires clicking a row, opening the drawer, editing, and saving. The Income page already has inline `Select` editing for income type; bring the same affordance to Expenses for the most-edited fields.

## Scope

Inline editing in `src/pages/Expenses.tsx` for these columns:

1. **Category** — dropdown of approved categories for the current mode (respects the strict category guardrail)
2. **Method** — free-text input (e.g. "Chase Visa", "PayPal")
3. **Owner** (economic_owner) — dropdown: personal / artist_influence / employer / client / other

Other columns (Date, Description, Amount, Confidence, Status, Flags, Actions) stay read-only — they are derived, immutable, or already have dedicated controls.

Income and Reimbursements pages already support inline edits for their key fields, so no changes there.

## Behavior

- **Click-to-edit**: Clicking a Category / Method / Owner cell opens the editor in place (does NOT open the side drawer).
- **Row click still opens drawer**: Clicking anywhere else on the row opens the detail drawer as today. Cell click events stop propagation.
- **Save on commit**:
  - Category & Owner: save immediately when a new value is selected.
  - Method: save on blur or Enter; Esc cancels.
- **Strict category guardrail**: The Category dropdown only lists approved categories from `category_options` for the row's mode. No free text — same rule the drawer enforces.
- **Review status transition**: Any inline edit sets `review_status = 'edited'` (matching existing `handleSave` behavior). Setting category on a `needs_review` row clears the rejected/uncategorized state.
- **Merchant memory**: Inline edits update `merchant_memory` the same way the drawer save does, so future imports learn from the correction. Split parents and split children are skipped (existing guardrail).
- **Disabled for split parents**: Split parent rows show the values read-only with a tooltip "Split parent — edit child rows instead." Children remain editable.
- **Optimistic UI**: Update local state immediately, roll back and toast on Supabase error.
- **Visual cue**: Editable cells get a subtle hover background and a thin focus ring when active so it's discoverable.

## Files Changed

| File | Change |
|---|---|
| `src/pages/Expenses.tsx` | Add inline editor cells for Category, Method, Owner. Wire to existing `handleSave` logic so guardrails, status transitions, and merchant memory updates stay consistent. |

No schema changes. No new components needed — uses existing `Select` and `Input` primitives.

## Out of Scope

- Inline editing of tax treatment, reimbursable status, business purpose, etc. — these stay in the drawer where related fields are grouped.
- Bulk inline edit (already covered by the existing bulk action bar).
- Inline editing on Income / Reimbursements pages (already present where it makes sense).
