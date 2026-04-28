## What's actually wrong

Two separate things are conspiring to make the Tax page look broken:

### 1. The Personal/Business/All toggle does nothing visible at the top

The big "2026 Projection — Income vs Expenses" table (the one in your screenshots) is **hardcoded to always show both Personal and Business rows side by side**, regardless of which scope you click. Only the cards/tables further down the page (Taxable Income YTD, Deductions Breakdown, etc.) actually filter by scope.

So clicking Personal vs Business above the fold appears to do nothing — that's why "the math looks the same between personal and business." The number that *does* change (taxable income YTD card) is below where your screenshot was cropped.

### 2. The Business projection is wildly over-stating deductions

Confirmed from the database for 2026:

```text
Approved/edited business deductible spend:  ~$53k
Business deductions shown on Tax page:      ~$273k   ← inflated by ~$220k
```

The inflation comes from **unreviewed "suggested"/"ai_suggested" rows being counted at 100%**. The biggest culprit:

```text
Vendor Payment · suggested · 257 rows · $157,029.98
Commission     · suggested ·  13 rows · $24,058.97
Payroll        · suggested ·  15 rows · $19,513.00
```

That single "Vendor Payment / suggested" bucket is $157k of un-reviewed transactions being treated as fully deductible business expenses. Result: business "deductions" ($273k) > business "income" ($227k), business net = $0, business tax = $0.

This also **violates a core project rule** ("Only approved/edited `final_category` counts. Exclude unreviewed txns from all totals") — `loadProjection` in `src/pages/Tax.tsx` deliberately broadened the status filter to `['approved','auto_categorized','edited','suggested','ai_suggested']`, which contradicts that rule.

## Fix

### A. Make the projection respect the scope toggle

`src/pages/Tax.tsx` — the projection table now shows only the row(s) for the selected scope, with a single "Total" footer when `scope === 'all'`. Personal selected → only Personal row + total. Business selected → only Business row + total. All selected → both + total (today's behavior).

The header subtitle changes from `2026 Projection — Income vs Expenses` to `2026 Projection — {scope}` so it's obvious what you're looking at.

### B. Stop counting unreviewed rows as deductions

In `loadProjection`, change the deduction status filter from:

```text
['approved','auto_categorized','edited','suggested','ai_suggested']
```

to:

```text
['approved','auto_categorized','edited']
```

This aligns with the project's core financial-integrity rule and matches what every other page (Insights, Accountant exports, Allocations) already does. Income side is unchanged.

### C. Surface the unreviewed exposure as a separate, non-scary line

To avoid hiding information, add a small muted line under the projection table:

```text
+ $X in unreviewed business spend not yet counted toward deductions.
  Approve them on the Expenses page to lock in the deduction.
```

That number is the same `unreviewedDeductionCount` / `potentialDeductions` we already compute on the page (line 261). No new query.

## Expected outcome

After the fix, with Business selected for 2026:

- Business Taxable Income: $227,424.69 (unchanged — income side is already approval-agnostic by design)
- Business Deductions: ~$53k (only approved/edited)
- Business Net: ~$174k
- Business Est. Tax: ~$62k at 35.5%
- A muted line below: "+$220k unreviewed business spend not yet counted — review on Expenses to unlock deductions."

Personal numbers are unaffected (the Personal mode has very few auto-suggested deductions).

## Files touched

- `src/pages/Tax.tsx` — `loadProjection` status filter + projection table rendering filtered by `scope` + add unreviewed-exposure footnote.

No DB migration. No changes to `categorization-engine.ts` or other pages.
