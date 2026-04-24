## Insights — Accuracy Check + Date Filters

### Are the current numbers accurate?

Yes — **but with a caveat**. The charts (Spend by Category, Monthly Spend Trend, Top Merchants, Recurring) all pull from the same correctly-filtered dataset:

- Mode-scoped (Personal vs Business toggle, top right)
- Only `approved` / `auto_categorized` / `edited` rows
- Excludes transfers, split parents, parse errors, and any row flagged `exclude_from_expense_totals`

So the totals you're seeing (e.g. $6,723.01 for 2026-01 business) are real and correct.

**The caveat**: there is currently **no date filter** on the Insights page. Every chart is showing **all-time data**. "Spend by Category" is lifetime totals, not "this month" or "this quarter." That's why it can feel off — you're looking at cumulative numbers, not period-scoped ones.

The Monthly Trend chart is the only one with a time dimension, and it caps at the last 12 months.

### What I'll fix

1. **Add a date filter bar** to the Insights page header (next to the Personal/Business toggle), with these presets:
   - This Month / Last Month / This Quarter / This Year / Last Year / All Time / Custom (date range picker)
   - Default: **This Year** (matches user mental model better than "all time")
   - Persisted in URL query so refresh keeps the filter

2. **Wire the filter into every memo** so it actually drives the data:
   - `overview` cards (This Month / Last Month / MoM / Top Cat / Top Merchant / Transfers Excluded → become period-scoped)
   - `categoryData` (Spend by Category bar chart)
   - `monthlyTrend` (re-scoped to the selected window, not hard-coded last 12)
   - `topMerchants` table
   - `recurringCharges` detection
   - Income & Savings tab cards (savings rate, YoY)
   - Trends tab visualizations

3. **Header subtitle update**: show active scope, e.g. *"Showing: This Year · Business · Approved/edited only"* so it's always clear what's being measured.

4. **"This Month" / "Last Month" overview cards**: rename to be relative to the active filter (e.g. when filter = "This Year", these cards still mean current/prior calendar month for momentum context — keep them, but label them clearly so they don't conflict with the active period).

### Technical notes

- Single `dateRange` state `{ from: Date | null, to: Date | null, preset: string }` in `Insights.tsx`.
- One shared `dateFilteredExpenses` / `dateFilteredIncome` memo feeds every downstream calculation — no per-chart filtering logic to avoid drift.
- Reuse the existing date-preset component pattern from `Income.tsx` for consistency.
- No DB schema changes; pure client-side filtering on already-fetched data.

### Files

- `src/pages/Insights.tsx` (add filter UI + thread `dateRange` through all `useMemo` blocks)
