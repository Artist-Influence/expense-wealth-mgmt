# Selective Export from Checked Rows

All three table pages (Expenses, Income, Reimbursements) already have row-level checkbox selection (`selectedIds: Set<string>`) wired up for bulk operations. The `exportCsv` functions currently ignore that selection and always export the entire `filtered` set. This plan makes Export respect the checkbox selection.

## Behavior

- **Some rows checked** → Export only those checked rows (still constrained to whatever is currently filtered, so checking a row then changing filters can't leak hidden rows).
- **No rows checked** → Export everything currently visible in the filtered view (today's behavior).
- A toast confirms the count, e.g. *"Exported 12 selected rows"* vs *"Exported 87 rows"*.

## Files to change

### 1. `src/pages/Expenses.tsx` — `exportCsv` (line ~652)
Replace the source array. Today:
```ts
const rows = filtered
  .filter(t => ['approved','auto_categorized','edited'].includes(t.review_status) && !t.is_split_parent)
  .map(...)
```
Change to:
```ts
const source = selectedIds.size > 0
  ? filtered.filter(t => selectedIds.has(t.id))
  : filtered;
const rows = source
  .filter(t => ['approved','auto_categorized','edited'].includes(t.review_status) && !t.is_split_parent)
  .map(...)
```
Update the empty-state toast and success toast to reflect selection vs filtered.

### 2. `src/pages/Income.tsx` — `exportCsv` (line ~403)
Today: `const rows = filtered.length > 0 ? filtered : transactions;`
Change to:
```ts
const rows = selectedIds.size > 0
  ? filtered.filter(t => selectedIds.has(t.id))
  : filtered;
```
(Drop the fallback to all `transactions` — exporting hidden data when filters are active is misleading.)

### 3. `src/pages/Reimbursements.tsx` — `exportCsv` (line ~276)
Today: `const rows = filtered.map(...)`
Change to:
```ts
const source = selectedIds.size > 0
  ? filtered.filter(t => selectedIds.has(t.id))
  : filtered;
const rows = source.map(...)
```

## Out of scope

- **Accountant page** (`src/pages/Accountant.tsx`) — preview-only, no row checkboxes; left unchanged.
- **Tax / Wealth / Allocations / Insights** — no transaction tables with row checkboxes + export.
- No new UI elements; the existing "X selected" header bar already signals the active selection.

## QA

- Filter Expenses to one month, check 3 rows, click Export → CSV contains exactly those 3.
- Same page, clear selection, click Export → CSV contains all approved rows in the filtered view.
- Repeat on Income and Reimbursements.
