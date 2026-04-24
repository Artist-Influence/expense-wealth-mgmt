# Fix Date Filter Not Filtering Expenses Table

## Problem

On the **Expenses** page, selecting a month (e.g. "Apr 2026") or any date range from the date filter pill updates the label but the table keeps showing all rows. The same is true for "This Month", "Last Month", "Last N Days", "YTD", and custom From/To inputs.

## Root Cause

In `src/pages/Expenses.tsx` (the `filtered` useMemo, around lines 161–191), the closing brace of the `if (categoryFilter !== 'all') { ... }` block is misplaced. As a result, the two date checks:

```ts
if (dateFrom && (!tx.date || tx.date < dateFrom)) return false;
if (dateTo   && (!tx.date || tx.date > dateTo))   return false;
```

…are **nested inside** the `categoryFilter !== 'all'` branch. When category filter is `"all"` (the default — and what the user has set), the entire block is skipped and the date checks never run. The state (`dateFrom`, `dateTo`) is set correctly, but the predicate ignores it.

## Fix

Re-indent / re-brace the predicate so date checks run unconditionally, alongside the other top-level checks (status, extra, category, search). One block, correct nesting:

```ts
let result = transactions.filter(tx => {
  if (statusFilter !== 'all' && tx.review_status !== statusFilter) return false;
  if (extraFilter === 'transfers' && !tx.is_transfer && tx.transfer_type !== 'possible_transfer') return false;
  // ...other extraFilter cases unchanged...

  if (categoryFilter !== 'all') {
    const effective = tx.final_category || tx.predicted_category || '';
    if (categoryFilter === '__uncategorized__') {
      if (effective) return false;
    } else if (effective !== categoryFilter) {
      return false;
    }
  }

  // Date filter — top level, always applied
  if (dateFrom && (!tx.date || tx.date < dateFrom)) return false;
  if (dateTo   && (!tx.date || tx.date > dateTo))   return false;

  if (search) {
    const s = search.toLowerCase();
    return (
      (tx.description_raw || '').toLowerCase().includes(s) ||
      (tx.predicted_category || '').toLowerCase().includes(s) ||
      (tx.final_category || '').toLowerCase().includes(s)
    );
  }
  return true;
});
```

## Scope Check — Other Pages

I audited every page for similar issues:

- **Income, Reimbursements, Tax, MerchantMemory, Wealth** — no date/month filter UI on their tables, so nothing to fix there. (Their summary cards already correctly scope to "this month" via `t.date?.startsWith(thisMonth)`.)
- **Allocations, CloseMonth, Accountant** — month/period selectors are wired into their queries (`.gte('date', dateRange.start).lte('date', dateRange.end)` or `.eq('month', selectedMonth)`) and work correctly.

So the fix is isolated to the Expenses predicate.

## Files Changed

- `src/pages/Expenses.tsx` — re-brace the `filtered` useMemo predicate (~10 lines).

## Verification

After the fix:
1. Open Expenses with no filters — full list shows.
2. Click date pill → "Apr 2026" → table immediately narrows to rows where `date` is between `2026-04-01` and `2026-04-30`.
3. Switch category filter to a specific category and confirm date filter still applies (combined behavior).
4. Click the "✕ Apr 2026" clear chip → all rows return.
