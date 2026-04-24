# Fix: Export should include ALL checked rows

## Root cause

The current Expenses `exportCsv` (line 652) takes the checked rows but then runs them through a **second filter** that drops anything whose `review_status` isn't `approved`, `auto_categorized`, or `edited` (and also drops split parents). Result: if you checkbox a row that is still in `needs_review` / `flagged` / `pending`, it silently gets stripped from the CSV — so you see "only one" make it through.

```ts
const source = usingSelection ? filtered.filter(t => selectedIds.has(t.id)) : filtered;
const rows = source
  .filter(t => ['approved','auto_categorized','edited'].includes(t.review_status) && !t.is_split_parent)
  ...
```

Income and Reimbursements don't have this secondary filter, so they already export everything that's checked.

## Fix (Expenses only)

Change the source so the approval-status filter only applies to the **fallback** path (no selection). When the user explicitly checks rows, export every checked row exactly as-is. Also include a `Review Status` column so it's obvious why a row was/wasn't pre-approved.

```ts
const source = usingSelection
  ? filtered.filter(t => selectedIds.has(t.id))
  : filtered.filter(t => ['approved','auto_categorized','edited'].includes(t.review_status) && !t.is_split_parent);
```

And update the empty-state toast for the selection case to "No selected rows to export".

## Out of scope

- Income and Reimbursements exports already honor the full checked set; no change needed.
- No UI / table changes.

## QA

- Filter Expenses, check 5 rows of mixed `review_status` (some approved, some needs-review), click Export → CSV contains all 5.
- Clear selection, click Export → CSV contains only approved/auto/edited rows in the filtered view (existing behavior).
