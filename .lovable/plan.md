## Goal

Make payment method a first-class way to slice the Expenses list so you can hunt down the mystery rows showing up in Insights buckets but feeling invisible in the table.

## What's there today

- The Expenses table has a **Method** column but it's not sortable and there's no filter for it.
- Methods come from two places: `final_method`/`predicted_method` (free-text, e.g. "Amex Platinum", "Chase Checking") and `source_account_name` (auto-set on upload from the filename, e.g. "Chase 5592").
- The toolbar already has Status, Filter, Category, and Date filters — we'll add Method right after Category.

## Plan

### 1. Add a Method dropdown filter
Add a new filter `Select` in the toolbar between **Category** and the **Date** picker:
- Options: `All Methods`, `(No method)`, then a deduped, alphabetized list of every method seen in the loaded transactions (uses `final_method || predicted_method || source_account_name`).
- Selecting one filters the table to only rows matching that method (case-insensitive exact match).
- Updates live with the current mode (Personal/Business/Reimbursable).

### 2. Make the Method column header sortable
Convert the plain `<th>Method</th>` into the existing `SortHeader` component so clicking it sorts ascending/descending by method name. Sort uses the same `final_method || predicted_method || source_account_name` fallback so blank-method rows cluster together.

### 3. Show source account when no method
In the Method cell, if the row has no `final_method` and no `predicted_method`, fall back to displaying `source_account_name` in muted text (e.g. "Chase 5592"). This way the rows from your 5592 upload are immediately visible even if they were never categorized.

### 4. URL deep-link support
Add `?method=<name>` to the same URL-param handler that already supports `?month=`, `?scope=`, `?review=`. This lets us link from Insights tiles straight into "show me Chase 5592 Apartment/Office personal rows" later — sets up the next step of fixing the Insights mystery.

## Technical details

**File:** `src/pages/Expenses.tsx`
- Add `methodFilter` state (default `'all'`).
- Compute `availableMethods` via `useMemo` from `transactions` (dedupe with a `Set`, sorted A→Z).
- Extend the `filtered` `useMemo` to apply `methodFilter` and add `'method'` to the `sortCol` switch.
- Add the new `<Select>` between the existing Category select and the Date popover.
- Swap the Method `<th>` for `<SortHeader col="method" label="Method" />`.
- Update the Method cell render (~line 1770) to fall back to `source_account_name` with a muted style when other method fields are empty.
- Extend the URL-param effect to read `?method=` and set `methodFilter`.

**No DB or RLS changes.** No edge function changes. Pure UI/state work, ships in one file.

## Why this helps the rent investigation

Once shipped, you can: switch to Personal mode → filter Method = "Chase 5592" (or whichever account) → filter Category = "Apartment/Office" → instantly see every row contributing to that bucket and confirm whether they're hidden behind a different account, an unreviewed status, or excluded from the table you've been looking at.
