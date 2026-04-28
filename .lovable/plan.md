## What's broken

When you click **Approve** on selected expenses (or **Approve All Suggested**), the table flashes/reloads repeatedly and a toast says *"Set a category first"* — even though every row already has a category.

## Root cause

`bulkApprove` (and the "Approve All Suggested" button) loop through every selected/suggested row and call `approveRow(tx)` one at a time. Inside `approveRow`:

1. It runs an individual UPDATE for that row.
2. It calls `await loadTransactions()`, which re-pages **every** transaction for the active mode (in 1000-row chunks) — every time.

So approving N rows triggers N full table reloads back-to-back. That's the "reloading over and over" you're seeing.

The *"Set a category first"* toast is also a side effect of the loop: `approveRow` is reused as both the single-row handler and the bulk loop body, and it calls `toast.error('Set a category first')` if **any single row** in the loop happens to lack both `final_category` and `predicted_category` (e.g. a transfer row, a split parent, or a row whose suggestion was rejected). Because the loop fires the toast per-row, you can see it pop on rows that look categorized in the UI but actually have a null `predicted_category` after a prior rejection.

## Fix

Rewrite the bulk paths in `src/pages/Expenses.tsx` so they do **one** DB round-trip and **one** reload, and so they only operate on rows that genuinely have a category:

1. **New helper `bulkApproveRows(txs: Transaction[])`** — used by `bulkApprove`, "Approve All Suggested", and any future bulk caller:
   - Filter to rows that have `final_category || predicted_category` and aren't split parents. Silently skip the rest (no per-row error toast).
   - Build one update payload per row (categories, methods, notes, `review_status: 'approved'`, `counts_as_tax_deduction`) and issue them in parallel via `Promise.all` — no awaiting `loadTransactions` between them.
   - After all updates resolve, update merchant memory in parallel for the eligible rows (same guards already in `approveRow`: parse_status ok, not transfer, not split parent/child, not possible_duplicate, not statement artifact).
   - Call `loadTransactions()` **once** at the end.
   - Show one summary toast: `Approved X rows` (and, if any were skipped, `· Y skipped (no category)`).

2. **Keep `approveRow` for single-row use** (drawer + per-row check button), but route both bulk callers through `bulkApproveRows` instead of looping `approveRow`.

3. **Tighten the "Approve All Suggested" filter** so it only includes rows where the suggested/predicted category is non-null AND the row isn't a split parent — matches the new helper's contract.

## Files changed

- `src/pages/Expenses.tsx` — add `bulkApproveRows`, rewire `bulkApprove` (line ~832) and "Approve All Suggested" onClick (line ~1785-1791). No schema changes, no other UI changes.

## Result

- Approving any number of rows triggers exactly one reload at the end — no more flicker storm.
- No false "Set a category first" toast during bulk operations; uncategorized rows are silently skipped and reported in the summary toast.
- Single-row Approve button behavior is unchanged.
