# Exclude personal repayments (Zelle from a friend, etc.) from income totals

## What you'll get

A new income type — **"Personal Transfer / Repayment"** — that you can assign to any income row (e.g., a friend Zelles you back $40 they owed). Anything tagged with this type is automatically excluded from every income/earned/tax/allocation calculation across the app, but stays visible in the Income ledger as an audit trail.

You'll also get:
- A one-click action on each row (and bulk action) to **"Mark as Repayment / Transfer (don't count)"**.
- A clear visual badge so these rows are obvious in the table.
- A dedicated summary card on the Income page showing total "Repayments / Personal Transfers" so you can see what's been excluded.

## How it will work

The codebase already has a centralized `NON_EARNING_TYPES` list in `src/lib/income-classifier.ts`. Every page that calculates earned income (Insights, Tax, Allocations, Accountant exports, CloseMonth) already filters out anything in that list. We'll add a new type to that list, so exclusion propagates everywhere automatically with zero per-page changes.

### Technical changes

1. **`src/lib/income-classifier.ts`**
   - Add `'personal_repayment'` to `NON_EARNING_TYPES`.
   - Add `{ value: 'personal_repayment', label: 'Personal Repayment / Transfer' }` to `INCOME_TYPE_OPTIONS`.
   - Default `taxable_status` for this type is `'non_taxable'`.

2. **`src/pages/Income.tsx`**
   - Add a badge style for `personal_repayment` in `INCOME_TYPE_BADGE` (muted gray, similar to `transfer`).
   - Add a new summary card "Repayments / Transfers" showing the total (so you can see the bucket).
   - Add a row-level quick action button (in the actions column / drawer) and a bulk-action option: **"Mark as Repayment (exclude from income)"** that sets `income_type='personal_repayment'` + `taxable_status='non_taxable'` + `status='approved'` in one update.
   - The existing income-type dropdown on each row will also let you pick it manually.

3. **No DB migration needed** — `income_type` is already a free-form text column with no CHECK constraint, so the new value just works.

4. **No changes needed to Insights / Tax / Allocations / Accountant / CloseMonth** — they already exclude anything in `NON_EARNING_TYPES`.

### How rows get tagged

- **Manually**: pick "Personal Repayment / Transfer" from the income-type dropdown on the row, or use the new "Mark as Repayment" quick action.
- **Bulk**: select multiple rows → bulk action → "Mark as Repayment".
- **Auto-detected (optional, light heuristic)**: We will NOT auto-classify Zelle/Venmo as repayments, because they're often legitimate revenue. Those will continue to land as `'other'` with `taxable_status='unknown'` so you review them — and now you have a one-click way to push them into the repayment bucket.

## Files touched

- `src/lib/income-classifier.ts` — add type to constants
- `src/pages/Income.tsx` — add badge, summary card, row + bulk "Mark as Repayment" action
